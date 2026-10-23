"""Oracle committee + relayer: turn the committed satellite dataset into on-chain reports.

Trust model (contracts v3):
- Oracle signers sign one EIP-712 `DatasetCommit(root, cid, nonce)` per evidence set. `oracleThreshold` distinct
  signatures are needed on-chain. In this prototype two of the three signer keys run on this server
  (ORACLE_PRIVATE_KEYS); in production each signer is an independent organisation running the open pipeline.
- The relayer (RELAYER_PRIVATE_KEY) only pays gas: it submits the signed commitment and Merkle-proven reports. It holds
  no special role, so a compromised relayer cannot change any score.

Inputs: data/dataset.json (pipeline/09_dataset.py), chain/addresses.json + ABIs (contracts/script/Deploy.s.sol).
"""

import json
import logging
import re
import threading
from functools import cache
from pathlib import Path

from eth_account import Account
from web3 import Web3
from web3.exceptions import ContractCustomError, ContractLogicError

from .config import BACKEND_DIR, settings

log = logging.getLogger(__name__)

CHAIN_DIR = BACKEND_DIR / "chain"
PLOT_KEY = re.compile(r"^plot-r\d{2}c\d{2}$")
MAX_MILESTONE = 32


class OracleError(Exception):
    pass


@cache
def _w3() -> Web3:
    return Web3(Web3.HTTPProvider(settings.rpc_url, request_kwargs={"timeout": 30}))


def _abi(name: str = "RestorationEscrow") -> list[dict]:
    return json.loads((CHAIN_DIR / f"{name}.abi.json").read_text())


def _escrow():
    addresses = json.loads((CHAIN_DIR / "addresses.json").read_text())
    return _w3().eth.contract(address=Web3.to_checksum_address(addresses["RestorationEscrow"]), abi=_abi())


def _relayer():
    key = settings.relayer_private_key or settings.oracle_private_key
    if not key:
        raise OracleError("RELAYER_PRIVATE_KEY not set")
    return Account.from_key(key)


def _signers() -> list:
    keys = [k.strip() for k in (settings.oracle_private_keys or settings.oracle_private_key).split(",") if k.strip()]
    if not keys:
        raise OracleError("ORACLE_PRIVATE_KEYS not set")
    return sorted((Account.from_key(k) for k in keys), key=lambda a: int(a.address, 16))


def _error_name(data: str) -> str:
    """Map revert data to the contract's custom error name (e.g. NotActive, InvalidProof)."""
    selector = data[:10].lower()
    for item in _abi():
        if item["type"] == "error":
            sig = f"{item['name']}({','.join(i['type'] for i in item['inputs'])})"
            if "0x" + Web3.keccak(text=sig).hex().removeprefix("0x")[:8] == selector:
                return item["name"]
    return f"revert {selector}"


TX_LOCK = threading.Lock()  # one relayer transaction at a time: concurrent sends would reuse the same nonce


def _send(fn) -> str:
    with TX_LOCK:
        return _send_locked(fn)


def _send_locked(fn) -> str:
    w3, acct = _w3(), _relayer()
    try:
        tx = fn.build_transaction({
            "from": acct.address,
            "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
            "chainId": settings.chain_id,
        })
    except ContractCustomError as e:
        raise OracleError(f"contract rejected: {_error_name(str(e.data))}") from e
    except ContractLogicError as e:
        raise OracleError(f"contract rejected: {e.message or e}") from e
    signed = acct.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    if receipt.status != 1:
        raise OracleError(f"transaction reverted: {tx_hash.to_0x_hex()}")
    return tx_hash.to_0x_hex()


def _b32(h: str) -> bytes:
    return bytes.fromhex(h.removeprefix("0x"))


def load_dataset(data_dir: Path) -> dict:
    path = data_dir / "dataset.json"
    if not path.exists():
        raise OracleError("dataset.json missing; run pipeline/09_dataset.py")
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_committed(dataset: dict) -> str | None:
    """Commit the dataset root with committee signatures if it is not on-chain yet. Returns the tx hash or None."""
    escrow = _escrow()
    root = _b32(dataset["root"])
    if escrow.functions.getDataset(root).call()[0] != 0:
        return None
    nonce = escrow.functions.datasetCount().call()
    digest = escrow.functions.datasetDigest(root, dataset["cid"], nonce).call()
    signers = _signers()
    threshold = escrow.functions.oracleThreshold().call()
    if len(signers) < threshold:
        raise OracleError(f"{len(signers)} oracle keys available, threshold is {threshold}")
    sigs = [bytes(s.unsafe_sign_hash(digest).signature) for s in signers[:max(threshold, 1)]]
    return _send(escrow.functions.commitDataset(root, dataset["cid"], sigs))


def _leaf(dataset: dict, plot_key: str, kind: int, idx: int = 0) -> dict:
    for e in dataset["leaves"]:
        if e["plot"] == plot_key and e["kind"] == kind and (kind == 1 or e["idx"] == idx):
            return e
    raise OracleError(f"no committed {'milestone ' + str(idx) if kind == 0 else 'disturbance'} for {plot_key}")


def _check_plot_key(plot_key: str) -> None:
    if not PLOT_KEY.match(plot_key):
        raise OracleError("invalid plot id")


def report_milestone(dataset: dict, plot_key: str, idx: int) -> dict:
    """Relay a committed milestone score with its Merkle proof; execute at once if the challenge window is 0."""
    _check_plot_key(plot_key)
    if not 0 <= idx < MAX_MILESTONE:
        raise OracleError("invalid milestone index")
    e = _leaf(dataset, plot_key, 0, idx)
    commit_tx = ensure_committed(dataset)
    escrow = _escrow()
    report_tx = _send(escrow.functions.submitReport(
        e["plotId"], idx, e["scoreBps"], _b32(e["evidenceHash"]), _b32(dataset["root"]), [_b32(p) for p in e["proof"]]
    ))
    out = {"plotId": plot_key, "milestone": idx, "scoreBps": e["scoreBps"], "evidenceHash": e["evidenceHash"],
           "datasetRoot": dataset["root"], "commitTx": commit_tx, "reportTx": report_tx, "executeTx": None}
    window = escrow.functions.challengeWindow().call()
    if window == 0:
        out["executeTx"] = _send(escrow.functions.execute(e["plotId"], idx))
    else:
        # nobody else executes on a testnet, so the relayer does it once the challenge window has passed
        out["executesInSeconds"] = window + EXECUTE_GRACE_S
        timer = threading.Timer(window + EXECUTE_GRACE_S, _auto_execute, args=(dataset, plot_key, idx))
        timer.daemon = True
        timer.start()
    return out


EXECUTE_GRACE_S = 10  # block timestamps can trail the wall clock by a few seconds


def execute_milestone(dataset: dict, plot_key: str, idx: int) -> dict:
    """Execute a reported milestone once its challenge window has passed (anyone may; the relayer pays the gas)."""
    _check_plot_key(plot_key)
    e = _leaf(dataset, plot_key, 0, idx)
    return {"plotId": plot_key, "milestone": idx, "executeTx": _send(_escrow().functions.execute(e["plotId"], idx))}


def _auto_execute(dataset: dict, plot_key: str, idx: int) -> None:
    try:
        execute_milestone(dataset, plot_key, idx)
    except Exception as e:  # noqa: BLE001  (background thread: already executed, challenged or a node hiccup; retry via the console)
        log.warning("auto-execute %s milestone %s failed: %s", plot_key, idx, e)


def flag_disturbance(dataset: dict, plot_key: str) -> dict:
    _check_plot_key(plot_key)
    e = _leaf(dataset, plot_key, 1)
    commit_tx = ensure_committed(dataset)
    tx = _send(_escrow().functions.submitDisturbance(
        e["plotId"], _b32(e["evidenceHash"]), _b32(dataset["root"]), [_b32(p) for p in e["proof"]]
    ))
    return {"plotId": plot_key, "evidenceHash": e["evidenceHash"], "commitTx": commit_tx, "tx": tx}


def expire_pause(dataset: dict, plot_key: str) -> dict:
    """Anyone may call expirePause once a pause has run past maxPause; the relayer pays the gas."""
    _check_plot_key(plot_key)
    e = _leaf(dataset, plot_key, 0, 0)
    return {"plotId": plot_key, "tx": _send(_escrow().functions.expirePause(e["plotId"]))}


def chain_ready() -> bool:
    return (CHAIN_DIR / "addresses.json").exists()
