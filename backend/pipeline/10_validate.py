"""External validation: our Sentinel-2 fire perimeter vs NASA MODIS MCD64A1 burned area (independent product).

MCD64A1 (500 m, monthly) gives the day of year each pixel burned. We take pixels burned between DOY 205 and 230 2021
(the Manavgat fire, which started on 28 July = DOY 209) and compare with our perimeter resampled to the same 500 m grid.

Output: data/validation.json
Usage: uv run python pipeline/10_validate.py
"""

import json

import odc.stac
import planetary_computer
import pystac_client
import rioxarray
from rasterio.enums import Resampling

from common import BBOX, CACHE_DIR, CRS, DATA_DIR

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
DOY_FROM, DOY_TO = 205, 230
REFERENCE_HA = 56_663  # GTÜ mapping via Bianet


def main() -> None:
    items = pystac_client.Client.open(STAC_URL).search(
        collections=["modis-64A1-061"], bbox=BBOX, datetime="2021-07-01/2021-08-31").item_collection()
    ds = odc.stac.load(items, bands=["Burn_Date"], bbox=BBOX, crs=CRS, resolution=500, patch_url=planetary_computer.sign,
                       resampling="nearest")
    bd = ds["Burn_Date"].values
    modis = ((bd >= DOY_FROM) & (bd <= DOY_TO)).any(axis=0)

    scar = rioxarray.open_rasterio(CACHE_DIR / "scar.tif").squeeze().astype("float32")
    grid = ds["Burn_Date"].isel(time=0)
    grid = grid.rio.write_crs(CRS)
    ours = scar.rio.reproject_match(grid, resampling=Resampling.average).values >= 0.5

    px_ha = 500 * 500 / 10_000
    inter = int((ours & modis).sum())
    union = int((ours | modis).sum())
    out = {
        "product": "MODIS MCD64A1 v6.1 burned area (500 m), Microsoft Planetary Computer",
        "items": sorted(i.id for i in items),
        "doyWindow": [DOY_FROM, DOY_TO],
        "oursHa": round(float(ours.sum() * px_ha)),
        "modisHa": round(float(modis.sum() * px_ha)),
        "referenceHa": REFERENCE_HA,
        "iou": round(inter / union, 3) if union else None,
        "oursCoveredByModis": round(inter / max(int(ours.sum()), 1), 3),
        "modisCoveredByOurs": round(inter / max(int(modis.sum()), 1), 3),
        "note": "500 m comparison; small differences at the perimeter are expected from resolution alone",
    }
    (DATA_DIR / "validation.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
