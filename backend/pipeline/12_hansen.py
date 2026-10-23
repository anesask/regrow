"""Independent check of the disturbance detector against Hansen/UMD Global Forest Change (GFC v1.13, loss to 2025).

GFC maps stand-replacing tree-cover loss at 30 m from Landsat with the year it happened. It records only the FIRST loss
year of a pixel, so inside the burn scar the fire itself is "loss 2021" and later salvage logging on those pixels is
invisible. We therefore validate where GFC can see:

A. The fire: share of each dNBR severity class that GFC also records as lost in 2021, and how much of GFC's 2021 loss
   in the study area lies inside our perimeter.
B. The detector on unburned forest (the 1,760 donor cells): later clearing in GFC (2022-2025) vs our year-over-year
   NBR drop net of matched controls (twins at least 3 km away, as in the placebo test of step 11). ROC-AUC of the drop
   as a score, precision and recall of the flag rule, recall by clearing size.
C. The 6 placebo flags of step 11: do they coincide with real clearing?
D. Burned cells: GFC loss in 2022-2025 of pixels that survived the fire, for cells whose quarterly check-ins detected
   damage vs cells that passed (backtest, step 08).

Inputs: cache/hansen/*.tif (download, see HANSEN_URL), cache/cells.json, cache/scar.tif, cache/dnbr.tif,
        data/backtest.geojson. Output: data/hansen.json
Usage: uv run python pipeline/12_hansen.py
"""

import itertools
import json
import urllib.request

import matching
import numpy as np
import rioxarray
from rasterio.enums import Resampling
from sklearn.metrics import roc_auc_score, roc_curve

from common import BBOX, CACHE_DIR, DATA_DIR, PIXEL_HA, SEVERITY, load_composite

VERSION = "GFC-2025-v1.13"
HANSEN_URL = "https://storage.googleapis.com/earthenginepartners-hansen/{v}/Hansen_{v}_{layer}_40N_030E.tif"
TREE_COVER = 30  # % canopy in 2000 counted as forest (GFC convention)
CLEARED = 0.10  # a cell counts as cleared if GFC loss 2022-2025 covers >= 10% of it (6.4 ha)
FLAG_DROP = 0.15  # disturbance rule of 04 (year-over-year NBR drop beyond the controls)
CHECKIN_DROP = 0.10
YEARS = ["post", "2022", "2023", "2024", "2025", "2026"]


def hansen(layer: str, grid) -> np.ndarray:
    path = CACHE_DIR / "hansen" / f"Hansen_{VERSION}_{layer}_40N_030E.tif"
    if not path.exists():
        path.parent.mkdir(exist_ok=True)
        urllib.request.urlretrieve(HANSEN_URL.format(v=VERSION, layer=layer), path)
    lon0, lat0, lon1, lat1 = BBOX
    da = rioxarray.open_rasterio(path).rio.clip_box(lon0 - 0.05, lat0 - 0.05, lon1 + 0.05, lat1 + 0.05)
    return da.rio.reproject_match(grid, resampling=Resampling.nearest).values[0]


def block(a: np.ndarray, c: dict, px: int) -> np.ndarray:
    r0, c0 = c["row"] * px, c["col"] * px
    return a[r0:r0 + px, c0:c0 + px]


def main() -> None:
    meta = json.loads((CACHE_DIR / "cells.json").read_text(encoding="utf-8"))
    cells, px = meta["cells"], meta["cellPx"]
    grid = load_composite("pre").B08
    loss = hansen("lossyear", grid)  # 0 = no loss, 21 = 2021, ...
    tc = hansen("treecover2000", grid)
    scar = rioxarray.open_rasterio(CACHE_DIR / "scar.tif").values[0].astype(bool)
    dnbr = rioxarray.open_rasterio(CACHE_DIR / "dnbr.tif").values[0]
    forest = tc >= TREE_COVER

    # ---------------- A. the fire
    lost21 = loss == 21
    by_class, lo = {}, -np.inf
    for hi, name in SEVERITY:
        m = forest & (dnbr >= lo) & (dnbr < hi)
        by_class[name] = {"forestHa": round(float(m.sum() * PIXEL_HA)), "lostIn2021": round(float((m & lost21).mean() / max(m.mean(), 1e-12)), 3)}
        lo = hi
    fire = {
        "gfcLoss2021Ha": round(float(lost21.sum() * PIXEL_HA)),
        "gfcLoss2021InsidePerimeter": round(float((lost21 & scar).sum() / max(lost21.sum(), 1)), 3),
        "perimeterForestLost2021": round(float((lost21 & scar & forest).sum() / max((scar & forest).sum(), 1)), 3),
        "bySeverity": by_class,
    }

    # ---------------- B + C. the detector on unburned forest
    burned = [c for c in cells if c["fracScar"] >= 0.95 and c["fracLand"] >= 0.9 and c["periods"]["pre"]["ndvi"] >= 0.45
              and c["dnbr"] >= 0.27 and c["periods"]["pre"]["nbr"] - c["periods"]["post"]["nbr"] >= 0.15]
    m = matching.Matcher(cells, burned)
    rows = []
    for c in m.donors:
        ctrl = matching.mean_nbr(m.twins(c, exclude_km=3.0))
        nbr = {y: c["periods"][y]["nbr"] for y in YEARS}
        drops = {cur: (nbr[prev] - nbr[cur]) - (ctrl[prev] - ctrl[cur]) for prev, cur in itertools.pairwise(YEARS)}
        lb = block(loss, c, px)
        frac = {y: float((lb == y - 2000).mean()) for y in range(2022, 2026)}
        rows.append({"id": c["id"], "maxDrop": max(drops.values()), "flagYear": next((y for y, d in drops.items() if d > FLAG_DROP), None),
                     "gfc": frac, "gfcTotal": sum(frac.values())})
    y_true = np.array([r["gfcTotal"] >= CLEARED for r in rows])
    score = np.array([r["maxDrop"] for r in rows])
    flag = np.array([r["flagYear"] is not None for r in rows])
    tp = int((flag & y_true).sum())

    def recall_at(lo_, hi_):
        sel = [(r["gfcTotal"] >= lo_) and (r["gfcTotal"] < hi_) for r in rows]
        n = sum(sel)
        return {"cells": n, "recall": round(sum(f for f, s in zip(flag, sel, strict=True) if s) / n, 3) if n else None}

    def at(t: float) -> dict:
        f = score > t
        return {"threshold": t, "flagged": int(f.sum()), "precision": round(float((f & y_true).sum() / max(f.sum(), 1)), 3),
                "recall": round(float((f & y_true).sum() / max(y_true.sum(), 1)), 3),
                "falseFlagRate": round(float((f & ~y_true).sum() / max((~y_true).sum(), 1)), 4)}

    fpr, tpr, _ = roc_curve(y_true, score)
    idx = np.unique(np.linspace(0, len(fpr) - 1, 60).astype(int))
    year_match = []
    for r in rows:
        if r["flagYear"] and r["gfcTotal"] >= CLEARED:
            gy = max(r["gfc"], key=r["gfc"].get)  # main GFC loss year
            fy = int(r["flagYear"])  # summer composite where the drop appeared
            year_match.append(fy in (gy, gy + 1))
    detector = {
        "cells": len(rows),
        "clearedCells": int(y_true.sum()),
        "clearedDefinition": f"GFC loss 2022-2025 covers >= {int(CLEARED * 100)}% of the 64 ha cell",
        "rocAucMaxDrop": round(float(roc_auc_score(y_true, score)), 3),
        "flagRule": f"year-over-year NBR drop > {FLAG_DROP} beyond matched controls",
        "flagged": int(flag.sum()),
        "precision": round(tp / max(int(flag.sum()), 1), 3),
        "recall": round(tp / max(int(y_true.sum()), 1), 3),
        "recallBySize": {"10-25%": recall_at(0.10, 0.25), "25-50%": recall_at(0.25, 0.50), ">=50%": recall_at(0.50, 2.0)},
        "roc": [[round(float(fpr[i]), 3), round(float(tpr[i]), 3)] for i in idx],
        "thresholds": [at(t) for t in (0.05, 0.075, 0.10, 0.125, 0.15, 0.20)],
        "flagYearMatchesGfc": round(sum(year_match) / len(year_match), 3) if year_match else None,
        "falseFlagsOnUntouchedForest": int((flag & (np.array([r["gfcTotal"] for r in rows]) == 0)).sum()),
        "flaggedCells": [{"id": r["id"], "flagYear": r["flagYear"], "maxDrop": round(r["maxDrop"], 3),
                          "gfcLoss2022_2025": round(r["gfcTotal"], 3)} for r in rows if r["flagYear"]],
    }

    # ---------------- D. burned cells: later loss of trees that survived the fire
    bt = {f["properties"]["id"]: f["properties"] for f in json.loads((DATA_DIR / "backtest.geojson").read_text(encoding="utf-8"))["features"]}
    surv = []
    for c in burned:
        lb, fb = block(loss, c, px), block(forest, c, px)
        alive = fb & ~((lb >= 1) & (lb <= 21))  # forest in 2000 not lost by end of 2021
        later = float(((lb >= 22) & (lb <= 25) & alive).sum() * PIXEL_HA)
        surv.append({"id": c["id"], "damaged": bt[c["id"]]["missedCheckins"] > 0, "outcome": bt[c["id"]]["outcome"], "laterLossHa": later,
                     "severity": next(name for hi, name in SEVERITY if c["dnbr"] < hi)})
    dmg = [s["laterLossHa"] for s in surv if s["damaged"]]
    cln = [s["laterLossHa"] for s in surv if not s["damaged"]]
    survivors = {
        "cells": len(surv),
        "checkinDamaged": len(dmg),
        "meanLaterLossHa": {"checkinDamaged": round(float(np.mean(dmg)), 2), "passed": round(float(np.mean(cln)), 2)},
        "shareWithLaterLoss1ha": {"checkinDamaged": round(float(np.mean(np.array(dmg) >= 1)), 3), "passed": round(float(np.mean(np.array(cln) >= 1)), 3)},
        "rocAuc": round(float(roc_auc_score([s["damaged"] for s in surv], [s["laterLossHa"] for s in surv])), 3),
        "note": "GFC loss in 2022-2025 of pixels still forest after 2021; may include delayed fire mortality as well as logging",
        "bySeverityOutcome": [
            {"severity": sev, "outcome": o, "cells": len(g), "meanLaterLossHa": round(float(np.mean([s["laterLossHa"] for s in g])), 1)}
            for sev in ("moderate-low", "moderate-high", "high") for o in ("restored", "partial", "failed")
            if (g := [s for s in surv if s["severity"] == sev and s["outcome"] == o])
        ],
    }

    out = {"product": f"Hansen/UMD Global Forest Change {VERSION} (30 m, loss to 2025)", "treeCoverThreshold": TREE_COVER,
           "fire": fire, "detector": detector, "survivors": survivors}
    (DATA_DIR / "hansen.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
