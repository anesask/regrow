"""Fetch Sentinel-2 L2A scenes from Planetary Computer and build cloud-masked
median composites per period. Output: cache/composites/<period>.tif
(bands B02 B03 B04 B08 B12 as surface reflectance, float32).

Usage: uv run python pipeline/01_fetch_composites.py [period ...]
"""

import sys

import numpy as np
import odc.stac
import planetary_computer
import pystac_client
from dask.diagnostics import ProgressBar

from common import BANDS, BBOX, CRS, FALLBACK_PRE, MAX_CLOUD, PERIODS, RESOLUTION, SCL_MASK, composite_path

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
MIN_SCENES = 3


def search(catalog, start: str, end: str):
    items = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=BBOX,
        datetime=f"{start}/{end}",
        query={"eo:cloud_cover": {"lt": MAX_CLOUD}},
    ).item_collection()
    return items


def build(catalog, period: str) -> None:
    out = composite_path(period)
    if out.exists():
        print(f"[{period}] exists, skipping")
        return
    start, end = PERIODS[period]
    items = search(catalog, start, end)
    if period == "pre" and len(items) < MIN_SCENES:
        print(f"[pre] only {len(items)} scenes, falling back to {FALLBACK_PRE}")
        items = search(catalog, *FALLBACK_PRE)
    print(f"[{period}] {len(items)} scenes {start}..{end}")
    if not items:
        raise SystemExit(f"no scenes for {period}")

    ds = odc.stac.load(
        items,
        bands=BANDS,
        bbox=BBOX,
        crs=CRS,
        resolution=RESOLUTION,
        groupby="solar_day",
        chunks={"x": 1024, "y": 1024},
        patch_url=planetary_computer.sign,
    )
    valid = ~ds["SCL"].isin(SCL_MASK)
    refl = ds[[b for b in BANDS if b != "SCL"]].where(valid)
    # L2A processing baseline >= 04.00 (from 2022-01-25) adds a +1000 DN offset
    offset = xr_offset(ds)
    refl = ((refl - offset) / 10000.0).clip(0, 1).astype(np.float32)
    comp = refl.median("time", skipna=True)

    da = comp.to_array("band").transpose("band", "y", "x")
    with ProgressBar():
        da = da.compute()
    out.parent.mkdir(parents=True, exist_ok=True)
    da.rio.write_crs(CRS, inplace=True)
    da.attrs["long_name"] = [b for b in BANDS if b != "SCL"]
    da.attrs["scenes"] = len(items)
    da.rio.to_raster(out, compress="deflate")
    print(f"[{period}] wrote {out}")


def xr_offset(ds):
    """Per-scene radiometric offset: 1000 for scenes from 2022-01-25 onward, else 0."""
    import xarray as xr

    t = ds["time"].values
    off = np.where(t >= np.datetime64("2022-01-25"), 1000.0, 0.0)
    return xr.DataArray(off, coords={"time": ds["time"]}, dims="time")


def main() -> None:
    import rioxarray  # noqa: F401  (registers .rio accessor)

    periods = sys.argv[1:] or list(PERIODS)
    if len(periods) > 1:
        # One process per period: Planetary Computer SAS tokens expire after ~1 h and are cached per process
        import subprocess

        for p in periods:
            subprocess.run([sys.executable, __file__, p], check=True)
        return
    build(pystac_client.Client.open(STAC_URL), periods[0])


if __name__ == "__main__":
    main()
