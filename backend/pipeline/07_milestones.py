"""Build each plot's milestone schedule and the quarterly "pulse" from the annual results (04) and the quarterly
satellite data (06). Must match the on-chain schedule in contracts/script/Deploy.s.sol.

  M0         Stewardship start         15%  baseline (always passes)
  C1..C4     Quarterly check-ins        5%  each: no net vegetation drop > CHECKIN_DROP beyond the regional controls
  M1         Early recovery            30%  graded: adj(2023) vs target 0.30; plot fails below half the target
  M2         Sustained recovery        35%  graded: adj(2026) vs target 0.60; plot fails below half the target
  (recovery adj is measured against the plot's matched controls, see 04 and matching.py)

Writes into data/results.json: "milestones" (with expected on-chain outcome) and "pulse" per plot/control,
and data/evidence/<plot>-m<idx>.json (canonical JSON; keccak256 = on-chain evidence hash).

Usage: uv run python pipeline/07_milestones.py
"""

import json
import subprocess

import numpy as np
from eth_utils import keccak

from common import BBOX, CACHE_DIR, DATA_DIR, MAX_CLOUD, PERIODS, composite_path

METHOD_VERSION = "regrow-recovery-v3"
DATASET = "sentinel-2-l2a (Microsoft Planetary Computer)"
PULSE_DIR = CACHE_DIR / "pulse"
CHECKIN_QUARTERS = ["2021Q4", "2022Q1", "2022Q2", "2022Q3"]
CHECKIN_DROP = 0.10  # net NBR drop vs previous quarter, controls subtracted
MIN_VALID = 0.6  # share of clear pixels needed to judge a quarter
MIN_LOSS = 0.05  # same-season NBR loss needed for a meaningful recovery ratio
BASELINE_QUARTER = {1: "2021Q1", 2: "2021Q2", 3: "2020Q3", 4: "2020Q4"}  # same season, before the fire
FIRE_QUARTER = "2021Q3"

SCHEDULE = [
    {"kind": "baseline", "label": "Stewardship start", "bps": 1500, "period": "2021"},
    *[{"kind": "checkin", "label": f"Check-in {q[-2:]} {q[:4]}", "bps": 500, "period": q} for q in CHECKIN_QUARTERS],
    {"kind": "recovery", "label": "Early recovery", "bps": 3000, "period": "2023", "target": 0.30, "failBelow": 0.5},
    {"kind": "recovery", "label": "Sustained recovery", "bps": 3500, "period": "2026", "target": 0.60, "failBelow": 0.5},
]


STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
PROVENANCE = CACHE_DIR / "provenance.json"
PIXEL_CORRELATION = 9  # ~3x3 neighbouring 20 m pixels are not independent: n_eff = n / 9


def pipeline_commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def provenance(quarter_bbox: tuple[float, float, float, float]) -> dict:
    """Sentinel-2 scene IDs behind every composite (same searches as steps 01 and 06), cached."""
    if PROVENANCE.exists():
        return json.loads(PROVENANCE.read_text(encoding="utf-8"))
    import pystac_client

    catalog = pystac_client.Client.open(STAC_URL)

    def ids(bbox, start, end, cloud):
        items = catalog.search(collections=["sentinel-2-l2a"], bbox=bbox, datetime=f"{start}/{end}",
                               query={"eo:cloud_cover": {"lt": cloud}}).item_collection()
        return sorted(i.id for i in items)

    out = {"annual": {p: ids(BBOX, *PERIODS[p], MAX_CLOUD) for p in PERIODS}, "quarterly": {}}
    for q in sorted(load_pulse()):
        y, n = int(q[:4]), int(q[-1])
        out["quarterly"][q] = ids(quarter_bbox, f"{y}-{3 * n - 2:02d}-01", f"{y}-{3 * n:02d}-{30 if n in (2, 3) else 31}", 40)
    PROVENANCE.write_text(json.dumps(out), encoding="utf-8")
    return out


def recovery_uncertainty(bounds: list[float], period: str, ctrl_term: float, target: float, score: float) -> dict:
    """Per-pixel spread of the control-adjusted recovery inside the plot, from the 20 m composites."""
    import rioxarray

    x0, y0, x1, y1 = bounds

    def nbr(p):
        da = rioxarray.open_rasterio(composite_path(p)).rio.clip_box(x0, y0, x1, y1)
        bands = dict(zip(da.attrs["long_name"], da.values, strict=True))
        return (bands["B08"] - bands["B12"]) / (bands["B08"] + bands["B12"])

    pre, post, now = nbr("pre"), nbr("post"), nbr(period)
    loss = pre - post
    ok = np.isfinite(pre) & np.isfinite(post) & np.isfinite(now) & (loss > 0.05)
    adj = np.clip((now[ok] - post[ok]) / loss[ok], -1, 1.5) - ctrl_term
    n = int(ok.sum())
    se = float(np.std(adj) / np.sqrt(max(n / PIXEL_CORRELATION, 1)))
    mean = float(np.mean(adj))
    return {"pixels": n, "pixelStd": round(float(np.std(adj)), 4), "pixelMean": round(mean, 4),
            "ci95": round(1.96 * se, 4), "marginToTarget": round(score - target, 4),
            "confident": bool(abs(score - target) > 1.96 * se)}  # is the reported score clearly above/below target?


def canonical(doc: dict) -> bytes:
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def write_evidence(pid: str, idx: int, doc: dict) -> str:
    raw = canonical(doc)
    (DATA_DIR / "evidence" / f"{pid}-m{idx}.json").write_bytes(raw)
    return "0x" + keccak(raw).hex()


def load_pulse() -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(PULSE_DIR.glob("*.json"))}


def value(pulse: dict, q: str, fid: str) -> float | None:
    v = pulse.get(q, {}).get(fid)
    if not v or v["nbr"] is None or v["validFrac"] < MIN_VALID:
        return None
    return v["nbr"]


def ctrl_mean(pulse: dict, q: str, ctrl_ids: list[str]) -> float | None:
    vals = [value(pulse, q, c) for c in ctrl_ids]
    vals = [v for v in vals if v is not None]
    return float(np.mean(vals)) if vals else None


def pulse_series(pid: str, r: dict, ctrl_ids: list[str], pulse: dict, results: dict) -> list[dict]:
    post = r["periods"]["post"]["nbr"]
    out = []
    for q in pulse:
        nbr, ctrl = value(pulse, q, pid), ctrl_mean(pulse, q, ctrl_ids)
        phase = "fire" if q == FIRE_QUARTER else ("pre" if q < FIRE_QUARTER else "post")
        adj = None
        base_q = BASELINE_QUARTER[int(q[-1])]
        pre, ctrl_pre = value(pulse, base_q, pid), ctrl_mean(pulse, base_q, ctrl_ids)
        if phase == "post" and None not in (nbr, ctrl, pre, ctrl_pre) and pre - post >= MIN_LOSS:
            adj = (nbr - post) / (pre - post) - (ctrl - ctrl_pre) / (pre - post)
            adj = round(float(np.clip(adj, -1, 1.2)), 4)
        out.append({"q": q, "phase": phase, "nbr": nbr, "ctrlNbr": None if ctrl is None else round(ctrl, 4), "adj": adj})
    return out


def checkin(pid: str, q: str, r: dict, ctrl_ids: list[str], pulse: dict, results: dict) -> dict:
    qs = sorted(pulse)
    prev_q = qs[qs.index(q) - 1]
    if prev_q == FIRE_QUARTER:  # compare with the clean post-fire composite (Aug-Sep 2021), not the mixed quarter
        prev, ctrl_prev = r["periods"]["post"]["nbr"], float(np.mean([results[c]["periods"]["post"]["nbr"] for c in ctrl_ids]))
        prev_label = "post-fire composite (Aug-Sep 2021)"
    else:
        prev, ctrl_prev = value(pulse, prev_q, pid), ctrl_mean(pulse, prev_q, ctrl_ids)
        prev_label = prev_q
    now, ctrl_now = value(pulse, q, pid), ctrl_mean(pulse, q, ctrl_ids)
    if None in (prev, ctrl_prev, now, ctrl_now):
        return {"quarter": q, "comparedWith": prev_label, "inconclusive": True, "netDrop": None, "passed": True,
                "note": "too cloudy to judge; benefit of the doubt to the steward"}
    net = (prev - now) - (ctrl_prev - ctrl_now)
    return {"quarter": q, "comparedWith": prev_label, "inconclusive": False, "plotNbr": [round(prev, 4), round(now, 4)],
            "controlNbr": [round(ctrl_prev, 4), round(ctrl_now, 4)], "netDrop": round(net, 4),
            "threshold": CHECKIN_DROP, "passed": bool(net <= CHECKIN_DROP)}


def main() -> None:
    results = json.loads((DATA_DIR / "results.json").read_text(encoding="utf-8"))
    features = json.loads((DATA_DIR / "plots.geojson").read_text(encoding="utf-8"))["features"]
    pulse = load_pulse()
    missing = [q for q in CHECKIN_QUARTERS + [FIRE_QUARTER, *BASELINE_QUARTER.values()] if q not in pulse]
    if missing:
        raise SystemExit(f"pulse quarters missing: {missing}; run 06_pulse.py first")

    plot_bounds = [f["properties"]["utmBounds"] for f in features]
    from pyproj import Transformer

    to_ll = Transformer.from_crs("EPSG:32636", "EPSG:4326", always_xy=True)
    xs = [b for bb in plot_bounds for b in (bb[0], bb[2])]
    ys = [b for bb in plot_bounds for b in (bb[1], bb[3])]
    (lon0, lat0), (lon1, lat1) = to_ll.transform(min(xs) - 1500, min(ys) - 1500), to_ll.transform(max(xs) + 1500, max(ys) + 1500)
    prov = provenance((lon0, lat0, lon1, lat1))
    commit = pipeline_commit()

    evidence_dir = DATA_DIR / "evidence"
    evidence_dir.mkdir(exist_ok=True)
    for old in evidence_dir.glob("*-m*.json"):
        old.unlink()

    print(f"{'plot':14s} {'name':22s} " + " ".join(f"{s['label'][:9]:>9s}" for s in SCHEDULE))
    for f in features:
        p = f["properties"]
        pid, r = p["id"], results[p["id"]]
        if p["kind"] == "control":
            r["pulse"] = [{"q": q, "nbr": value(pulse, q, pid)} for q in pulse]
            continue
        ctrl_ids = p["controlIds"]
        r["pulse"] = pulse_series(pid, r, ctrl_ids, pulse, results)
        base = {"plotId": pid, "method": METHOD_VERSION, "dataset": DATASET, "controls": ctrl_ids,
                "pipelineCommit": commit, "utmBounds": p["utmBounds"], "crs": "EPSG:32636"}

        milestones, alive = [], True
        for idx, s in enumerate(SCHEDULE):
            doc = {**base, "milestone": idx, "kind": s["kind"], "label": s["label"], "period": s["period"]}
            target = s.get("target")
            if s["kind"] == "baseline":
                score = 10_000
                doc |= {"check": "baseline burn severity established", "dnbrMean": p["severity"]["meanDnbr"],
                        "severity": p["severity"]["class"], "nbrPre": r["periods"]["pre"]["nbr"], "nbrPost": r["periods"]["post"]["nbr"],
                        "scenes": {k: prov["annual"][k] for k in ("pre", "post")}}
            elif s["kind"] == "checkin":
                c = checkin(pid, s["period"], r, ctrl_ids, pulse, results)
                score = 10_000 if c["passed"] else 0
                doc |= c | {"scenes": prov["quarterly"].get(s["period"], [])}
            else:
                per = r["periods"][s["period"]]
                score = round(per["adj"] * 10_000)
                ctrl_term = per["rr"] - per["adj"] if per["rr"] is not None else 0.0
                unc = recovery_uncertainty(p["utmBounds"], s["period"], ctrl_term, target, per["adj"])
                doc |= {"rr": per["rr"], "adj": per["adj"], "targetAdj": target, "failBelowFractionOfTarget": s["failBelow"],
                        "twins": r["twins"],
                        "nbr": {k: v["nbr"] for k, v in r["periods"].items()}, "uncertainty": unc,
                        "scenes": {k: prov["annual"][k] for k in ("pre", "post", s["period"])}}
            target_bps = round(target * 10_000) if target else 0
            fraction = (10_000 if score > 0 else 0) if not target_bps else int(min(max(score, 0) * 10_000 // target_bps, 10_000))
            fail_below = int(s.get("failBelow", 0) * 10_000)
            if not alive:
                outcome = "not reached"
            elif fail_below and fraction < fail_below:
                outcome, alive = "fail", False
            else:
                outcome = "paid" if fraction == 10_000 else ("missed" if fraction == 0 else "partial")
            doc |= {"scoreBps": score, "fractionBps": fraction}
            milestones.append({
                "idx": idx, "kind": s["kind"], "label": s["label"], "period": s["period"], "bps": s["bps"],
                "targetBps": target_bps or None, "failBelowBps": fail_below or None, "scoreBps": score,
                "fractionBps": fraction, "outcome": outcome, "evidenceHash": write_evidence(pid, idx, doc),
                **({"netDrop": doc.get("netDrop"), "inconclusive": doc.get("inconclusive")} if s["kind"] == "checkin" else {}),
                **({"ci95": doc["uncertainty"]["ci95"], "confident": doc["uncertainty"]["confident"]} if s["kind"] == "recovery" else {}),
                "scenes": sum(len(v) for v in doc["scenes"].values()) if isinstance(doc.get("scenes"), dict) else len(doc.get("scenes", [])),
            })
        r["milestones"] = milestones
        print(f"{pid:14s} {p['name'][:22]:22s} " + " ".join(
            f"{m['outcome'][:4]:>4s}{m['fractionBps'] / 100:4.0f}%" for m in milestones))

    (DATA_DIR / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"pulse quarters: {len(pulse)} ({min(pulse)}…{max(pulse)})")


if __name__ == "__main__":
    main()
