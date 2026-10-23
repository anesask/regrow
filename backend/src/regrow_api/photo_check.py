"""Steward photo check (M0 evidence): is this a real, new photo taken on the plot after the fire?

Checks: GPS present · GPS inside the plot polygon · capture date after the fire and not in the future ·
not a duplicate (perceptual hash) · optional AI look at the content. Returns every check plus an evidence hash.
"""

import hashlib
import io
import itertools
import json
import math
import threading
from datetime import datetime

import imagehash
from eth_utils import keccak
from PIL import ExifTags, Image

from . import ai
from .config import BACKEND_DIR, settings

FIRE_START = datetime(2021, 7, 28)
DUPLICATE_DISTANCE = 6  # pHash Hamming distance
GPS_TOLERANCE_M = 100  # phone GPS error
HASH_STORE = BACKEND_DIR / "cache" / "photo_hashes.json"
_lock = threading.Lock()

AI_PROMPT = (
    "You check photos submitted as evidence for a post-wildfire forest restoration project in Türkiye "
    "(Turkish red pine, Mediterranean). Answer ONLY with JSON: "
    '{"outdoor_landscape": bool, "fire_traces": bool, "regrowth_visible": bool, "plausible": bool, '
    '"description": "one short sentence"}. fire_traces = burned trunks, charcoal, ash or snags. '
    "plausible = it could be a real photo of a burned forest slope being protected or replanted."
)


class PhotoError(Exception):
    pass


def _gps(exif) -> tuple[float, float] | None:
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    if not gps or 2 not in gps or 4 not in gps:
        return None

    def deg(v, ref):
        d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
        return -d if ref in ("S", "W") else d

    return deg(gps[2], gps.get(1, "N")), deg(gps[4], gps.get(3, "E"))


def _taken_at(exif) -> datetime | None:
    raw = exif.get_ifd(ExifTags.IFD.Exif).get(ExifTags.Base.DateTimeOriginal) or exif.get(ExifTags.Base.DateTime)
    try:
        return datetime.strptime(str(raw), "%Y:%m:%d %H:%M:%S") if raw else None
    except ValueError:
        return None


def _inside(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    for (x1, y1), (x2, y2) in itertools.pairwise(ring):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _distance_m(lon: float, lat: float, ring: list[list[float]]) -> float:
    """Approximate distance from a point to a polygon edge (equirectangular, fine at plot scale)."""
    k = 111_320
    px, py = lon * k * math.cos(math.radians(lat)), lat * k
    best = math.inf
    for (x1, y1), (x2, y2) in itertools.pairwise(ring):
        ax, ay = x1 * k * math.cos(math.radians(lat)), y1 * k
        bx, by = x2 * k * math.cos(math.radians(lat)), y2 * k
        dx, dy = bx - ax, by - ay
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
        best = min(best, math.hypot(px - ax - t * dx, py - ay - t * dy))
    return best


def _load_hashes() -> list[dict]:
    return json.loads(HASH_STORE.read_text()) if HASH_STORE.exists() else []


def check(plot: dict, data: bytes, filename: str) -> dict:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:
        raise PhotoError("not an image") from e

    exif = img.getexif()
    ring = plot["geometry"]["coordinates"][0]
    checks = []

    gps = _gps(exif)
    checks.append({"id": "gps", "label": "Photo has GPS location", "ok": gps is not None,
                   "detail": f"{gps[0]:.5f}°N {gps[1]:.5f}°E" if gps else "No GPS in the photo metadata"})
    if gps:
        lat, lon = gps
        inside = _inside(lon, lat, ring)
        dist = 0.0 if inside else _distance_m(lon, lat, ring)
        ok = inside or dist <= GPS_TOLERANCE_M
        checks.append({"id": "inside", "label": "Taken inside the plot", "ok": ok,
                       "detail": "Inside the plot boundary" if inside else f"{dist / 1000:.2f} km outside the plot"})

    taken = _taken_at(exif)
    date_ok = taken is not None and FIRE_START <= taken <= datetime.now()
    checks.append({"id": "date", "label": "Taken after the fire", "ok": date_ok,
                   "detail": taken.strftime("%d %b %Y %H:%M") if taken else "No capture date in the metadata"})

    phash = str(imagehash.phash(img.convert("RGB")))
    with _lock:
        seen = _load_hashes()
        dup = next((h for h in seen if imagehash.hex_to_hash(h["phash"]) - imagehash.hex_to_hash(phash)
                    <= DUPLICATE_DISTANCE), None)
    checks.append({"id": "duplicate", "label": "New photo (not re-used)", "ok": dup is None,
                   "detail": f"Matches a photo already submitted for {dup['plotId']}" if dup else "No match among earlier submissions"})

    ai_result = None
    if settings.openai_api_key:
        try:
            small = img.convert("RGB")
            small.thumbnail((1024, 1024))
            buf = io.BytesIO()
            small.save(buf, "JPEG", quality=85)
            text = ai.complete(AI_PROMPT, buf.getvalue(), "image/jpeg", purpose="photo-check", live=True, effort="low")
            ai_result = json.loads(text[text.find("{"): text.rfind("}") + 1])
            checks.append({"id": "ai", "label": "AI: burned slope with protected regrowth", "ok": bool(ai_result.get("plausible")),
                           "detail": ai_result.get("description", "")})
        except Exception as e:  # noqa: BLE001  (AI is advisory; never block on it)
            checks.append({"id": "ai", "label": "AI content check", "ok": None, "detail": f"skipped ({type(e).__name__})"})
    else:
        checks.append({"id": "ai", "label": "AI content check", "ok": None, "detail": "not configured"})

    passed = all(c["ok"] is not False for c in checks if c["id"] != "ai")  # the AI look is advisory: shown, never decisive
    sha = hashlib.sha256(data).hexdigest()
    evidence = {"plotId": plot["properties"]["id"], "kind": "photo", "sha256": sha, "phash": phash,
                "gps": gps, "takenAt": taken.isoformat() if taken else None, "checks": checks, "passed": passed}
    raw = json.dumps(evidence, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()

    if passed:
        with _lock:
            seen = _load_hashes()
            seen.append({"phash": phash, "plotId": plot["properties"]["id"], "sha256": sha})
            HASH_STORE.parent.mkdir(exist_ok=True)
            HASH_STORE.write_text(json.dumps(seen))

    return {"passed": passed, "checks": checks, "gps": gps, "evidenceHash": "0x" + keccak(raw).hex(),
            "filename": filename}
