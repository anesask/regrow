"""Grid the study area into square cells and compute per-cell burn severity and
NBR/NDVI for every composite period. Cells become candidate plots (inside the
fire perimeter) or candidate controls (unburned forest nearby).
Output: cache/cells.json

Usage: uv run python pipeline/03_cells.py
"""

import json

import numpy as np
import rioxarray
from scipy import ndimage

from common import (
    CACHE_DIR,
    LAND_NDVI,
    LAND_NIR,
    PERIODS,
    RESOLUTION,
    SEVERITY,
    composite_path,
    load_composite,
    nbr,
    ndvi,
)

CELL_PX = 40  # 40 x 20 m = 800 m square = 64 ha


def block(a: np.ndarray, ny: int, nx: int) -> np.ndarray:
    """(H, W) -> (ny, nx, CELL_PX*CELL_PX) blocks."""
    a = a[: ny * CELL_PX, : nx * CELL_PX]
    return a.reshape(ny, CELL_PX, nx, CELL_PX).swapaxes(1, 2).reshape(ny, nx, -1)


def main() -> None:
    periods = [p for p in PERIODS if composite_path(p).exists()]
    print("periods available:", periods)

    pre = load_composite("pre")
    xs, ys = pre.x.values, pre.y.values
    ny, nx = len(ys) // CELL_PX, len(xs) // CELL_PX

    land = (ndvi(pre).values > LAND_NDVI) & (pre.B08.values > LAND_NIR)
    dnbr = rioxarray.open_rasterio(CACHE_DIR / "dnbr.tif").values[0]
    scar = rioxarray.open_rasterio(CACHE_DIR / "scar.tif").values[0].astype(bool)
    dist_km = ndimage.distance_transform_edt(~scar) * RESOLUTION / 1000

    land_b = block(land, ny, nx)
    frac_land = land_b.mean(-1)
    frac_scar = block(scar, ny, nx).mean(-1)
    dnbr_b = np.where(land_b, block(dnbr, ny, nx), np.nan)
    with np.errstate(all="ignore"):
        dnbr_mean = np.nanmean(dnbr_b, -1)
        sev = {}
        lo = -np.inf
        for hi, name in SEVERITY:
            sev[name] = np.nansum((dnbr_b >= lo) & (dnbr_b < hi), -1) / np.maximum(land_b.sum(-1), 1)
            lo = hi

        series = {}
        for p in periods:
            ds = pre if p == "pre" else load_composite(p)
            series[p] = {
                "nbr": np.nanmean(np.where(land_b, block(nbr(ds).values, ny, nx), np.nan), -1),
                "ndvi": np.nanmean(np.where(land_b, block(ndvi(ds).values, ny, nx), np.nan), -1),
            }
            print(f"  {p}: done")

    half = CELL_PX // 2
    cells = []
    for r in range(ny):
        for c in range(nx):
            if frac_land[r, c] < 0.8:
                continue
            x0 = float(xs[c * CELL_PX]) - RESOLUTION / 2
            y1 = float(ys[r * CELL_PX]) + RESOLUTION / 2
            cells.append({
                "id": f"r{r:02d}c{c:02d}",
                "row": r,
                "col": c,
                "bounds": [x0, y1 - CELL_PX * RESOLUTION, x0 + CELL_PX * RESOLUTION, y1],  # UTM 36N
                "fracLand": round(float(frac_land[r, c]), 3),
                "fracScar": round(float(frac_scar[r, c]), 3),
                "distKm": round(float(dist_km[r * CELL_PX + half, c * CELL_PX + half]), 2),
                "dnbr": round(float(dnbr_mean[r, c]), 4),
                "sevFrac": {k: round(float(v[r, c]), 3) for k, v in sev.items()},
                "periods": {p: {k: round(float(v[r, c]), 4) for k, v in s.items()} for p, s in series.items()},
            })

    out = CACHE_DIR / "cells.json"
    out.write_text(json.dumps({"cellPx": CELL_PX, "periods": periods, "cells": cells}), encoding="utf-8")
    inside = [c for c in cells if c["fracScar"] >= 0.95]
    print(f"{len(cells)} land cells, {len(inside)} fully inside the fire perimeter -> {out}")


if __name__ == "__main__":
    main()
