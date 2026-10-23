"""AI damage analysis: what kind of damage do the flagged slopes show? Advisory, measured against independent data.

For every burned cell whose quarterly check-ins detected damage (backtest, step 08) and an equal random sample of burned
cells that passed, a vision model sees one image of the cell (outlined, with its surroundings) in autumn 2021, winter
2022 and spring 2022, the quarters around the detection (67 of 71 flagged cells were caught in Q1 2022), in true colour
and in false colour (SWIR-NIR-red: vegetation green, bare soil pink). Quarterly composites come from step 14a. Yearly
summer images were tried first: by 2023 the damage is hidden under replanting terraces and regrowth, which appear on
recovering slopes too, so they could not tell the groups apart. The model is not told which group a cell belongs to. It
answers in JSON which features appeared inside the outline (terraces, roads or tracks, bare clearing, construction,
re-burn), how the green cover changed, and the main cause.

The answers are compared with (a) our check-in flags (same satellite, so a consistency check) and (b) Hansen/UMD tree
loss 2022-2025 of the trees that survived the fire (Landsat, independent; step 12). The model never decides a payout:
results are stored next to the evidence (data/ai_damage.json), not inside the signed evidence set.

Result (October 2026, blind test of 5 flagged and 5 passed cells, gpt-5): the model reported new contour terraces on
all 10 cells and bare clearing on 2 of 5 flagged vs 1 of 5 passed. A terracing campaign in winter 2021/22 covered
recovering and failing slopes alike; at 20 m the model sees the campaign but cannot tell which slopes lost their regrowth,
which the check-in signal (vegetation change against matched twins) does. Not used for payouts or published results;
kept as a documented experiment. The full run was not made.

Inputs: cache/composites, cache/cells.json, cache/hansen, data/backtest.geojson, an OpenAI key (.env).
Outputs: data/ai_damage.json, data/img/ai_damage/<cell>.webp (the image the model saw), cache/ai_damage/<cell>.json
(raw answers, so reruns cost nothing).
Usage: uv run python pipeline/14_ai_damage.py [--limit N]
"""

import argparse
import hashlib
import importlib.util
import io
import json
import random
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from sklearn.metrics import roc_auc_score

from common import CACHE_DIR, DATA_DIR, PIXEL_HA, load_composite

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from regrow_api import ai
from regrow_api.config import settings

PERIODS = [("2021Q4", "Oct-Dec 2021"), ("2022Q1", "Jan-Mar 2022"), ("2022Q2", "Apr-Jun 2022")]
MARGIN = 0.5  # cell widths of context around the cell
SCALE = 4  # upsampling of 20 m pixels for the model
SEED = 7
FEATURES = ["new_terraces", "new_roads_or_tracks", "bare_clearing", "construction", "reburn"]
TRENDS = ["greener", "unchanged", "barer"]
LABELS = ["terracing", "clearing_or_logging", "road_or_construction", "reburn", "natural_regrowth", "unclear"]
PROMPT = (
    "You review Sentinel-2 satellite images (20 m pixels) of one 64 ha square of forest that burned in the July 2021 "
    "Manavgat wildfire in Türkiye (Turkish red pine, Mediterranean). The square is outlined in yellow; the area around it "
    "is context only. Columns: October-December 2021 (a few months after the fire), January-March 2022, April-June 2022. "
    "Top row true colour; bottom row false colour (SWIR-NIR-red): vegetation is green, burned or bare ground is pink or "
    "brown. In a normal winter the surviving trees and the first regrowth make the square slowly greener.\n"
    "Report what is NEW inside the outline in 2022: compare columns 2 and 3 with column 1. Anything already visible in "
    "autumn 2021 (old roads, villages, rock) does not count.\n"
    "Features: new_terraces = many regular parallel lines following the contours (often dug for replanting, which is "
    "common here and not damage by itself); new_roads_or_tracks = a new bright line or band; bare_clearing = ground that "
    "becomes barer or brighter in 2022, beyond the terrace lines (trees or regrowth removed: salvage logging, bulldozing); construction = bright "
    "rectangular pads or buildings; reburn = a new dark burn scar. vegetation_trend = how the green cover inside the "
    "outline changes from autumn 2021 to spring 2022, judged mainly from the false colour row.\n"
    'Answer ONLY with JSON: {"new_terraces": bool, "new_roads_or_tracks": bool, "bare_clearing": bool, '
    '"construction": bool, "reburn": bool, "vegetation_trend": "greener" | "unchanged" | "barer", '
    '"main_cause": one of ' + json.dumps(LABELS) + ' (what most shapes the square in 2022), '
    '"confidence": number 0-1, "reason": "one short sentence on what you see"}.'
)
PROMPT_SHA = hashlib.sha256(PROMPT.encode()).hexdigest()[:12]
OUT_IMG = DATA_DIR / "img" / "ai_damage"
OUT_CACHE = CACHE_DIR / "ai_damage"


def hansen_module():
    spec = importlib.util.spec_from_file_location("hansen12", Path(__file__).with_name("12_hansen.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def stretch(stack: np.ndarray) -> np.ndarray:
    """Percentile stretch shared by all years of one cell, so colours are comparable across columns."""
    lo, hi = np.nanpercentile(stack, 2), np.nanpercentile(stack, 98)
    return np.clip((stack - lo) / max(hi - lo, 1e-6), 0, 1)


def cell_image(comps: dict, c: dict, px: int) -> Image.Image:
    m = int(px * MARGIN)
    r0, c0 = c["row"] * px - m, c["col"] * px - m
    size = px + 2 * m
    tiles = {}
    for kind, bands in (("true", ("B04", "B03", "B02")), ("false", ("B12", "B08", "B04"))):
        raw = []
        for period, _ in PERIODS:
            ds = comps[period]
            arr = np.stack([ds[b].values[max(r0, 0):r0 + size, max(c0, 0):c0 + size] for b in bands], axis=-1).astype("float32")
            raw.append(arr)
        s = stretch(np.stack(raw))
        tiles[kind] = [(np.nan_to_num(t) * 255).astype("uint8") for t in s]
    w = size * SCALE
    label_h = 22
    canvas = Image.new("RGB", (w * 3 + 8, (w + label_h) * 2 + 4), "white")
    draw = ImageDraw.Draw(canvas)
    for row, kind in enumerate(("true", "false")):
        for col, (period, title) in enumerate(PERIODS):
            tile = Image.fromarray(tiles[kind][col]).resize((w, w), Image.NEAREST)
            x, y = col * (w + 4), row * (w + label_h + 4)
            canvas.paste(tile, (x, y + label_h))
            o = m * SCALE
            ImageDraw.Draw(canvas).rectangle([x + o, y + label_h + o, x + o + px * SCALE, y + label_h + o + px * SCALE], outline=(255, 221, 0), width=3)
            draw.text((x + 4, y + 4), f"{title} · {'true colour' if kind == 'true' else 'false colour'}", fill=(20, 20, 20))
    return canvas


def ask(cell_id: str, img: Image.Image) -> dict:
    cache = OUT_CACHE / f"{cell_id}.json"
    if cache.exists():
        saved = json.loads(cache.read_text(encoding="utf-8"))
        if saved.get("promptSha") == PROMPT_SHA and saved.get("model") == settings.openai_model:
            return saved
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    text = ai.complete(PROMPT, buf.getvalue(), "image/jpeg", purpose="ai-damage")
    try:
        ans = json.loads(text[text.find("{"): text.rfind("}") + 1])
    except ValueError:
        ans = {"main_cause": "unclear", "confidence": 0, "reason": "unparseable answer"}
    if ans.get("main_cause") not in LABELS:
        ans["main_cause"] = "unclear"
    if ans.get("vegetation_trend") not in TRENDS:
        ans["vegetation_trend"] = "unchanged"
    rec = {"promptSha": PROMPT_SHA, "model": settings.openai_model,
           "answer": ans, "raw": text, "at": datetime.now(UTC).isoformat(timespec="seconds")}
    OUT_CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(rec, indent=1, ensure_ascii=False), encoding="utf-8")
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="cells per group (0 = all flagged cells)")
    ap.add_argument("--model", default="", help="override the OpenAI model (default: OPENAI_MODEL from .env)")
    args = ap.parse_args()
    if args.model:
        settings.openai_model = args.model

    meta = json.loads((CACHE_DIR / "cells.json").read_text(encoding="utf-8"))
    cells, px = {c["id"]: c for c in meta["cells"]}, meta["cellPx"]
    bt = {f["properties"]["id"]: f["properties"] for f in json.loads((DATA_DIR / "backtest.geojson").read_text(encoding="utf-8"))["features"]}
    flagged = sorted(i for i, p in bt.items() if p["missedCheckins"] > 0)
    passed = sorted(i for i, p in bt.items() if p["missedCheckins"] == 0)
    rng = random.Random(SEED)
    control = sorted(rng.sample(passed, len(flagged)))
    if args.limit:
        flagged, control = flagged[: args.limit], control[: args.limit]
    order = flagged + control
    rng.shuffle(order)  # blind: groups interleaved
    group = {i: "flagged" for i in flagged} | {i: "passed" for i in control}

    # Hansen loss 2022-2025 of trees that survived the fire (as in step 12, part D)
    h = hansen_module()
    grid = load_composite("pre").B08
    loss, cover = h.hansen("lossyear", grid), h.hansen("treecover2000", grid)
    forest = cover >= h.TREE_COVER

    def later_loss(c: dict) -> float:
        lb, fb = h.block(loss, c, px), h.block(forest, c, px)
        alive = fb & ~((lb >= 1) & (lb <= 21))
        return float(((lb >= 22) & (lb <= 25) & alive).sum() * PIXEL_HA)

    comps = {p: load_composite(p) for p, _ in PERIODS}
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    rows = []
    for n, cid in enumerate(order, 1):
        c = cells[cid]
        img = cell_image(comps, c, px)
        img.save(OUT_IMG / f"{cid}.webp", "WEBP", quality=82)
        rec = ask(cid, img)
        a = rec["answer"]
        rows.append({"id": cid, "group": group[cid], "features": {f: bool(a.get(f)) for f in FEATURES},
                     "trend": a["vegetation_trend"], "cause": a["main_cause"],
                     "confidence": round(float(a.get("confidence") or 0), 2), "reason": a.get("reason", ""),
                     "hansenLaterLossHa": round(later_loss(c), 1), "outcome": bt[cid]["outcome"]})
        tags = ",".join(f for f in FEATURES if a.get(f)) or "-"
        print(f"{n:3d}/{len(order)} {cid:8s} {group[cid]:7s} -> {a['main_cause']:20s} {a['vegetation_trend']:9s} {tags:40s} | {a.get('reason', '')[:70]}")

    # ---------------- evaluation
    y_flag = np.array([r["group"] == "flagged" for r in rows])
    hansen_ha = np.array([r["hansenLaterLossHa"] for r in rows])
    lost = hansen_ha >= 9.6  # Hansen: at least 15% of the cell (9.6 ha) of surviving trees lost later
    # damage that stops regrowth, as opposed to terraces dug for replanting
    harm = np.array([r["features"]["bare_clearing"] or r["features"]["construction"] or r["features"]["reburn"] or r["trend"] == "barer" for r in rows])

    def share(mask, sel):
        return round(float(mask[sel].mean()), 3) if sel.any() else None

    def agree(y, yhat):
        tp = int((y & yhat).sum())
        return {"accuracy": round(float((y == yhat).mean()), 3), "precision": round(tp / max(int(yhat.sum()), 1), 3),
                "recall": round(tp / max(int(y.sum()), 1), 3)}

    by_feature = {}
    for f in FEATURES + ["trend_barer"]:
        m = np.array([r["trend"] == "barer" if f == "trend_barer" else r["features"][f] for r in rows])
        by_feature[f] = {"flaggedShare": share(m, y_flag), "passedShare": share(m, ~y_flag),
                         "meanHansenLaterLossHa": {"with": round(float(hansen_ha[m].mean()), 1) if m.any() else None,
                                                   "without": round(float(hansen_ha[~m].mean()), 1) if (~m).any() else None}}

    out = {
        "method": {
            "model": rows and json.loads((OUT_CACHE / f"{rows[0]['id']}.json").read_text(encoding="utf-8"))["model"],
            "provider": "openai", "promptSha256": PROMPT_SHA, "prompt": PROMPT,
            "periods": [p for p, _ in PERIODS], "seed": SEED, "advisory": True,
            "groups": {"flagged": "burned cells whose quarterly check-ins detected damage (step 08)",
                       "passed": "equal random sample of burned cells whose check-ins all passed"},
            "hansenLostDefinition": "Hansen/UMD tree loss 2022-2025 of trees that survived the fire >= 9.6 ha (15% of the cell)",
        },
        "cells": len(rows),
        "harmDefinition": "bare_clearing, construction or reburn seen, or vegetation getting barer (terraces alone do not count)",
        "byFeature": by_feature,
        "harmVsCheckins": agree(y_flag, harm),
        "harmVsHansen": {**agree(lost, harm), "lostCells": int(lost.sum()),
                         "aucHarm": round(float(roc_auc_score(lost, harm.astype(float))), 3) if 0 < lost.sum() < len(lost) else None,
                         "meanLaterLossHa": {"harm": round(float(hansen_ha[harm].mean()), 1) if harm.any() else None,
                                             "noHarm": round(float(hansen_ha[~harm].mean()), 1) if (~harm).any() else None}},
        "byCause": {lab: int(sum(r["cause"] == lab for r in rows)) for lab in LABELS},
        "rows": sorted(rows, key=lambda r: r["id"]),
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    (DATA_DIR / "ai_damage.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in out.items() if k not in ("rows", "method")}, indent=1))


if __name__ == "__main__":
    main()
