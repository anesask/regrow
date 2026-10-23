"""Matched controls ("twins"): for every burned cell, the K unburned forest cells most like it before the fire.

Matching uses only pre-fire NBR and NDVI and terrain (elevation, slope, northness from Copernicus DEM GLO-30),
with Mahalanobis distance. Nothing is matched on what happened after the fire, so the controls cannot be chosen for
looking stable. Used by 04 (plot scores), 08 (backtest) and 11 (balance + placebo test).
"""

import json

import numpy as np

from common import BBOX, CACHE_DIR, CRS, RESOLUTION, load_composite

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
METHOD = "mahalanobis-knn"
K = 10  # twins per cell
DONOR_DIST_KM = (2.0, 20.0)  # outside the scar edge, within the same landscape
DONOR_MAX_DNBR = 0.05
FOREST_NDVI_PRE = 0.45
COVARIATES = ["preNbr", "preNdvi", "elev", "slope", "northness"]
DEM = "Copernicus DEM GLO-30 (Microsoft Planetary Computer)"


def terrain() -> dict[str, dict]:
    """Mean elevation (m), slope (deg) and northness/eastness per 64 ha cell, cached in cache/terrain.json."""
    path = CACHE_DIR / "terrain.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    import odc.stac
    import planetary_computer
    import pystac_client

    meta = json.loads((CACHE_DIR / "cells.json").read_text(encoding="utf-8"))
    px = meta["cellPx"]
    grid = load_composite("pre").B08
    items = pystac_client.Client.open(STAC_URL).search(collections=["cop-dem-glo-30"], bbox=BBOX).item_collection()
    dem = odc.stac.load(items, bands=["data"], bbox=BBOX, crs=CRS, resolution=RESOLUTION, resampling="bilinear",
                        patch_url=planetary_computer.sign)["data"].isel(time=0)
    dem = dem.rio.write_crs(CRS).rio.reproject_match(grid).values.astype("float64")
    gy, gx = np.gradient(dem, RESOLUTION)  # rows run south, columns east
    dz_north, dz_east = -gy, gx
    mag = np.hypot(dz_north, dz_east)
    slope = np.degrees(np.arctan(mag))
    with np.errstate(invalid="ignore", divide="ignore"):
        north = np.where(mag > 1e-6, -dz_north / mag, 0.0)  # downslope direction: 1 = faces north
        east = np.where(mag > 1e-6, -dz_east / mag, 0.0)
    out = {}
    for c in meta["cells"]:
        r0, c0 = c["row"] * px, c["col"] * px
        win = (slice(r0, r0 + px), slice(c0, c0 + px))
        out[c["id"]] = {"elev": round(float(np.nanmean(dem[win])), 1), "slope": round(float(np.nanmean(slope[win])), 2),
                        "northness": round(float(np.nanmean(north[win])), 3), "eastness": round(float(np.nanmean(east[win])), 3)}
    path.write_text(json.dumps(out), encoding="utf-8")
    print(f"terrain for {len(out)} cells, DEM items: {[i.id for i in items]}")
    return out


def is_donor(c: dict) -> bool:
    return (c["fracScar"] == 0 and c["fracLand"] >= 0.95 and c["dnbr"] < DONOR_MAX_DNBR
            and c["sevFrac"]["unburned"] >= 0.95 and c["periods"]["pre"]["ndvi"] >= FOREST_NDVI_PRE
            and DONOR_DIST_KM[0] <= c["distKm"] <= DONOR_DIST_KM[1])


def covariates(c: dict, t: dict) -> list[float]:
    p = c["periods"]["pre"]
    return [p["nbr"], p["ndvi"], t["elev"], t["slope"], t["northness"]]


def centre(c: dict) -> np.ndarray:
    x0, y0, x1, y1 = c["bounds"]
    return np.array([(x0 + x1) / 2, (y0 + y1) / 2])


class Matcher:
    """Finds twins among the donor cells. The distance metric is fixed by `treated` + donors, so results do not
    depend on which cell is asked first."""

    def __init__(self, cells: list[dict], treated: list[dict]):
        self.ter = terrain()
        self.donors = [c for c in cells if is_donor(c)]
        self.X = np.array([covariates(c, self.ter[c["id"]]) for c in self.donors])
        Xt = np.array([covariates(c, self.ter[c["id"]]) for c in treated])
        self.VI = np.linalg.inv(np.cov(np.vstack([Xt, self.X]).T))
        self.P = np.array([centre(c) for c in self.donors])

    def x(self, c: dict) -> np.ndarray:
        return np.array(covariates(c, self.ter[c["id"]]))

    def twins(self, c: dict, exclude_km: float = 0.0, k: int = K) -> list[dict]:
        diff = self.X - self.x(c)
        d2 = np.einsum("ij,jk,ik->i", diff, self.VI, diff)
        if exclude_km:
            d2 = np.where(np.hypot(*(self.P - centre(c)).T) / 1000 < exclude_km, np.inf, d2)
        return [self.donors[i] for i in np.argsort(d2, kind="stable")[:k]]


def mean_nbr(twins: list[dict]) -> dict[str, float]:
    return {p: float(np.mean([t["periods"][p]["nbr"] for t in twins])) for p in twins[0]["periods"]}
