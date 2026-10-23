"""AI calls (OpenAI), with a spend ledger and a daily budget for live use.

Every call appends {model, purpose, tokens, estimated USD} to cache/ai_usage.jsonl. Calls made while serving visitors
(`live=True`) stop once today's live spend reaches AI_DAILY_BUDGET_USD, so a public demo cannot drain the API credit;
pipeline runs are logged but not capped. Prices are list prices per million tokens and only an estimate.
"""

import base64
import json
import threading
from datetime import UTC, datetime

from .config import BACKEND_DIR, settings

LEDGER = BACKEND_DIR / "cache" / "ai_usage.jsonl"
# USD per 1M tokens (input, output); unknown models are priced like the most expensive one, to stay on the safe side
PRICES = {"gpt-5": (1.25, 10.0), "gpt-5-mini": (0.25, 2.0), "gpt-5-nano": (0.05, 0.4)}
_lock = threading.Lock()


class AIUnavailable(Exception):
    """No key configured, or today's live budget is used up."""


def configured() -> bool:
    return bool(settings.openai_api_key)


def model_name() -> str:
    return settings.openai_model


def cost(model: str, tokens_in: int, tokens_out: int) -> float:
    p_in, p_out = PRICES.get(model, max(PRICES.values()))
    return (tokens_in * p_in + tokens_out * p_out) / 1e6


def spent(live_only: bool = False, today_only: bool = False) -> float:
    if not LEDGER.exists():
        return 0.0
    today = datetime.now(UTC).date().isoformat()
    total = 0.0
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        if (live_only and not r.get("live")) or (today_only and not r["at"].startswith(today)):
            continue
        total += r["usd"]
    return total


def _record(model: str, purpose: str, live: bool, tokens_in: int, tokens_out: int) -> None:
    row = {"at": datetime.now(UTC).isoformat(timespec="seconds"), "model": model, "purpose": purpose, "live": live,
           "in": tokens_in, "out": tokens_out, "usd": round(cost(model, tokens_in, tokens_out), 6)}
    with _lock:
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        with LEDGER.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")


def complete(prompt: str, image: bytes | None = None, mime: str = "image/jpeg", *, purpose: str = "", live: bool = False,
             effort: str | None = None, max_output_tokens: int | None = None, model: str | None = None) -> str:
    """Return the model's text answer to a prompt, optionally with one image.

    live: called while serving a visitor; refused once today's live spend reaches the daily budget.
    effort: reasoning effort for reasoning models ("minimal", "low", "medium", "high"); None = provider default.
    model: overrides the configured OpenAI model for this call (e.g. a stronger model for offline writing).
    """
    if not configured():
        raise AIUnavailable("AI is not configured")
    if live and spent(live_only=True, today_only=True) >= settings.ai_daily_budget_usd:
        raise AIUnavailable("today's AI budget for the demo is used up")
    text, t_in, t_out = _openai(prompt, image, mime, effort, max_output_tokens, model)
    _record(model or model_name(), purpose, live, t_in, t_out)
    return text


def _openai(prompt: str, image: bytes | None, mime: str, effort: str | None, max_output_tokens: int | None, model: str | None = None):
    from openai import OpenAI

    content: list[dict] = [{"type": "input_text", "text": prompt}]
    if image is not None:
        url = f"data:{mime};base64,{base64.b64encode(image).decode()}"
        content.append({"type": "input_image", "image_url": url})
    client = OpenAI(api_key=settings.openai_api_key)
    extra: dict = {}
    if effort:
        extra["reasoning"] = {"effort": effort}
    if max_output_tokens:
        extra["max_output_tokens"] = max_output_tokens
    resp = client.responses.create(model=model or settings.openai_model, input=[{"role": "user", "content": content}], **extra)
    u = resp.usage
    return resp.output_text, (u.input_tokens if u else 0), (u.output_tokens if u else 0)

