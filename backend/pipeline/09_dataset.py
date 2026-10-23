"""Commit-ready dataset: Merkle tree over every finding + an evidence bundle with its IPFS CID.

Leaves match RestorationEscrow.leaf(): keccak256(keccak256(abi.encode(uint8 kind, uint256 plotId, uint8 idx,
int32 scoreBps, bytes32 evidenceHash))), kind 0 = milestone, 1 = disturbance. Pairs are hashed sorted
(OpenZeppelin MerkleProof). The oracle committee signs the root; anyone can then submit reports with proofs.

Outputs:
  data/dataset.json            root, CID, every leaf with its proof
  data/evidence-bundle.json.gz all evidence files byte-exact (deterministic gzip); its CIDv1 is the on-chain `cid`

Usage: uv run python pipeline/09_dataset.py
"""

import base64
import gzip
import hashlib
import io
import json

from eth_abi import encode
from eth_utils import keccak

from common import DATA_DIR

MAX_SINGLE_BLOCK = 256 * 1024  # one IPFS block: CIDv1 raw = sha2-256 of the bytes


def leaf(kind: int, plot_id: int, idx: int, score: int, evidence_hash: str) -> bytes:
    inner = keccak(encode(["uint8", "uint256", "uint8", "int32", "bytes32"],
                          [kind, plot_id, idx, score, bytes.fromhex(evidence_hash.removeprefix("0x"))]))
    return keccak(inner)


def hash_pair(a: bytes, b: bytes) -> bytes:
    return keccak(a + b) if a < b else keccak(b + a)


def build(leaves: list[bytes]) -> list[list[bytes]]:
    levels = [leaves]
    while len(levels[-1]) > 1:
        lv = levels[-1]
        levels.append([hash_pair(lv[i], lv[i + 1]) if i + 1 < len(lv) else lv[i] for i in range(0, len(lv), 2)])
    return levels


def proof(levels: list[list[bytes]], index: int) -> list[bytes]:
    out = []
    for lv in levels[:-1]:
        sib = index ^ 1
        if sib < len(lv):
            out.append(lv[sib])
        index //= 2
    return out


def verify(p: list[bytes], root: bytes, lf: bytes) -> bool:
    h = lf
    for s in p:
        h = hash_pair(h, s)
    return h == root


def cid_v1_raw(data: bytes) -> str:
    """CIDv1 (raw codec, sha2-256) as `ipfs add --cid-version=1` produces for a single-block file."""
    if len(data) > MAX_SINGLE_BLOCK:
        raise SystemExit(f"bundle is {len(data)} bytes; must fit one 256 KiB IPFS block")
    raw = bytes([0x01, 0x55, 0x12, 0x20]) + hashlib.sha256(data).digest()
    return "b" + base64.b32encode(raw).decode().lower().rstrip("=")


def main() -> None:
    results = json.loads((DATA_DIR / "results.json").read_text(encoding="utf-8"))
    entries = []
    for pid, r in results.items():
        if r["chainId"] is None:
            continue
        for m in r["milestones"]:
            entries.append({"kind": 0, "plot": pid, "plotId": r["chainId"], "idx": m["idx"], "scoreBps": m["scoreBps"],
                            "evidenceHash": m["evidenceHash"], "file": f"{pid}-m{m['idx']}.json"})
        d = r.get("disturbance")
        if d and d.get("flagged"):
            entries.append({"kind": 1, "plot": pid, "plotId": r["chainId"], "idx": 0, "scoreBps": 0,
                            "evidenceHash": d["evidenceHash"], "file": f"{pid}-disturbance.json"})

    for e in entries:
        e["leaf"] = leaf(e["kind"], e["plotId"], e["idx"], e["scoreBps"], e["evidenceHash"])
        raw = (DATA_DIR / "evidence" / e["file"]).read_bytes()
        if "0x" + keccak(raw).hex() != e["evidenceHash"]:
            raise SystemExit(f"evidence hash mismatch for {e['file']}")
    entries.sort(key=lambda e: e["leaf"])
    levels = build([e["leaf"] for e in entries])
    root = levels[-1][0]

    # evidence bundle: exact file bytes, deterministic gzip (mtime 0) so the CID is reproducible
    files = {e["file"]: (DATA_DIR / "evidence" / e["file"]).read_text(encoding="utf-8") for e in entries}
    bundle = json.dumps({"version": 1, "root": "0x" + root.hex(), "files": files}, sort_keys=True,
                        separators=(",", ":"), ensure_ascii=False).encode()
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0, compresslevel=9) as gz:
        gz.write(bundle)
    packed = buf.getvalue()
    cid = cid_v1_raw(packed)
    (DATA_DIR / "evidence-bundle.json.gz").write_bytes(packed)

    out = {"root": "0x" + root.hex(), "cid": cid, "bundle": "evidence-bundle.json.gz", "bundleBytes": len(packed),
           "leafEncoding": "keccak256(keccak256(abi.encode(uint8 kind,uint256 plotId,uint8 idx,int32 scoreBps,bytes32 evidenceHash)))",
           "leaves": []}
    for i, e in enumerate(entries):
        pr = proof(levels, i)
        assert verify(pr, root, e["leaf"]), e
        out["leaves"].append({k: e[k] for k in ("kind", "plot", "plotId", "idx", "scoreBps", "evidenceHash", "file")}
                             | {"leaf": "0x" + e["leaf"].hex(), "proof": ["0x" + x.hex() for x in pr]})
    (DATA_DIR / "dataset.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"{len(entries)} leaves · root 0x{root.hex()} · bundle {len(packed):,} bytes · cid {cid}")


if __name__ == "__main__":
    main()
