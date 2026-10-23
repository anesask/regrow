"""Scar-wide backtest + early-warning model.

1. Backtest: apply the exact on-chain rules (15% start, 4 quarterly check-ins, graded 30% / 35% recovery tranches,
   fail below half the target) to every burned forest cell (64 ha) of the Manavgat fire, 2021-2026, as if each had
   been funded with 1,000 FLZ. How much would have been paid, refunded, and how early were failures caught?
2. Early warning (machine learning): using only data available by the end of 2022 (6+ months before the first verdict),
   predict which slopes will not be restored by 2026. Out-of-fold scores (5-fold stratified CV, every cell is scored by
   a model that never saw it), compared with a naive baseline (recovery seen in summer 2022).

Outputs: data/backtest.json (summary, model metrics, per-plot risk), data/backtest.geojson (map layer).
Usage: uv run python pipeline/08_backtest.py   (needs 03_cells.py, 04, and 06_pulse.py --cells)
"""

import json

import matching
import numpy as np
from pyproj import Transformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve
from sklearn.model_selection import StratifiedKFold, cross_val_predict

from common import BURN_THRESHOLD, CACHE_DIR, CRS, DATA_DIR, SEVERITY

FUND = 1_000.0
SCHEDULE = [("start", 0.15), ("2021Q4", 0.05), ("2022Q1", 0.05), ("2022Q2", 0.05), ("2022Q3", 0.05),
            ("2023", 0.30), ("2026", 0.35)]
TARGETS = {"2023": 0.30, "2026": 0.60}
FAIL_BELOW = 0.5
CHECKIN_DROP = 0.10
MIN_VALID = 0.6
BASELINE_Q = {1: "2021Q1", 2: "2021Q2", 3: "2020Q3", 4: "2020Q4"}
FEATURE_QUARTERS = ["2021Q4", "2022Q1", "2022Q2", "2022Q3", "2022Q4"]  # stop at end of 2022: no overlap with the summer-2023 verdict
SEED = 7


def roc_points(y, score, n: int = 60) -> list[list[float]]:
    """ROC curve thinned to about n points for the research page."""
    fpr, tpr, _ = roc_curve(y, score)
    idx = np.unique(np.linspace(0, len(fpr) - 1, n).astype(int))
    return [[round(float(fpr[i]), 3), round(float(tpr[i]), 3)] for i in idx]


def by_severity(rows: list[dict]) -> dict:
    """Backtest outcomes per burn severity class."""
    out: dict[str, dict] = {}
    for r in rows:
        sev = next(name for hi, name in SEVERITY if r["cell"]["dnbr"] < hi)
        outcome = "restored" if r["restored"] and r["paid"] >= FUND * 0.999 else ("partial" if r["restored"] else "failed")
        out.setdefault(sev, {"restored": 0, "partial": 0, "failed": 0})[outcome] += 1
    return out


def main() -> None:
    cells = json.loads((CACHE_DIR / "cells.json").read_text(encoding="utf-8"))["cells"]
    by_id = {c["id"]: c for c in cells}
    features = json.loads((DATA_DIR / "plots.geojson").read_text(encoding="utf-8"))["features"]
    ctrl_ids = [f["properties"]["id"].removeprefix("ctrl-") for f in features if f["properties"]["kind"] == "control"]
    plot_ids = {f["properties"]["id"].removeprefix("plot-"): f["properties"]["name"] for f in features if f["properties"]["kind"] == "plot"}
    pulse = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted((CACHE_DIR / "pulse_cells").glob("*.json"))}
    if len(pulse) < 25:
        raise SystemExit(f"only {len(pulse)} pulse quarters; run 06_pulse.py --cells")

    controls = [by_id[c] for c in ctrl_ids]
    cand = [c for c in cells if c["fracScar"] >= 0.95 and c["fracLand"] >= 0.9 and c["periods"]["pre"]["ndvi"] >= 0.45
            and c["dnbr"] >= BURN_THRESHOLD and c["periods"]["pre"]["nbr"] - c["periods"]["post"]["nbr"] >= 0.15]

    matcher = matching.Matcher(cells, cand)  # annual recovery vs each cell's matched controls, as in 04

    def pv(q, cid):
        v = pulse[q].get(cid)
        return None if not v or v["nbr"] is None or v["validFrac"] < MIN_VALID else v["nbr"]

    def ctrl_q(q):
        vals = [pv(q, c) for c in ctrl_ids]
        vals = [v for v in vals if v is not None]
        return float(np.mean(vals)) if vals else None

    qs = sorted(pulse)
    ctrl_post = float(np.mean([c["periods"]["post"]["nbr"] for c in controls]))
    rows = []
    for c in cand:
        p = c["periods"]
        loss = p["pre"]["nbr"] - p["post"]["nbr"]
        tw = matching.mean_nbr(matcher.twins(c))
        adj = {y: (p[y]["nbr"] - p["post"]["nbr"]) / loss - (tw[y] - tw["pre"]) / loss for y in ("2022", "2023", "2026")}

        # quarterly check-ins: net drop vs previous quarter, regional controls subtracted; cloudy quarters pass
        checks, drops = [], []
        for q in ["2021Q4", "2022Q1", "2022Q2", "2022Q3"]:
            prev_q = qs[qs.index(q) - 1]
            if prev_q == "2021Q3":
                prev, cprev = p["post"]["nbr"], ctrl_post
            else:
                prev, cprev = pv(prev_q, c["id"]), ctrl_q(prev_q)
            now, cnow = pv(q, c["id"]), ctrl_q(q)
            if None in (prev, cprev, now, cnow):
                checks.append(True)
                drops.append(0.0)
                continue
            net = (prev - now) - (cprev - cnow)
            drops.append(net)
            checks.append(net <= CHECKIN_DROP)

        # contract simulation (all funds refundable)
        paid, refunded, alive, failed_at = 0.0, 0.0, True, None
        for (period, share) in SCHEDULE:
            tranche = FUND * share
            if not alive:
                refunded += 0  # already refunded in full at failure
                continue
            if period == "start":
                frac = 1.0
            elif period in TARGETS:
                frac = float(np.clip(adj[period] / TARGETS[period], 0, 1))
            else:
                frac = 1.0 if checks[["2021Q4", "2022Q1", "2022Q2", "2022Q3"].index(period)] else 0.0
            paid += tranche * frac
            refunded += tranche * (1 - frac)
            if period in TARGETS and frac < FAIL_BELOW:
                rest = FUND - paid - refunded
                refunded += rest
                alive, failed_at = False, period
        restored = alive
        caught_q = next((q for q, ok in zip(["2021Q4", "2022Q1", "2022Q2", "2022Q3"], checks, strict=True) if not ok), None)

        # early-warning features: only information available by 2023 Q2
        qadj = []
        for q in FEATURE_QUARTERS:
            base = BASELINE_Q[int(q[-1])]
            pre_q, now_q, cpre, cnow = pv(base, c["id"]), pv(q, c["id"]), ctrl_q(base), ctrl_q(q)
            if None in (pre_q, now_q, cpre, cnow) or pre_q - p["post"]["nbr"] < 0.05:
                qadj.append(np.nan)
            else:
                lq = pre_q - p["post"]["nbr"]
                qadj.append((now_q - p["post"]["nbr"]) / lq - (cnow - cpre) / lq)
        feats = [c["dnbr"], p["pre"]["ndvi"], c["sevFrac"]["high"], c["sevFrac"]["moderate-high"], loss,
                 adj["2022"], max(drops), sum(1 for ok in checks if not ok), *qadj]
        rows.append({"cell": c, "adj": adj, "paid": paid, "refunded": refunded, "restored": restored,
                     "failedAt": failed_at, "caught": caught_q, "missed": sum(1 for ok in checks if not ok),
                     "drop2022": max(drops), "x": feats})

    # ---------------- aggregate backtest
    n = len(rows)
    paid = sum(r["paid"] for r in rows)
    refunded = sum(r["refunded"] for r in rows)
    failures = [r for r in rows if not r["restored"]]
    caught = [r for r in failures if r["caught"]]
    false_alarm = [r for r in rows if r["restored"] and r["missed"] > 0]
    damaged = [r for r in rows if r["drop2022"] > CHECKIN_DROP]
    clean = [r for r in rows if r["drop2022"] <= CHECKIN_DROP]
    fail_rate = lambda rs: sum(1 for r in rs if not r["restored"]) / max(len(rs), 1)

    # ---------------- early-warning model
    X = np.array([r["x"] for r in rows], dtype=float)
    y = np.array([0 if r["restored"] else 1 for r in rows])
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    model = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=300, l2_regularization=1.0,
                                           random_state=SEED)
    risk = cross_val_predict(model, X, y, cv=cv, method="predict_proba")[:, 1]
    base_x = X[:, [5]]  # recovery seen in summer 2022 only
    base_risk = cross_val_predict(LogisticRegression(), base_x, y, cv=cv, method="predict_proba")[:, 1]
    flagged = risk >= 0.5
    tp = int((flagged & (y == 1)).sum())
    metrics = {
        "target": "plot not restored by 2026 (fails at the 2023 or 2026 recovery milestone)",
        "features": "severity, pre-fire NDVI, 2022 summer recovery, quarterly recovery and drops up to 2022 Q4",
        "folds": 5,
        "positives": int(y.sum()),
        "n": len(y),
        "aucModel": round(float(roc_auc_score(y, risk)), 3),
        "aucBaseline": round(float(roc_auc_score(y, base_risk)), 3),
        "apModel": round(float(average_precision_score(y, risk)), 3),
        "apBaseline": round(float(average_precision_score(y, base_risk)), 3),
        "precisionAt50": round(tp / max(int(flagged.sum()), 1), 3),
        "recallAt50": round(tp / max(int(y.sum()), 1), 3),
        "roc": {"model": roc_points(y, risk), "baseline": roc_points(y, base_risk)},
    }

    # ---------------- outputs
    to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    feats_out = []
    per_plot = {}
    for r, rk in zip(rows, risk, strict=True):
        c = r["cell"]
        x0, y0, x1, y1 = c["bounds"]
        ring = [[round(v, 6) for v in to_ll.transform(x, yy)] for x, yy in [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]]
        outcome = "restored" if r["restored"] and r["paid"] >= FUND * 0.999 else ("partial" if r["restored"] else "failed")
        props = {"id": c["id"], "outcome": outcome, "adj2026": round(r["adj"]["2026"], 3), "paid": round(r["paid"], 1),
                 "refunded": round(r["refunded"], 1), "missedCheckins": r["missed"], "caught": r["caught"],
                 "failedAt": r["failedAt"], "risk": round(float(rk), 3)}
        feats_out.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props})
        if c["id"] in plot_ids:
            per_plot["plot-" + c["id"]] = {"risk": props["risk"], "outcome": outcome}
    (DATA_DIR / "backtest.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats_out}), encoding="utf-8")

    summary = {
        "cells": n,
        "hectares": n * 64,
        "fundPerCell": FUND,
        "paidShare": round(paid / (n * FUND), 4),
        "refundedShare": round(refunded / (n * FUND), 4),
        "restored": sum(1 for r in rows if r["restored"] and r["paid"] >= FUND * 0.999),
        "partial": sum(1 for r in rows if r["restored"] and r["paid"] < FUND * 0.999),
        "failed": len(failures),
        "failuresCaughtByCheckins": len(caught),
        "failuresCaughtShare": round(len(caught) / max(len(failures), 1), 4),
        "restoredWithMissedCheckin": len(false_alarm),
        "damaged2022": len(damaged),
        "failRateDamaged": round(fail_rate(damaged), 4),
        "failRateClean": round(fail_rate(clean), 4),
        "riskRatio": round(fail_rate(damaged) / max(fail_rate(clean), 1e-9), 1),
        "monthsEarlier": "check-ins flag damage in 2021 Q4-2022 Q3, 1-4 years before the 2023/2026 recovery verdicts",
        "bySeverity": by_severity(rows),
    }
    out = {"summary": summary, "model": metrics, "plots": per_plot}
    (DATA_DIR / "backtest.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
