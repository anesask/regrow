"""Robustness of the recovery engine: covariate balance of the matched controls, the bias of the old regional
controls, and a placebo test.

Until method v3 every plot was scored against the same 3 regional control cells, picked partly because their NBR
stayed stable over time (selection on the outcome). Since v3 every cell is scored against its own K twins
(pipeline/matching.py). This step documents why:

1. Balance: standardised mean differences of the covariates before and after matching (|SMD| < 0.1 is the usual bar).
2. Regional vs matched: recovery, outcomes and the recovery tranches of the backtest under both control choices.
3. Placebo: treat every unburned forest cell as if it were a funded plot (twins drawn from other unburned cells at
   least PLACEBO_EXCLUDE_KM away) and apply the disturbance rule. Healthy forest should almost never be flagged. The
   spread of its net NBR change is the noise floor of the method, expressed in recovery points for a typical burned slope.

Inputs: cache/cells.json (03), data/plots.geojson (04), cache/terrain.json (matching.py).
Output: data/robustness.json
Usage: uv run python pipeline/11_matched_controls.py
"""

import importlib
import itertools
import json

import matching
import numpy as np

from common import BURN_THRESHOLD, CACHE_DIR, DATA_DIR

PLACEBO_EXCLUDE_KM = 3.0  # a placebo cell's twins must not be its neighbours
YEARS = ["2022", "2023", "2024", "2025", "2026"]
REGIONAL = ["r13c50", "r28c42", "r50c73"]  # the 3 regional controls of method v2, kept for the comparison

score = importlib.import_module("04_select_and_score")
backtest = importlib.import_module("08_backtest")


def smd(a: np.ndarray, b: np.ndarray, pooled_sd: np.ndarray) -> list[float]:
    return [round(float(x), 3) for x in (a.mean(0) - b.mean(0)) / pooled_sd]


def hist(values, lo: float, hi: float, step: float) -> list[dict]:
    """Histogram with values outside [lo, hi) clamped into the edge bins."""
    edges = np.arange(lo, hi + step / 2, step)
    counts, _ = np.histogram(np.clip(values, lo, hi - 1e-9), bins=edges)
    return [{"x": round(float(e), 3), "n": int(n)} for e, n in zip(edges[:-1], counts, strict=True)]


def first_disturbance(nbr: dict, ctrl: dict) -> dict | None:
    """Same rule as 04: first year-over-year NBR drop > DISTURBANCE_DROP beyond the controls' change."""
    for prev, cur in itertools.pairwise(["post", *YEARS]):
        net = (nbr[prev] - nbr[cur]) - (ctrl[prev] - ctrl[cur])
        if net > score.DISTURBANCE_DROP:
            return {"year": cur, "drop": round(float(net), 4)}
    return None


def recovery_payout(adj: dict) -> tuple[float, str]:
    """Share of a plot paid by the two recovery tranches (max 0.65) and the outcome, using 08's rules."""
    paid = 0.0
    for period, share in backtest.SCHEDULE:
        if period not in backtest.TARGETS:
            continue
        frac = float(np.clip(adj[period] / backtest.TARGETS[period], 0, 1))
        paid += share * frac
        if frac < backtest.FAIL_BELOW:
            return paid, "failed"
    return paid, "restored" if paid >= 0.65 - 1e-9 else "partial"


def main() -> None:
    cells = json.loads((CACHE_DIR / "cells.json").read_text(encoding="utf-8"))["cells"]
    by_id = {c["id"]: c for c in cells}
    features = json.loads((DATA_DIR / "plots.geojson").read_text(encoding="utf-8"))["features"]
    plot_ids = {f["properties"]["id"].removeprefix("plot-"): f["properties"]["id"] for f in features if f["properties"]["kind"] == "plot"}

    burned = [c for c in cells if c["fracScar"] >= 0.95 and c["fracLand"] >= 0.9 and c["periods"]["pre"]["ndvi"] >= score.FOREST_NDVI_PRE
              and c["dnbr"] >= BURN_THRESHOLD and c["periods"]["pre"]["nbr"] - c["periods"]["post"]["nbr"] >= score.MIN_NBR_LOSS]
    m = matching.Matcher(cells, burned)
    donors = m.donors
    print(f"{len(burned)} burned forest cells, {len(donors)} unburned forest donor cells")

    Xb = np.array([m.x(c) for c in burned])
    sd = np.sqrt((Xb.var(0) + m.X.var(0)) / 2)
    regional = matching.mean_nbr([by_id[i] for i in REGIONAL])

    rows, matched_x = [], []
    for c in burned:
        tw = m.twins(c)
        matched_x.append(np.mean([m.x(t) for t in tw], axis=0))
        ctrl = matching.mean_nbr(tw)
        p = {y: v["nbr"] for y, v in c["periods"].items()}
        loss = p["pre"] - p["post"]
        adj = {y: ((p[y] - p["post"]) - (ctrl[y] - ctrl["pre"])) / loss for y in YEARS}
        adj_r = {y: ((p[y] - p["post"]) - (regional[y] - regional["pre"])) / loss for y in YEARS}
        r = {"id": c["id"], "loss": loss, "adj": adj, "adjR": adj_r,
             "dist": first_disturbance(p, ctrl), "distR": first_disturbance(p, regional)}
        r["pay"], r["out"] = recovery_payout(adj)
        r["payR"], r["outR"] = recovery_payout(adj_r)
        rows.append(r)
    matched_x = np.array(matched_x)

    flips: dict[str, int] = {}
    for r in rows:
        if r["outR"] != r["out"]:
            k = f"{r['outR']} -> {r['out']}"
            flips[k] = flips.get(k, 0) + 1
    d26 = np.array([r["adj"]["2026"] - r["adjR"]["2026"] for r in rows])
    dist_r, dist_m = {r["id"] for r in rows if r["distR"]}, {r["id"] for r in rows if r["dist"]}
    nbr_d = {y: np.array([c["periods"][y]["nbr"] for c in donors]) for y in ["pre", *YEARS]}
    drift = {y: {"regionalControls": round(regional[y] - regional["pre"], 4),
                 "allUnburnedForest": round(float((nbr_d[y] - nbr_d["pre"]).mean()), 4)} for y in YEARS}

    # sensitivity to the number of twins, and recovery trajectories per severity class (matched controls)
    k_sens = []
    for k in (3, 5, 10, 15, 20, 30):
        med = []
        for c in burned:
            ctrl = matching.mean_nbr(m.twins(c, k=k))
            p = {y: v["nbr"] for y, v in c["periods"].items()}
            med.append(((p["2026"] - p["post"]) - (ctrl["2026"] - ctrl["pre"])) / (p["pre"] - p["post"]))
        k_sens.append({"k": k, "medianAdj2026": round(float(np.median(med)), 4)})
    traj: dict[str, list] = {}
    for name, sel in [("all", burned), *[(s, [c for c in burned if score.severity_class(c["dnbr"]) == s]) for s in ("moderate-low", "moderate-high", "high")]]:
        ids = {c["id"] for c in sel}
        series = []
        for y in YEARS:
            v = np.array([r["adj"][y] for r in rows if r["id"] in ids])
            series.append({"year": y, "p25": round(float(np.percentile(v, 25)), 4), "median": round(float(np.median(v)), 4),
                           "p75": round(float(np.percentile(v, 75)), 4)})
        traj[name] = {"cells": len(sel), "series": series}

    # placebo: unburned forest treated as if it had been funded
    flagged, flagged_r, net26, max_drop = 0, 0, [], []
    for c in donors:
        ctrl = matching.mean_nbr(m.twins(c, exclude_km=PLACEBO_EXCLUDE_KM))
        p = {y: v["nbr"] for y, v in c["periods"].items()}
        flagged += first_disturbance(p, ctrl) is not None
        flagged_r += first_disturbance(p, regional) is not None
        net26.append((p["2026"] - p["pre"]) - (ctrl["2026"] - ctrl["pre"]))
        max_drop.append(max((p[a] - p[b]) - (ctrl[a] - ctrl[b]) for a, b in itertools.pairwise(["post", *YEARS])))
    net26 = np.array(net26)
    median_loss = float(np.median([r["loss"] for r in rows]))

    n = len(rows)
    out = {
        "method": f"{matching.METHOD}, k={matching.K}",
        "covariates": matching.COVARIATES,
        "dem": matching.DEM,
        "burnedCells": n,
        "donorCells": len(donors),
        "balance": {"smdBefore": smd(Xb, m.X, sd), "smdAfter": smd(Xb, matched_x, sd)},
        "regionalVsMatched": {
            "regionalControls": REGIONAL,
            "medianAdj2026": [round(float(np.median([r["adjR"]["2026"] for r in rows])), 3),
                              round(float(np.median([r["adj"]["2026"] for r in rows])), 3)],
            "outcomeAgreement": round(sum(r["outR"] == r["out"] for r in rows) / n, 4),
            "outcomes": {k: [sum(r["outR"] == k for r in rows), sum(r["out"] == k for r in rows)]
                         for k in ("restored", "partial", "failed")},
            "flips": flips,
            "recoveryPaidShare": [round(sum(r["payR"] for r in rows) / (0.65 * n), 4),
                                  round(sum(r["pay"] for r in rows) / (0.65 * n), 4)],
            "adj2026Diff": {"median": round(float(np.median(d26)), 3), "p05": round(float(np.percentile(d26, 5)), 3),
                            "p95": round(float(np.percentile(d26, 95)), 3)},
            "disturbed": [len(dist_r), len(dist_m), len(dist_r & dist_m)],
            "controlDrift": drift,
        },
        "placebo": {
            "cells": len(donors),
            "excludeKm": PLACEBO_EXCLUDE_KM,
            "rule": f"year-over-year NBR drop > {score.DISTURBANCE_DROP} beyond the controls, 2021-2026",
            "flagged": int(flagged),
            "falseFlagRate": round(flagged / len(donors), 4),
            "flaggedRegionalControls": int(flagged_r),
            "falseFlagRateRegionalControls": round(flagged_r / len(donors), 4),
            "net2026": {"median": round(float(np.median(net26)), 4), "sd": round(float(net26.std()), 4),
                        "p05": round(float(np.percentile(net26, 5)), 4), "p95": round(float(np.percentile(net26, 95)), 4)},
            "medianBurnLoss": round(median_loss, 4),
            "noiseRecoveryPoints": round(100 * float(net26.std()) / median_loss, 1),
            "maxDropHist": hist(max_drop, -0.05, 0.35, 0.01),
        },
        "kSensitivity": k_sens,
        "trajectories": traj,
        "adj2026Hist": {"regional": hist([r["adjR"]["2026"] for r in rows], -0.5, 1.2, 0.05),
                        "matched": hist([r["adj"]["2026"] for r in rows], -0.5, 1.2, 0.05)},
        "plots": {plot_ids[r["id"]]: {"adj2026": [round(r["adjR"]["2026"], 3), round(r["adj"]["2026"], 3)],
                                      "outcome": [r["outR"], r["out"]]} for r in rows if r["id"] in plot_ids},
    }
    (DATA_DIR / "robustness.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
