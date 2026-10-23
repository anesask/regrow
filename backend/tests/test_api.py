import json

import pytest
from eth_utils import keccak
from fastapi.testclient import TestClient
from web3 import Web3

from regrow_api import guards, oracle
from regrow_api.config import settings
from regrow_api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_limits():
    guards.reset()


@pytest.fixture
def empty_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    return tmp_path


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_missing_pipeline_output_is_503(empty_data_dir):
    assert client.get("/api/plots").status_code == 503
    assert client.get("/api/results").status_code == 503


def test_unknown_plot_is_404(empty_data_dir):
    (empty_data_dir / "plots.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": []}))
    assert client.get("/api/plots/plot-r99c99").status_code == 404
    assert client.get("/api/plots/nope").status_code == 422


@pytest.mark.parametrize("path", ["/api/oracle/report", "/api/oracle/disturbance"])
def test_oracle_requires_passcode(path, monkeypatch):
    monkeypatch.setattr(settings, "admin_passcode", "secret")
    body = {"plotId": "plot-r01c01", "milestone": 0}
    assert client.post(path, json=body).status_code == 401
    assert client.post(path, json=body, headers={"X-Admin-Passcode": "wrong"}).status_code == 401


def test_oracle_disabled_without_passcode_configured(monkeypatch):
    monkeypatch.setattr(settings, "admin_passcode", "")
    r = client.post("/api/oracle/report", json={"plotId": "plot-r01c01", "milestone": 0}, headers={"X-Admin-Passcode": ""})
    assert r.status_code == 401


def test_error_name_decodes_custom_errors():
    selector = "0x" + Web3.keccak(text="NotActive()").hex().removeprefix("0x")[:8]
    assert oracle._error_name(selector) == "NotActive"
    assert oracle._error_name("0xdeadbeef").startswith("revert")


def test_unknown_plot_or_milestone_rejected():
    with pytest.raises(oracle.OracleError):
        oracle.report_milestone({"leaves": []}, "../etc", 0)
    with pytest.raises(oracle.OracleError):
        oracle.report_milestone({"leaves": []}, "plot-r01c01", 99)
    with pytest.raises(oracle.OracleError):
        oracle.report_milestone({"leaves": []}, "plot-r01c01", 1)


def test_admin_brute_force_is_locked_out(monkeypatch):
    monkeypatch.setattr(settings, "admin_passcode", "secret")
    body = {"plotId": "plot-r01c01", "milestone": 0}
    codes = [client.post("/api/oracle/report", json=body, headers={"X-Admin-Passcode": f"guess{i}"}).status_code
             for i in range(12)]
    assert codes[:10] == [401] * 10
    assert codes[10:] == [429, 429]


@pytest.mark.parametrize(("path", "body"), [
    ("/api/oracle/report", {"plotId": "../../etc/passwd", "milestone": 0}),
    ("/api/oracle/report", {"plotId": "plot-r01c01", "milestone": 999}),
    ("/api/demo/gas", {"address": "0x123"}),
])
def test_schema_rejects_bad_input(path, body, monkeypatch):
    monkeypatch.setattr(settings, "admin_passcode", "secret")
    assert client.post(path, json=body, headers={"X-Admin-Passcode": "secret"}).status_code == 422


def test_query_and_path_guards():
    assert client.get("/api/plots/..%2F..%2Fsecret").status_code in (404, 422)
    assert client.get("/api/events?plotId=-1").status_code == 422
    assert client.get("/api/certificates?funder=not-an-address").status_code == 422
    assert client.get("/api/certificates/0").status_code == 422


def test_security_headers():
    r = client.get("/api/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Cache-Control"] == "no-store"


def test_photo_check_rate_limited(empty_data_dir):
    (empty_data_dir / "plots.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": []}))
    codes = [client.post("/api/photo-check", data={"plotId": "plot-r01c01"}, files={"file": ("a.jpg", b"x")}).status_code
             for _ in range(21)]
    assert codes[:20] == [404] * 20
    assert codes[20] == 429


def test_evidence_files_match_hashes():
    """keccak256 of each published evidence file must equal the hash the oracle puts on-chain."""
    results_path = settings.data_dir / "results.json"
    if not results_path.exists():
        pytest.skip("pipeline output not generated")
    results = json.loads(results_path.read_text(encoding="utf-8"))
    checked = 0
    for pid, r in results.items():
        docs = [(f"m{m['idx']}", m["evidenceHash"]) for m in r["milestones"]]
        if r.get("disturbance"):
            docs.append(("disturbance", r["disturbance"]["evidenceHash"]))
        for kind, expected in docs:
            raw = (settings.data_dir / "evidence" / f"{pid}-{kind}.json").read_bytes()
            assert "0x" + keccak(raw).hex() == expected, f"{pid} {kind}"
            checked += 1
    assert checked > 0


def test_ask_validates_input_and_reports_ai_status(monkeypatch):
    from regrow_api import ai as ai_mod
    from regrow_api import reports as rep_mod
    from regrow_api.config import settings as s

    monkeypatch.setattr(s, "openai_api_key", "")
    assert client.get("/api/ai/status").json()["configured"] is False
    facts = client.get("/api/plots/plot-r41c21/facts").json()
    assert facts["milestones"] and facts["recovery_by_summer_pct"]
    assert client.get("/api/plots/plot-r99c99/facts").status_code == 404
    assert client.post("/api/plots/plot-r41c21/ask", json={"question": "hi", "lang": "en"}).status_code == 422  # too short
    assert client.post("/api/plots/plot-r41c21/ask", json={"question": "How is it doing?", "lang": "fr"}).status_code == 422
    assert client.post("/api/plots/not-a-plot/ask", json={"question": "How is it doing?"}).status_code == 422
    assert client.post("/api/plots/plot-r41c21/ask", json={"question": "How is it doing?"}).status_code == 503  # no key
    # a made-up number is never shown
    monkeypatch.setattr(s, "openai_api_key", "test")
    monkeypatch.setattr(ai_mod, "LEDGER", ai_mod.LEDGER.parent / "test_usage.jsonl")
    monkeypatch.setattr(ai_mod, "_openai", lambda *a, **k: ('{"answer": "Recovery reached 91%."}', 10, 10))
    r = client.post("/api/plots/plot-r41c21/ask", json={"question": "What is the recovery?"}).json()
    assert r == {"answer": None, "verified": False}
    monkeypatch.setattr(ai_mod, "_openai", lambda *a, **k: ('{"answer": "Recovery reached 75% by 2026."}', 10, 10))
    r = client.post("/api/plots/plot-r41c21/ask", json={"question": "What is the recovery by 2026?"}).json()
    assert r["verified"] and "75%" in r["answer"]
    ai_mod.LEDGER.unlink(missing_ok=True)
    assert rep_mod.ReportError
