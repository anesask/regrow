"""Pick demo plots + unburned controls from cache/cells.json, compute recovery
scores, milestone verdicts, disturbance flags and evidence hashes.

Since method v3, annual recovery and the disturbance flag are measured against each cell's own matched controls
("twins", pipeline/matching.py). The 3 regional controls remain for the quarterly check-ins (07), whose quarter-on-
quarter comparison is not affected by slow multi-year drift, and as map context.

Outputs (committed, served by the API):
  data/plots.geojson     plot + control polygons and metadata
  data/results.json      per-id time series, milestones, disturbance
  data/evidence/*.json   canonical evidence documents; keccak256(file bytes) = on-chain evidenceHash

Usage: uv run python pipeline/04_select_and_score.py
Science: brief §8. Thresholds below are config, tuned on real data, never on fake values.
"""

import itertools
import json
import os
import time
from pathlib import Path

import httpx
import matching
import numpy as np
from eth_utils import keccak
from pyproj import Transformer

from common import BURN_THRESHOLD, CACHE_DIR, CRS, DATA_DIR, PERIODS, SEVERITY

METHOD_VERSION = "regrow-recovery-v3"

# Candidate filters
FOREST_NDVI_PRE = 0.45  # pre-fire NDVI: forested cell
MIN_NBR_LOSS = 0.15  # NBR_pre - NBR_post, keeps the recovery ratio stable
CONTROL_DIST_KM = (2.0, 15.0)
CONTROL_MAX_DNBR = 0.05
N_CONTROLS = 3
MIN_PLOT_SPACING_KM = 2.0
# The demo plots, in on-chain order. Chosen in v2 by the rule in pick_demo_plots (median-like members of each outcome
# group); pinned so ids stay stable across method changes. RESELECT=1 runs the rule again.
DEMO_PLOTS = ["r26c32", "r41c21", "r59c40", "r28c27", "r42c36", "r45c33", "r24c26", "r22c22"]

# Milestones (brief §8 "replay mode")
M1_PERIOD, M1_THRESHOLD = "2023", 0.30
M2_PERIOD, M2_THRESHOLD = os.environ.get("M2_PERIOD", "2026"), 0.60  # env override for local previews only
DISTURBANCE_DROP = 0.15  # year-over-year NBR drop beyond the controls' change
MILESTONE_BPS = [2000, 3000, 5000]

RECOVERY_PERIODS = [p for p in PERIODS if p not in ("pre", "post")]
to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)


def severity_class(dnbr: float) -> str:
    return next(name for hi, name in SEVERITY if dnbr < hi)


def control_delta(controls: list[dict], period: str) -> float:
    """Mean NBR change of the controls between pre-fire and `period` (weather/regional signal)."""
    return float(np.mean([c["periods"][period]["nbr"] - c["periods"]["pre"]["nbr"] for c in controls]))


def recovery(cell: dict, controls: list[dict]) -> dict:
    p = cell["periods"]
    loss = p["pre"]["nbr"] - p["post"]["nbr"]
    out = {}
    for period in RECOVERY_PERIODS:
        if period not in p:
            continue
        rr = (p[period]["nbr"] - p["post"]["nbr"]) / loss
        adj = rr - control_delta(controls, period) / loss
        out[period] = {"rr": float(np.clip(rr, 0, 1.2)), "adj": float(np.clip(adj, -0.5, 1.2))}
    return out


def disturbance(cell: dict, controls: list[dict]) -> dict | None:
    """First year whose NBR drops by more than DISTURBANCE_DROP vs the previous year, net of controls."""
    seq = ["post", *[p for p in RECOVERY_PERIODS if p in cell["periods"]]]
    for prev, cur in itertools.pairwise(seq):
        plot_drop = cell["periods"][prev]["nbr"] - cell["periods"][cur]["nbr"]
        ctrl_drop = float(np.mean([c["periods"][prev]["nbr"] - c["periods"][cur]["nbr"] for c in controls]))
        if plot_drop - ctrl_drop > DISTURBANCE_DROP:
            return {"year": cur, "drop": round(plot_drop - ctrl_drop, 4)}
    return None


def dist_km(a: dict, b: dict) -> float:
    ax, ay = (a["bounds"][0] + a["bounds"][2]) / 2, (a["bounds"][1] + a["bounds"][3]) / 2
    bx, by = (b["bounds"][0] + b["bounds"][2]) / 2, (b["bounds"][1] + b["bounds"][3]) / 2
    return float(np.hypot(ax - bx, ay - by) / 1000)


def pick_spread(pool: list[dict], n: int, chosen: list[dict], spacing: float = MIN_PLOT_SPACING_KM) -> list[dict]:
    """Take cells in pool order, skipping any within `spacing` km of an already chosen cell."""
    picked = []
    for cell in pool:
        if len(picked) == n:
            break
        if all(dist_km(cell, o) >= spacing for o in chosen + picked):
            picked.append(cell)
    return picked


def polygon(cell: dict) -> list[list[float]]:
    x0, y0, x1, y1 = cell["bounds"]
    ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    return [[round(c, 6) for c in to_ll.transform(x, y)] for x, y in ring]


def centroid(cell: dict) -> list[float]:
    x0, y0, x1, y1 = cell["bounds"]
    return [round(c, 6) for c in to_ll.transform((x0 + x1) / 2, (y0 + y1) / 2)]


UA = {"User-Agent": "ReGrow-hackathon/0.1 (IEEE ClimateChain 2026)"}
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]


def _overpass_place(lon: float, lat: float) -> str | None:
    query = (f'[out:json][timeout:25];node(around:4000,{lat},{lon})'
             '["place"~"^(village|hamlet|neighbourhood|quarter|isolated_dwelling)$"]["name"];out;')
    for url in OVERPASS:
        try:
            nodes = httpx.post(url, data={"data": query}, headers=UA, timeout=40).json().get("elements", [])
        except (httpx.HTTPError, ValueError):
            continue
        if nodes:
            k = np.cos(np.radians(lat))
            best = min(nodes, key=lambda n: ((n["lon"] - lon) * k) ** 2 + (n["lat"] - lat) ** 2)
            return best["tags"].get("name:tr") or best["tags"]["name"]
        return None
    return None


def _nominatim_place(lon: float, lat: float) -> str | None:
    try:
        a = httpx.get("https://nominatim.openstreetmap.org/reverse",
                      params={"lat": lat, "lon": lon, "zoom": 16, "format": "jsonv2", "accept-language": "tr"},
                      headers=UA, timeout=20).json().get("address", {})
    except (httpx.HTTPError, ValueError):
        return None
    return next((a[k] for k in ("village", "hamlet", "neighbourhood", "quarter", "suburb", "town") if k in a), None)


def place_name(lon: float, lat: float, cache: dict) -> str:
    """Nearest named village/hamlet within 4 km (OSM Overpass, Nominatim fallback), cached."""
    key = f"{lon:.4f},{lat:.4f}"
    if key not in cache:
        time.sleep(1.1)
        cache[key] = _overpass_place(lon, lat) or _nominatim_place(lon, lat) or "Manavgat"
    return cache[key]


def write_evidence(doc: dict) -> str:
    """Write canonical JSON; return 0x keccak256 of its exact bytes."""
    raw = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    path = DATA_DIR / "evidence" / f"{doc['plotId']}-{doc['kind']}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return "0x" + keccak(raw).hex()


def main() -> None:
    meta = json.loads((CACHE_DIR / "cells.json").read_text(encoding="utf-8"))
    cells = meta["cells"]
    missing = [p for p in (M1_PERIOD, M2_PERIOD) if p not in meta["periods"]]
    if missing:
        raise SystemExit(f"composites missing for {missing}; run 01 + 03 first")

    # --- controls: unburned forest near the scar, stable over time, matching pre-fire NDVI
    cand = [c for c in cells if c["fracScar"] >= 0.95 and c["fracLand"] >= 0.9
            and c["periods"]["pre"]["ndvi"] >= FOREST_NDVI_PRE and c["dnbr"] >= BURN_THRESHOLD
            and c["periods"]["pre"]["nbr"] - c["periods"]["post"]["nbr"] >= MIN_NBR_LOSS]
    q25, q50, q75 = np.percentile([c["periods"]["pre"]["ndvi"] for c in cand], [25, 50, 75])
    ctrl_pool = [c for c in cells if c["fracScar"] == 0 and c["fracLand"] >= 0.95
                 and CONTROL_DIST_KM[0] <= c["distKm"] <= CONTROL_DIST_KM[1]
                 and c["dnbr"] < CONTROL_MAX_DNBR and c["sevFrac"]["unburned"] >= 0.95
                 and q25 <= c["periods"]["pre"]["ndvi"] <= q75
                 and all(abs(c["periods"][p]["nbr"] - c["periods"]["pre"]["nbr"]) < 0.08 for p in meta["periods"])]
    ctrl_pool.sort(key=lambda c: abs(c["periods"]["pre"]["ndvi"] - q50))
    controls = pick_spread(ctrl_pool, N_CONTROLS, [], spacing=8.0)
    print(f"{len(cand)} candidate plots, {len(ctrl_pool)} control candidates -> controls "
          + ", ".join(f"{c['id']} ({c['distKm']} km)" for c in controls))
    for p in meta["periods"]:
        if p != "pre":
            print(f"  control NBR change pre->{p}: {control_delta(controls, p):+.3f}")

    # --- score every candidate against its own matched controls
    matcher = matching.Matcher(cells, cand)
    for c in cand:
        c["twins"] = matcher.twins(c)
        c["rec"] = recovery(c, c["twins"])
        c["dist"] = disturbance(c, c["twins"])
        c["m1"] = c["rec"][M1_PERIOD]["adj"]
        c["m2"] = c["rec"][M2_PERIOD]["adj"]
    m1s, m2s = np.array([c["m1"] for c in cand]), np.array([c["m2"] for c in cand])
    print(f"adj {M1_PERIOD}: p10 {np.percentile(m1s, 10):.2f} p50 {np.median(m1s):.2f} p90 {np.percentile(m1s, 90):.2f}"
          f" | pass {np.mean(m1s >= M1_THRESHOLD):.0%}")
    print(f"adj {M2_PERIOD}: p10 {np.percentile(m2s, 10):.2f} p50 {np.median(m2s):.2f} p90 {np.percentile(m2s, 90):.2f}"
          f" | pass {np.mean(m2s >= M2_THRESHOLD):.0%}")
    disturbed = [c for c in cand if c["dist"]]
    print(f"disturbance flagged: {len(disturbed)} cells")

    # --- choose a representative, honest mix (median-like members of each outcome group)
    def by_closeness(group, key, target):
        return sorted(group, key=lambda c: abs(c[key] - target))

    clean = [c for c in cand if not c["dist"]]
    full = [c for c in clean if c["m1"] >= M1_THRESHOLD and c["m2"] >= M2_THRESHOLD]
    slow = [c for c in clean if c["m1"] >= M1_THRESHOLD and c["m2"] < M2_THRESHOLD]
    failing = [c for c in clean if c["m1"] < M1_THRESHOLD]
    print(f"groups: full {len(full)}, slow {len(slow)}, failing {len(failing)}, disturbed {len(disturbed)}")

    by_id = {c["id"]: c for c in cand}
    if not os.environ.get("RESELECT"):
        chosen = [by_id[i] for i in DEMO_PLOTS]
    else:
        chosen = pick_demo_plots(clean, full, slow, failing, disturbed, by_closeness)
        print("re-selected:", [c["id"] for c in chosen])

    # --- outputs
    names = json.loads((CACHE_DIR / "names.json").read_text(encoding="utf-8")) if (CACHE_DIR / "names.json").exists() else {}
    used: dict[str, int] = {}
    features, results = [], {}
    windows = {p: PERIODS[p] for p in meta["periods"]}

    def friendly(cell, suffix):
        lon, lat = centroid(cell)
        base = place_name(lon, lat, names)
        used[base] = used.get(base, 0) + 1
        return f"{base} {suffix}" + (f" {used[base]}" if used[base] > 1 else "")

    control_ids = []
    for c in controls:
        cid = f"ctrl-{c['id']}"
        control_ids.append(cid)
        features.append(feature(c, cid, friendly(c, "control"), "control", None, None, []))
        results[cid] = {"chainId": None, "periods": periods_out(c, None), "milestones": [], "disturbance": None}

    for chain_id, c in enumerate(chosen):
        pid = f"plot-{c['id']}"
        sev = severity_class(c["dnbr"])
        assisted = sev == "high" and c["m1"] < M1_THRESHOLD
        plan = "ASSISTED" if assisted else "NATURAL_REGEN"
        features.append(feature(c, pid, friendly(c, "slope"), "plot", chain_id, plan, control_ids))
        twins = twins_out(c["twins"])

        base = {"plotId": pid, "method": METHOD_VERSION, "dataset": "sentinel-2-l2a (Microsoft Planetary Computer)",
                "compositeWindows": windows, "twins": twins,
                "nbr": {p: c["periods"][p]["nbr"] for p in meta["periods"]}}
        milestones = []  # built by 07_milestones.py, which also needs the quarterly pulse
        dist = None
        if c["dist"]:
            ddoc = {**base, "kind": "disturbance", "year": c["dist"]["year"], "drop": c["dist"]["drop"],
                    "threshold": DISTURBANCE_DROP}
            dist = {"flagged": True, **c["dist"], "evidenceHash": write_evidence(ddoc)}
        results[pid] = {"chainId": chain_id, "periods": periods_out(c, c["rec"]), "milestones": milestones,
                        "disturbance": dist, "twins": twins}

    (CACHE_DIR / "names.json").write_text(json.dumps(names, ensure_ascii=False, indent=1), encoding="utf-8")
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "plots.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA_DIR / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    # flat list for contracts/script/Deploy.s.sol (keys sorted: forge decodes JSON objects alphabetically)
    chain_plots = [{"areaHa": round(p["areaHa"]), "chainId": p["chainId"], "id": p["id"], "name": p["name"],
                    "planType": 1 if p["planType"] == "ASSISTED" else 0}
                   for f in features if (p := f["properties"])["kind"] == "plot"]
    (DATA_DIR / "chain_plots.json").write_text(json.dumps({"plots": chain_plots}, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n{'id':16s} {'name':28s} {'plan':14s} {'sev':14s} {M1_PERIOD:>6s} {M2_PERIOD:>6s} disturbance")
    for f in features:
        p = f["properties"]
        r = results[p["id"]]
        a1, a2 = r["periods"][M1_PERIOD]["adj"], r["periods"][M2_PERIOD]["adj"]
        cols = " ".join(f"{v:6.2f}" if v is not None else " " * 6 for v in (a1, a2))
        d = r["disturbance"]["year"] if r["disturbance"] else ""
        print(f"{p['id']:16s} {p['name']:28s} {p['planType']!s:14s} {p['severity']['class']:14s} {cols} {d}")


def pick_demo_plots(clean, full, slow, failing, disturbed, by_closeness) -> list[dict]:
    chosen: list[dict] = []
    # disturbed first: rare, and it often sits near failing plots that would otherwise crowd it out
    chosen += pick_spread(sorted(disturbed, key=lambda c: -c["dist"]["drop"]), 1, chosen)
    high = [c for c in full if severity_class(c["dnbr"]) == "high"]
    chosen += pick_spread(by_closeness(high, "m2", float(np.median([c["m2"] for c in high]))) if high else [], 1, chosen)
    chosen += pick_spread(by_closeness(full, "m2", float(np.median([c["m2"] for c in full]))) if full else [], 2, chosen)
    chosen += pick_spread(by_closeness(slow, "m2", float(np.median([c["m2"] for c in slow]))) if slow else [], 2, chosen)
    chosen += pick_spread(sorted(failing, key=lambda c: c["m1"]) if failing else [], 2, chosen)
    return chosen


def twins_out(twins: list[dict]) -> dict:
    """Matched controls of a plot: ids, mean NBR per period and how they were chosen (goes into evidence)."""
    return {"method": f"{matching.METHOD}, k={matching.K}", "covariates": matching.COVARIATES, "dem": matching.DEM,
            "ids": [t["id"] for t in twins],
            "nbr": {p: round(v, 4) for p, v in matching.mean_nbr(twins).items()}}


def feature(cell, fid, name, kind, chain_id, plan, control_ids) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [polygon(cell)]},
        "properties": {
            "id": fid, "name": name, "kind": kind, "chainId": chain_id, "planType": plan,
            "areaHa": round((cell["bounds"][2] - cell["bounds"][0]) * (cell["bounds"][3] - cell["bounds"][1]) / 1e4, 1),
            "severity": {"meanDnbr": cell["dnbr"], "class": severity_class(cell["dnbr"]), "pctByClass": cell["sevFrac"]},
            "controlIds": control_ids,
            "centroid": centroid(cell),
            "utmBounds": cell["bounds"],
        },
    }


def periods_out(cell, rec) -> dict:
    return {p: {"ndvi": v["ndvi"], "nbr": v["nbr"],
                "rr": round(rec[p]["rr"], 4) if rec and p in rec else None,
                "adj": round(rec[p]["adj"], 4) if rec and p in rec else None}
            for p, v in cell["periods"].items()}


if __name__ == "__main__":
    Path(DATA_DIR).mkdir(exist_ok=True)
    main()
