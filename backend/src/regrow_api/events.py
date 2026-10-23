"""Incremental indexer for RestorationEscrow events (ledger page, tx links, funder lists).

Fetches logs in chunks from the deploy block, decodes them with the ABI and keeps them in memory plus a
cache file, so public RPC range limits and restarts are not a problem.
"""

import json
import threading
import time

from hexbytes import HexBytes
from web3 import Web3

from .config import BACKEND_DIR
from .oracle import CHAIN_DIR, _w3

CACHE_FILE = BACKEND_DIR / "cache" / "events.json"
CHUNK = 200  # public Base RPC caps eth_getLogs at 200 blocks (larger ranges get HTTP 413)
MIN_SYNC_INTERVAL = 8  # seconds

_lock = threading.Lock()
_state: dict = {"address": None, "lastBlock": None, "events": [], "syncedAt": 0.0}


def _jsonable(v):
    if isinstance(v, (bytes, HexBytes)):
        return "0x" + bytes(v).hex()
    if isinstance(v, int) and abs(v) > 2**53:
        return str(v)
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    return v


def _contract():
    addresses = json.loads((CHAIN_DIR / "addresses.json").read_text())
    abi = json.loads((CHAIN_DIR / "RestorationEscrow.abi.json").read_text())
    c = _w3().eth.contract(address=Web3.to_checksum_address(addresses["RestorationEscrow"]), abi=abi)
    by_topic = {}
    for item in abi:
        if item["type"] == "event":
            sig = f"{item['name']}({','.join(i['type'] for i in item['inputs'])})"
            by_topic["0x" + Web3.keccak(text=sig).hex().removeprefix("0x")] = item["name"]
    return c, by_topic, int(addresses.get("deployBlock", 0))


def _load_cache(address: str) -> None:
    if CACHE_FILE.exists():
        cached = json.loads(CACHE_FILE.read_text())
        if cached.get("address") == address:
            _state.update(cached)


def sync() -> list[dict]:
    """Bring the event list up to date (rate-limited) and return it, oldest first."""
    with _lock:
        if time.time() - _state["syncedAt"] < MIN_SYNC_INTERVAL:
            return _state["events"]
        w3 = _w3()
        contract, by_topic, deploy_block = _contract()
        if _state["address"] != contract.address:
            _state.update(address=contract.address, lastBlock=deploy_block - 1, events=[])
            _load_cache(contract.address)

        head = w3.eth.block_number
        start = _state["lastBlock"] + 1
        block_ts: dict[int, int] = {}
        while start <= head:
            end = min(start + CHUNK - 1, head)
            logs = w3.eth.get_logs({"address": contract.address, "fromBlock": start, "toBlock": end})
            for log in logs:
                topic0 = "0x" + bytes(log["topics"][0]).hex()
                name = by_topic.get(topic0)
                if not name:
                    continue
                ev = contract.events[name]().process_log(log)
                bn = log["blockNumber"]
                if bn not in block_ts:
                    block_ts[bn] = w3.eth.get_block(bn)["timestamp"]
                _state["events"].append({
                    "event": name,
                    "args": {k: _jsonable(v) for k, v in ev["args"].items()},
                    "blockNumber": bn,
                    "timestamp": block_ts[bn],
                    "txHash": "0x" + bytes(log["transactionHash"]).hex(),
                    "logIndex": log["logIndex"],
                })
            _state["lastBlock"] = end
            start = end + 1

        _state["syncedAt"] = time.time()
        CACHE_FILE.parent.mkdir(exist_ok=True)
        CACHE_FILE.write_text(json.dumps({k: v for k, v in _state.items() if k != "syncedAt"}))
        return _state["events"]
