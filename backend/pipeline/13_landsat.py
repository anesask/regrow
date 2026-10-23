"""Cross-sensor check: re-measure recovery with Landsat 8/9 and compare with Sentinel-2.

Payouts rest on the Sentinel-2 recovery score. If the score measures the land and not the instrument, an independent
sensor (Landsat 8/9 OLI, 30 m, different orbit, calibration and processing chain) must give the same answer. For each
burned forest cell we build the same seasonal median composites from Landsat Collection 2 Level-2 (cloud, shadow and
snow masked with QA_PIXEL), compute NBR = (NIR - SWIR2) / (NIR + SWIR2) and the recovery score against the same matched
controls (twins, pipeline/matching.py), and compare it with the Sentinel-2 score cell by cell.

Output: data/landsat.json   Cache: cache/landsat/<period>.tif
Usage: uv run python pipeline/13_landsat.py
"""

import json

import matching
import numpy as np
import rioxarray

from common import BBOX, BURN_THRESHOLD, CACHE_DIR, CRS, DATA_DIR, PERIODS, load_composite

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
LANDSAT_PERIODS = ["pre", "post", "2023", "2026"]
MAX_CLOUD = 40
# QA_PIXEL bits: 1 dilated cloud, 2 cirrus, 3 cloud, 4 cloud shadow, 5 snow
QA_MASK = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5)
TARGETS = {"2023": 0.30, "2026": 0.60}
MIN_VALID = 0.5  # share of clear Landsat pixels needed in a cell


def composite(period: str):
    """Seasonal median NBR on our 20 m grid, cached as GeoTIFF."""
    path = CACHE_DIR / "landsat" / f"{period}.tif"
    grid = load_composite("pre").B08
    if path.exists():
        return rioxarray.open_rasterio(path).values[0]
    import odc.stac
    import planetary_computer
    import pystac_client

    start, end = PERIODS[period]
    items = pystac_client.Client.open(STAC_URL, modifier=planetary_computer.sign_inplace).search(
        collections=["landsat-c2-l2"], bbox=BBOX, datetime=f"{start}/{end}",
        query={"eo:cloud_cover": {"lt": MAX_CLOUD}, "platform": {"in": ["landsat-8", "landsat-9"]}}).item_collection()
    print(f"{period}: {len(items)} Landsat scenes")
    ds = odc.stac.load(items, bands=["nir08", "swir22", "qa_pixel"], bbox=BBOX, crs=CRS, resolution=30,
                       groupby="solar_day", chunks={"x": 1024, "y": 1024})
    scale = lambda b: b.where(b > 0) * 0.0000275 - 0.2  # Collection 2 surface reflectance scaling
    nir, swir = scale(ds.nir08), scale(ds.swir22)
    clear = (ds.qa_pixel & QA_MASK) == 0
    nbr = ((nir - swir) / (nir + swir)).where(clear).median("time").compute()
    nbr = nbr.rio.write_crs(CRS).rio.reproject_match(grid)
    path.parent.mkdir(exist_ok=True)
    nbr.astype("float32").rio.to_raster(path)
    return nbr.values


def main() -> None:
    meta = json.loads((CACHE_DIR / "cells.json").read_text(encoding="utf-8"))
    cells, px = meta["cells"], meta["cellPx"]
    nbr = {p: composite(p) for p in LANDSAT_PERIODS}

    def cell_nbr(c: dict) -> dict[str, float] | None:
        r0, c0 = c["row"] * px, c["col"] * px
        out = {}
        for p, a in nbr.items():
            b = a[r0:r0 + px, c0:c0 + px]
            ok = np.isfinite(b)
            if ok.mean() < MIN_VALID:
                return None
            out[p] = float(b[ok].mean())
        return out

    burned = [c for c in cells if c["fracScar"] >= 0.95 and c["fracLand"] >= 0.9 and c["periods"]["pre"]["ndvi"] >= 0.45
              and c["dnbr"] >= BURN_THRESHOLD and c["periods"]["pre"]["nbr"] - c["periods"]["post"]["nbr"] >= 0.15]
    m = matching.Matcher(cells, burned)
    rows, skipped = [], 0
    for c in burned:
        twins = m.twins(c)
        ls = cell_nbr(c)
        lt = [t for t in (cell_nbr(t) for t in twins) if t]
        if not ls or len(lt) < len(twins) // 2:
            skipped += 1
            continue
        ctrl = {p: float(np.mean([t[p] for t in lt])) for p in LANDSAT_PERIODS}
        s2 = {p: c["periods"][p]["nbr"] for p in LANDSAT_PERIODS}
        s2c = matching.mean_nbr(twins)
        row = {"id": c["id"], "lossS2": s2["pre"] - s2["post"], "lossL8": ls["pre"] - ls["post"]}
        for y in TARGETS:
            row[f"s2_{y}"] = ((s2[y] - s2["post"]) - (s2c[y] - s2c["pre"])) / (s2["pre"] - s2["post"])
            row[f"l8_{y}"] = ((ls[y] - ls["post"]) - (ctrl[y] - ctrl["pre"])) / (ls["pre"] - ls["post"])
        rows.append(row)

    def compare(a: str, b: str) -> dict:
        x, y = np.array([r[a] for r in rows]), np.array([r[b] for r in rows])
        return {"pearsonR": round(float(np.corrcoef(x, y)[0, 1]), 3), "meanDiff": round(float(np.mean(y - x)), 3),
                "medianAbsDiff": round(float(np.median(np.abs(y - x))), 3)}

    out = {"product": "Landsat 8/9 Collection 2 Level-2 (Microsoft Planetary Computer), 30 m",
           "periods": LANDSAT_PERIODS, "cells": len(rows), "skippedCloudy": skipped,
           "burnLoss": compare("lossS2", "lossL8")}
    for y, target in TARGETS.items():
        s2_pass = np.array([r[f"s2_{y}"] >= target for r in rows])
        l8_pass = np.array([r[f"l8_{y}"] >= target for r in rows])
        out[y] = {**compare(f"s2_{y}", f"l8_{y}"), "targetAgreement": round(float((s2_pass == l8_pass).mean()), 3),
                  "scatter": [[round(r[f"s2_{y}"], 4), round(r[f"l8_{y}"], 4)] for r in rows]}
    (DATA_DIR / "landsat.json").write_text(json.dumps(out), encoding="utf-8")
    print(json.dumps({k: (v if not isinstance(v, dict) else {kk: vv for kk, vv in v.items() if kk != "scatter"}) for k, v in out.items()}, indent=1))


if __name__ == "__main__":
    main()
