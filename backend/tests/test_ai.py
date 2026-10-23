import json

import pytest

from regrow_api import ai
from regrow_api.config import settings


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(ai, "LEDGER", tmp_path / "usage.jsonl")
    monkeypatch.setattr(settings, "openai_api_key", "test")
    monkeypatch.setattr(settings, "openai_model", "gpt-5-mini")
    # never call the real API: 10k tokens in, 2k out per call
    monkeypatch.setattr(ai, "_openai", lambda *a, **k: ("ok", 10_000, 2_000))


def test_every_call_is_logged_with_its_cost():
    assert ai.complete("hi", purpose="test") == "ok"
    row = json.loads(ai.LEDGER.read_text().splitlines()[0])
    assert row["purpose"] == "test" and row["in"] == 10_000 and row["out"] == 2_000
    assert row["usd"] == pytest.approx((10_000 * 0.25 + 2_000 * 2.0) / 1e6)


def test_live_calls_stop_at_the_daily_budget(monkeypatch):
    monkeypatch.setattr(settings, "ai_daily_budget_usd", 0.01)  # one call costs 0.0065
    ai.complete("a", live=True)
    ai.complete("b", live=True)  # 0.0065 < 0.01: still allowed
    with pytest.raises(ai.AIUnavailable):
        ai.complete("c", live=True)  # 0.013 >= 0.01
    assert ai.complete("pipeline", live=False) == "ok"  # offline runs are not capped


def test_unknown_models_are_priced_conservatively():
    assert ai.cost("some-new-model", 1_000_000, 0) == max(p for p, _ in ai.PRICES.values())


def test_no_key_means_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    with pytest.raises(ai.AIUnavailable):
        ai.complete("x")
