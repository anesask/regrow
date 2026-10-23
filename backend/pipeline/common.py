"""Shared config for the ReGrow satellite pipeline (see brief §8)."""

from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
CACHE_DIR = BACKEND_DIR / "cache"  # large rasters, gitignored
DATA_DIR = BACKEND_DIR / "data"  # committed outputs served by the API

# Manavgat 2021 fire, approximate; confirm against dNBR and widen if needed
BBOX = (31.2, 36.7, 31.9, 37.2)  # lon_min, lat_min, lon_max, lat_max
CRS = "EPSG:32636"
RESOLUTION = 20  # metres; B12 is native 20 m

BANDS = ["B02", "B03", "B04", "B08", "B12", "SCL"]
MAX_CLOUD = 20
# SCL classes to drop: no data, saturated, cloud shadow, cloud med/high, cirrus, snow
SCL_MASK = [0, 1, 3, 8, 9, 10, 11]

# Same season each year to avoid phenology effects
PERIODS = {
    "pre": ("2021-06-15", "2021-07-27"),
    "post": ("2021-08-15", "2021-09-30"),
    **{str(y): (f"{y}-06-01", f"{y}-09-30") for y in range(2022, 2027)},
}
FALLBACK_PRE = ("2020-06-01", "2020-09-30")

# dNBR severity classes (Key & Benson / USGS)
SEVERITY = [
    (0.10, "unburned"),
    (0.27, "low"),
    (0.44, "moderate-low"),
    (0.66, "moderate-high"),
    (float("inf"), "high"),
]


def composite_path(period: str) -> Path:
    return CACHE_DIR / "composites" / f"{period}.tif"

LAND_NDVI = 0.15  # pre-fire NDVI below this = water / bare rock / built-up
LAND_NIR = 0.08
BURN_THRESHOLD = 0.27  # dNBR, moderate-low and above
PIXEL_HA = RESOLUTION * RESOLUTION / 10_000


def load_composite(period: str):
    """Composite as an xarray Dataset with variables B02 B03 B04 B08 B12."""
    import rioxarray

    da = rioxarray.open_rasterio(composite_path(period))
    return da.assign_coords(band=list(da.attrs["long_name"])).to_dataset("band")


def nbr(ds):
    return (ds.B08 - ds.B12) / (ds.B08 + ds.B12)


def ndvi(ds):
    return (ds.B08 - ds.B04) / (ds.B08 + ds.B04)
