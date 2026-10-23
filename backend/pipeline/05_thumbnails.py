"""Render images for the app from the composites:
  data/img/overview/<period>_rgb.webp     whole fire area, Web Mercator, for the map year slider
  data/overview.json                      overlay bounds + periods
  data/img/timelapse/<period>.webp        lighter copies of the overview frames for the landing-page time-lapse
  data/img/<plotId>/<period>_rgb.webp     true colour around each plot/control
  data/img/<plotId>/<period>_nbr.webp     NBR (red = burned, green = vegetated)
One fixed colour stretch for all years, so images are comparable.

Usage: uv run python pipeline/05_thumbnails.py
"""

import json

import matplotlib
import numpy as np
import rioxarray
from PIL import Image, ImageDraw
from pyproj import Transformer
from rasterio.enums import Resampling

from common import CACHE_DIR, CRS, DATA_DIR, PERIODS, RESOLUTION, composite_path, load_composite, nbr

OVERVIEW_MARGIN_M = 3000
OVERVIEW_MAX_PX = 1800
PLOT_MARGIN_M = 1200
THUMB_PX = 320
NBR_RANGE = (-0.3, 0.6)
GAMMA = 0.8


def rgb_stretch(pre) -> tuple[np.ndarray, np.ndarray]:
    """Per-band 2-98 % reflectance range from the pre-fire composite, reused for every year."""
    bands = np.stack([pre.B04.values, pre.B03.values, pre.B02.values])
    lo = np.nanpercentile(bands, 2, axis=(1, 2))
    hi = np.nanpercentile(bands, 98, axis=(1, 2))
    return lo[:, None, None], hi[:, None, None]


def to_rgb(r, g, b, lo, hi) -> np.ndarray:
    arr = (np.stack([r, g, b]) - lo) / (hi - lo)
    arr = np.clip(arr, 0, 1) ** GAMMA
    out = (np.moveaxis(arr, 0, -1) * 255).astype(np.uint8)
    alpha = np.where(np.isfinite(r), 255, 0).astype(np.uint8)
    return np.dstack([out, alpha])


def save(img: np.ndarray | Image.Image, path, quality=82) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im = img if isinstance(img, Image.Image) else Image.fromarray(img)
    im.save(path, "WEBP", quality=quality, method=6)


def overview(periods, lo, hi) -> None:
    scar = rioxarray.open_rasterio(CACHE_DIR / "scar.tif").squeeze()
    ys, xs = np.nonzero(scar.values)
    x0 = float(scar.x[xs.min()]) - OVERVIEW_MARGIN_M
    x1 = float(scar.x[xs.max()]) + OVERVIEW_MARGIN_M
    y0 = float(scar.y[ys.max()]) - OVERVIEW_MARGIN_M
    y1 = float(scar.y[ys.min()]) + OVERVIEW_MARGIN_M

    bounds = None
    for p in periods:
        da = rioxarray.open_rasterio(composite_path(p)).rio.clip_box(x0, y0, x1, y1)
        da = da.assign_coords(band=list(da.attrs["long_name"]))
        merc = da.sel(band=["B04", "B03", "B02"]).rio.reproject("EPSG:3857", resampling=Resampling.bilinear,
                                                                   nodata=np.nan)
        img = to_rgb(*merc.values, lo, hi)
        h, w = img.shape[:2]
        scale = min(1.0, OVERVIEW_MAX_PX / max(h, w))
        im = Image.fromarray(img).resize((round(w * scale), round(h * scale)), Image.LANCZOS)
        save(im, DATA_DIR / "img" / "overview" / f"{p}_rgb.webp", quality=80)
        if bounds is None:
            left, bottom, right, top = merc.rio.bounds()
            to_ll = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
            (w_lon, s_lat), (e_lon, n_lat) = to_ll.transform(left, bottom), to_ll.transform(right, top)
            bounds = [[round(s_lat, 6), round(w_lon, 6)], [round(n_lat, 6), round(e_lon, 6)]]
        print(f"  overview {p}: {im.size}")
    (DATA_DIR / "overview.json").write_text(json.dumps({"bounds": bounds, "periods": periods, "crs": CRS}), encoding="utf-8")


def plot_thumbs(periods, lo, hi) -> None:
    fc = json.loads((DATA_DIR / "plots.geojson").read_text(encoding="utf-8"))
    cmap = matplotlib.colormaps["RdYlGn"]
    datasets = {p: load_composite(p) for p in periods}
    for f in fc["features"]:
        pid = f["properties"]["id"]
        bx0, by0, bx1, by1 = f["properties"]["utmBounds"]
        wx0, wy0, wx1, wy1 = bx0 - PLOT_MARGIN_M, by0 - PLOT_MARGIN_M, bx1 + PLOT_MARGIN_M, by1 + PLOT_MARGIN_M
        size_m = wx1 - wx0
        # plot outline in output pixel coordinates
        k = THUMB_PX / size_m
        rect = [(bx0 - wx0) * k, (wy1 - by1) * k, (bx1 - wx0) * k, (wy1 - by0) * k]
        for p, ds in datasets.items():
            sub = ds.sel(x=slice(wx0, wx1), y=slice(wy1, wy0))
            rgb = Image.fromarray(to_rgb(sub.B04.values, sub.B03.values, sub.B02.values, lo, hi))
            n = nbr(sub).values
            nbr_img = (cmap(np.clip((n - NBR_RANGE[0]) / (NBR_RANGE[1] - NBR_RANGE[0]), 0, 1)) * 255).astype(np.uint8)
            for kind, im in (("rgb", rgb), ("nbr", Image.fromarray(nbr_img))):
                im = im.convert("RGBA").resize((THUMB_PX, THUMB_PX), Image.LANCZOS)
                ImageDraw.Draw(im).rectangle(rect, outline=(255, 255, 255, 230), width=2)
                save(im, DATA_DIR / "img" / pid / f"{p}_{kind}.webp")
        print(f"  {pid}: {len(datasets)} periods")


TIMELAPSE_PX = 1100


def timelapse(periods) -> None:
    """Light copies of the overview frames (same stretch, so years compare) for the landing-page time-lapse."""
    out = DATA_DIR / "img" / "timelapse"
    out.mkdir(parents=True, exist_ok=True)
    for p in periods:
        im = Image.open(DATA_DIR / "img" / "overview" / f"{p}_rgb.webp")
        im = im.resize((TIMELAPSE_PX, round(im.height * TIMELAPSE_PX / im.width)), Image.LANCZOS)
        im.save(out / f"{p}.webp", "WEBP", quality=72, method=6)
        print(f"  timelapse {p}: {im.size}, {(out / f'{p}.webp').stat().st_size // 1024} KB")


def main() -> None:
    periods = [p for p in PERIODS if composite_path(p).exists()]
    pre = load_composite("pre")
    lo, hi = rgb_stretch(pre)
    print(f"stretch lo {lo.ravel().round(3)} hi {hi.ravel().round(3)}; pixel {RESOLUTION} m")
    overview(periods, lo, hi)
    timelapse(periods)
    if (DATA_DIR / "plots.geojson").exists():
        plot_thumbs(periods, lo, hi)
    else:
        print("plots.geojson missing: run 04 first for plot thumbnails")


if __name__ == "__main__":
    main()
