"""Gas sponsor for the in-browser demo wallet: sends a pinch of free testnet ETH so visitors without a crypto
wallet can try faucet → fund. Testnet only; rate-limited per IP and globally."""

import threading
import time
from collections import deque

from eth_account import Account
from web3 import Web3

from .config import settings
from .oracle import TX_LOCK, OracleError, _w3

_lock = threading.Lock()
_per_ip: dict[str, deque] = {}
_global: deque = deque()

PER_IP_PER_HOUR = 5
GLOBAL_PER_DAY = 300
DEMO_GAS_UNITS = 2_000_000  # faucet + approve + fund (with NFT mint) several times over


def _sponsor():
    key = settings.gas_tank_private_key or settings.relayer_private_key or settings.oracle_private_key
    if not key:
        raise OracleError("gas sponsor not configured")
    return Account.from_key(key)


def _allow(ip: str) -> bool:
    now = time.time()
    q = _per_ip.setdefault(ip, deque())
    while q and now - q[0] > 3600:
        q.popleft()
    while _global and now - _global[0] > 86400:
        _global.popleft()
    if len(q) >= PER_IP_PER_HOUR or len(_global) >= GLOBAL_PER_DAY:
        return False
    q.append(now)
    _global.append(now)
    return True


def fund_gas(address: str, ip: str) -> dict:
    if settings.chain_id == 1:
        raise OracleError("demo gas is testnet only")
    if not Web3.is_address(address):
        raise OracleError("invalid address")
    to = Web3.to_checksum_address(address)
    w3 = _w3()
    gas_price = w3.eth.gas_price
    # enough for DEMO_GAS_UNITS at 3x today's fee level, capped (fees differ ~1000x between chains)
    amount = min(gas_price * 3 * DEMO_GAS_UNITS, settings.demo_gas_max_wei)
    with _lock, TX_LOCK:  # the sponsor may be the relayer: share its nonce lock
        balance = w3.eth.get_balance(to)
        if balance >= amount // 3:
            return {"funded": False, "reason": "already has gas", "balanceWei": str(balance)}
        if not _allow(ip):
            raise OracleError("demo gas limit reached, try again later")
        acct = _sponsor()
        tx = {
            "to": to,
            "value": amount,
            "from": acct.address,
            "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
            "chainId": settings.chain_id,
            "gas": 21_000,
            "maxFeePerGas": gas_price * 2,
            "maxPriorityFeePerGas": min(w3.eth.max_priority_fee, gas_price),
        }
        tx_hash = w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)
        w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    return {"funded": True, "tx": tx_hash.to_0x_hex(), "amountWei": str(amount)}
