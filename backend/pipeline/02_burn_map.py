"""Compute dNBR from the pre/post composites, report burn severity areas and
check the burn scar is not clipped by the bbox. Outputs cache/dnbr.tif and
cache/burn_map.png (preview for picking plots).

Usage: uv run python pipeline/02_burn_map.py
"""

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import BoundaryNorm, ListedColormap
from pyproj import Transformer
from scipy import ndimage

from common import BURN_THRESHOLD, CACHE_DIR, CRS, LAND_NDVI, LAND_NIR, PIXEL_HA, SEVERITY, load_composite, nbr, ndvi

REFERENCE_HA = 56_663  # GTÜ mapping via Bianet (brief §11)
CLOSE_ITERS = 5  # x 20 m: bridges gaps up to ~200 m


def main() -> None:
    pre, post = load_composite("pre"), load_composite("post")
    dnbr = (nbr(pre) - nbr(post)).rename("dnbr")
    dnbr.rio.write_crs(CRS, inplace=True)
    dnbr.rio.to_raster(CACHE_DIR / "dnbr.tif", compress="deflate")

    # Land/vegetation mask: water (sea, reservoirs) gives noisy dNBR
    land = (ndvi(pre).values > LAND_NDVI) & (pre.B08.values > LAND_NIR)
    v = np.where(land, dnbr.values, np.nan)
    valid = np.isfinite(v)
    print(f"vegetated land pixels: {valid.mean():.1%}")
    lo = -np.inf
    for hi, name in SEVERITY:
        n = np.count_nonzero(valid & (v >= lo) & (v < hi))
        print(f"  {name:14s} {n * PIXEL_HA:10,.0f} ha")
        lo = hi

    burned = valid & (v > BURN_THRESHOLD)
    print(f"burned (dNBR>{BURN_THRESHOLD}) total in bbox: {burned.sum() * PIXEL_HA:,.0f} ha")

    # Fire perimeter: close gaps in the moderate+ burn mask (low dNBR alone also catches
    # harvested fields), fill holes, keep the largest region
    any_burn = valid & (v > 0.10)
    closed = ndimage.binary_closing(burned, structure=np.ones((3, 3)), iterations=CLOSE_ITERS)
    closed = ndimage.binary_fill_holes(closed)
    labels, n = ndimage.label(closed)
    sizes = ndimage.sum(closed, labels, range(1, n + 1))
    scar = labels == int(np.argmax(sizes)) + 1
    print(f"Manavgat perimeter area: {scar.sum() * PIXEL_HA:,.0f} ha (reference {REFERENCE_HA:,} ha)")
    print(f"  of which dNBR>0.10: {(scar & any_burn).sum() * PIXEL_HA:,.0f} ha, "
          f"dNBR>{BURN_THRESHOLD}: {(scar & burned).sum() * PIXEL_HA:,.0f} ha")
    lo = -np.inf
    for hi, name in SEVERITY:
        n_px = np.count_nonzero(scar & valid & (v >= lo) & (v < hi))
        print(f"  in perimeter {name:14s} {n_px * PIXEL_HA:10,.0f} ha")
        lo = hi
    scar_da = dnbr.copy(data=scar.astype(np.uint8)).rename("scar")
    scar_da.rio.to_raster(CACHE_DIR / "scar.tif", compress="deflate")

    edges = {
        "north": scar[0, :].sum(),
        "south": scar[-1, :].sum(),
        "west": scar[:, 0].sum(),
        "east": scar[:, -1].sum(),
    }
    print("scar pixels touching bbox edge:", edges)

    ys, xs = np.nonzero(scar)
    to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    x0, x1 = dnbr.x.values[xs.min()], dnbr.x.values[xs.max()]
    y0, y1 = dnbr.y.values[ys.max()], dnbr.y.values[ys.min()]
    (lon0, lat0), (lon1, lat1) = to_ll.transform(x0, y0), to_ll.transform(x1, y1)
    print(f"scar extent lon {lon0:.3f}..{lon1:.3f}, lat {lat0:.3f}..{lat1:.3f}")

    # preview: severity classes with a km grid for picking plots
    bounds = [-1, 0.10, 0.27, 0.44, 0.66, 2]
    cmap = ListedColormap(["#1a9850", "#fee08b", "#fdae61", "#f46d43", "#a50026"])
    fig, ax = plt.subplots(figsize=(14, 11), dpi=110)
    x_km = (dnbr.x.values - dnbr.x.values[0]) / 1000
    y_km = (dnbr.y.values - dnbr.y.values[-1]) / 1000
    ext = [x_km[0], x_km[-1], y_km[-1], y_km[0]]
    ax.imshow(v, cmap=cmap, norm=BoundaryNorm(bounds, cmap.N), extent=ext, interpolation="nearest")
    ax.contour(x_km, y_km[::-1], scar[::-1].astype(float), levels=[0.5], colors="blue", linewidths=1)
    ax.set_xlabel("km east of bbox west edge")
    ax.set_ylabel("km north of bbox south edge")
    ax.set_title("Manavgat 2021 dNBR severity (green unburned → dark red high)")
    ax.grid(color="k", alpha=0.25, linewidth=0.5)
    fig.savefig(CACHE_DIR / "burn_map.png", bbox_inches="tight")
    print(f"wrote {CACHE_DIR / 'burn_map.png'}")


if __name__ == "__main__":
    main()
