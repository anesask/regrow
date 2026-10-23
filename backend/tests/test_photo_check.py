import io
from datetime import datetime

import numpy as np
import pytest
from PIL import ExifTags, Image
from PIL.TiffImagePlugin import IFDRational

from regrow_api import photo_check
from regrow_api.config import settings

# 0.01° square around 36.90 N, 31.45 E
PLOT = {
    "type": "Feature",
    "properties": {"id": "plot-test"},
    "geometry": {"type": "Polygon", "coordinates": [[[31.445, 36.895], [31.455, 36.895], [31.455, 36.905],
                                                     [31.445, 36.905], [31.445, 36.895]]]},
}


def _dms(v: float):
    d = int(v)
    m = int((v - d) * 60)
    s = (v - d - m / 60) * 3600
    return (IFDRational(d, 1), IFDRational(m, 1), IFDRational(round(s * 100), 100))


def make_photo(lat=None, lon=None, taken: datetime | None = datetime(2024, 5, 1, 10, 0), seed=0) -> bytes:
    rng = np.random.default_rng(seed)
    img = Image.fromarray(rng.integers(0, 255, (256, 256, 3), dtype=np.uint8))
    exif = Image.Exif()
    if taken:
        exif[ExifTags.Base.DateTime] = taken.strftime("%Y:%m:%d %H:%M:%S")
    if lat is not None:
        exif[ExifTags.IFD.GPSInfo] = {1: "N", 2: _dms(lat), 3: "E", 4: _dms(lon)}
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(photo_check, "HASH_STORE", tmp_path / "hashes.json")
    monkeypatch.setattr(settings, "openai_api_key", "")


def by_id(result):
    return {c["id"]: c for c in result["checks"]}


def test_valid_photo_passes():
    r = photo_check.check(PLOT, make_photo(36.90, 31.45), "a.jpg")
    assert r["passed"], r["checks"]
    assert r["evidenceHash"].startswith("0x") and len(r["evidenceHash"]) == 66
    assert by_id(r)["ai"]["ok"] is None  # not configured, advisory only


def test_duplicate_rejected_after_first_pass():
    data = make_photo(36.90, 31.45, seed=1)
    assert photo_check.check(PLOT, data, "a.jpg")["passed"]
    again = photo_check.check(PLOT, data, "a-copy.jpg")
    assert not again["passed"]
    assert by_id(again)["duplicate"]["ok"] is False


def test_outside_plot_rejected():
    r = photo_check.check(PLOT, make_photo(36.95, 31.50, seed=2), "far.jpg")
    assert by_id(r)["inside"]["ok"] is False
    assert not r["passed"]


def test_no_metadata_rejected():
    r = photo_check.check(PLOT, make_photo(taken=None, seed=3), "plain.jpg")
    checks = by_id(r)
    assert checks["gps"]["ok"] is False
    assert checks["date"]["ok"] is False
    assert not r["passed"]


def test_photo_before_fire_rejected():
    r = photo_check.check(PLOT, make_photo(36.90, 31.45, taken=datetime(2020, 6, 1), seed=4), "old.jpg")
    assert by_id(r)["date"]["ok"] is False


def test_not_an_image():
    with pytest.raises(photo_check.PhotoError):
        photo_check.check(PLOT, b"hello", "x.txt")


def test_ai_verdict_is_advisory(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "test")
    monkeypatch.setattr(photo_check.ai, "complete", lambda *a, **k: '{"plausible": false, "description": "an indoor photo"}')
    r = photo_check.check(PLOT, make_photo(36.90, 31.45, seed=7), "c.jpg")
    assert by_id(r)["ai"]["ok"] is False  # shown to the reviewer
    assert r["passed"], r["checks"]  # but the hard checks decide
