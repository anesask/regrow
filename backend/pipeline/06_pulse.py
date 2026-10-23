"""Seasonal pulse: quarterly NBR/NDVI for every plot and control (2020 Q3 → 2026 Q3).

Reads only the area around the plots/controls at 60 m (cloud-optimised GeoTIFF overviews), so each quarter
is a few minutes instead of a full-resolution composite. Output: cache/pulse/<YYYY>Q<n>.json
  {featureId: {"nbr": float, "ndvi": float, "scenes": int, "validFrac": float}}

Usage: uv run python pipeline/06_pulse.py [--cells] [2024Q2 ...]   (no quarters = all, one process each)
  --cells   every burned 64 ha cell + the controls (scar-wide backtest), written to cache/pulse_cells/
Each output also lists the Sentinel-2 scene IDs used (provenance).
"""

import json
import subprocess
import sys

import numpy as np
import odc.stac
import planetary_computer
import pystac_client
from pyproj import Transformer

from common import CACHE_DIR, CRS, DATA_DIR, SCL_MASK

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
RES = 60
MAX_CLOUD = 40
MARGIN_M = 1500
QUARTERS = [f"{y}Q{q}" for y in range(2020, 2027) for q in range(1, 5)]
QUARTERS = QUARTERS[QUARTERS.index("2020Q3"): QUARTERS.index("2026Q3") + 1]
OUT = CACHE_DIR / "pulse"
OUT_CELLS = CACHE_DIR / "pulse_cells"
CELLS_MODE = "--cells" in sys.argv


def quarter_range(q: str) -> tuple[str, str]:
    y, n = int(q[:4]), int(q[-1])
    start = f"{y}-{3 * n - 2:02d}-01"
    end = f"{y}-{3 * n:02d}-{30 if n in (2, 3) else 31}"
    return start, end


def targets() -> dict[str, list[float]]:
    """id -> UTM bounds of every unit to measure."""
    features = json.loads((DATA_DIR / "plots.geojson").read_text(encoding="utf-8"))["features"]
    out = {f["properties"]["id"]: f["properties"]["utmBounds"] for f in features}
    if CELLS_MODE:
        cells = json.loads((CACHE_DIR / "cells.json").read_text(encoding="utf-8"))["cells"]
        out = {c["id"]: c["bounds"] for c in cells if c["fracScar"] >= 0.95 and c["fracLand"] >= 0.9}
        out |= {f["properties"]["id"].removeprefix("ctrl-"): f["properties"]["utmBounds"]
                for f in features if f["properties"]["kind"] == "control"}
    return out


def area(bounds: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [b for bb in bounds for b in (bb[0], bb[2])]
    ys = [b for bb in bounds for b in (bb[1], bb[3])]
    to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    (lon0, lat0), (lon1, lat1) = (to_ll.transform(min(xs) - MARGIN_M, min(ys) - MARGIN_M),
                                  to_ll.transform(max(xs) + MARGIN_M, max(ys) + MARGIN_M))
    return lon0, lat0, lon1, lat1


def build(q: str) -> None:
    out = (OUT_CELLS if CELLS_MODE else OUT) / f"{q}.json"
    if out.exists():
        print(f"[{q}] exists, skipping")
        return
    units = targets()
    bbox = area(list(units.values()))
    start, end = quarter_range(q)
    items = pystac_client.Client.open(STAC_URL).search(
        collections=["sentinel-2-l2a"], bbox=bbox, datetime=f"{start}/{end}",
        query={"eo:cloud_cover": {"lt": MAX_CLOUD}},
    ).item_collection()
    print(f"[{q}] {len(items)} scenes {start}..{end}", flush=True)
    if not items:
        raise SystemExit(f"no scenes for {q}")

    ds = odc.stac.load(items, bands=["B04", "B08", "B12", "SCL"], bbox=bbox, crs=CRS, resolution=RES,
                       groupby="solar_day", chunks={}, patch_url=planetary_computer.sign,
                       resampling={"SCL": "nearest", "*": "average"})
    valid = ~ds["SCL"].isin(SCL_MASK)
    off = np.where(ds["time"].values >= np.datetime64("2022-01-25"), 1000.0, 0.0)
    off = ds["time"].copy(data=off)
    b = {k: ((ds[k] - off) / 10000.0).where(valid) for k in ("B04", "B08", "B12")}
    nbr = ((b["B08"] - b["B12"]) / (b["B08"] + b["B12"])).median("time", skipna=True).compute()
    ndvi = ((b["B08"] - b["B04"]) / (b["B08"] + b["B04"])).median("time", skipna=True).compute()

    result = {"_items": sorted(i.id for i in items)}
    for uid, (x0, y0, x1, y1) in units.items():
        cell = {"x": slice(x0, x1), "y": slice(y1, y0)}
        n, v = nbr.sel(**cell).values, ndvi.sel(**cell).values
        ok = np.isfinite(n)
        result[uid] = {
            "nbr": round(float(np.nanmean(n)), 4) if ok.any() else None,
            "ndvi": round(float(np.nanmean(v)), 4) if ok.any() else None,
            "validFrac": round(float(ok.mean()), 3),
            "scenes": len(items),
        }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result), encoding="utf-8")
    print(f"[{q}] wrote {out}", flush=True)


def main() -> None:
    quarters = [a for a in sys.argv[1:] if not a.startswith("--")] or QUARTERS
    if len(quarters) > 1:
        # one process per quarter: Planetary Computer SAS tokens expire after ~1 h and are cached per process
        flags = ["--cells"] if CELLS_MODE else []
        for q in quarters:
            subprocess.run([sys.executable, __file__, *flags, q], check=False)
        return
    build(quarters[0])


if __name__ == "__main__":
    main()
