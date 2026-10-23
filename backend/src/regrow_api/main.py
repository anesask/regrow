import json
import secrets
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Path, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import ai, certificates, demo, events, guards, oracle, photo_check, reports
from .config import settings

app = FastAPI(title="ReGrow API", version="0.3.0", description="Satellite-verified pay-for-results restoration")
app.add_middleware(guards.SecurityHeaders)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Admin-Passcode"],
)

PLOT_ID = r"^plot-r\d{2}c\d{2}$"
ADDRESS = r"^0x[0-9a-fA-F]{40}$"

settings.data_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/data", StaticFiles(directory=settings.data_dir), name="data")


def _load_json(name: str):
    path = settings.data_dir / name
    if not path.exists():
        raise HTTPException(503, f"{name} not generated yet; run the pipeline")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/health")
def health():
    return {"ok": True, "chainId": settings.chain_id}


@app.get("/api/plots")
def plots():
    return _load_json("plots.geojson")


@app.get("/api/results")
def results():
    return _load_json("results.json")


@app.get("/api/plots/{plot_id}")
def plot(plot_id: Annotated[str, Path(pattern=PLOT_ID)]):
    fc = _load_json("plots.geojson")
    for feature in fc["features"]:
        if feature["properties"]["id"] == plot_id:
            return {"plot": feature, "results": _load_json("results.json").get(plot_id)}
    raise HTTPException(404, "plot not found")


@app.get("/api/events")
def chain_events(plotId: Annotated[int | None, Query(ge=0, le=10_000)] = None):
    if not oracle.chain_ready():
        return {"deployed": False, "events": []}
    evs = events.sync()
    if plotId is not None:
        evs = [e for e in evs if str(e["args"].get("plotId")) == str(plotId)]
    return {"deployed": True, "events": evs}


def require_admin(request: Request, x_admin_passcode: str = Header(default="", max_length=256)) -> None:
    ip = guards.client_ip(request)
    if not settings.admin_passcode or not secrets.compare_digest(x_admin_passcode.encode(), settings.admin_passcode.encode()):
        guards.rate_limit("admin-fail", ip, limit=10, window_s=600)  # brute-force lockout: 10 wrong tries / 10 min
        raise HTTPException(401, "invalid admin passcode")
    guards.rate_limit("oracle", ip, limit=120, window_s=600)


class ReportRequest(BaseModel):
    plotId: str = Field(pattern=PLOT_ID)
    milestone: int = Field(ge=0, le=31)


class DisturbanceRequest(BaseModel):
    plotId: str = Field(pattern=PLOT_ID)


@app.post("/api/oracle/report", dependencies=[Depends(require_admin)])
def oracle_report(req: ReportRequest):
    try:
        return oracle.report_milestone(oracle.load_dataset(settings.data_dir), req.plotId, req.milestone)
    except oracle.OracleError as e:
        raise HTTPException(400, str(e)) from e


@app.post("/api/oracle/execute", dependencies=[Depends(require_admin)])
def oracle_execute(req: ReportRequest):
    """Execute a reported milestone after its challenge window (reports also execute on their own; this is the retry)."""
    try:
        return oracle.execute_milestone(oracle.load_dataset(settings.data_dir), req.plotId, req.milestone)
    except oracle.OracleError as e:
        raise HTTPException(400, str(e)) from e


@app.post("/api/oracle/expire-pause", dependencies=[Depends(require_admin)])
def oracle_expire_pause(req: DisturbanceRequest):
    try:
        return oracle.expire_pause(oracle.load_dataset(settings.data_dir), req.plotId)
    except oracle.OracleError as e:
        raise HTTPException(400, str(e)) from e


@app.post("/api/oracle/disturbance", dependencies=[Depends(require_admin)])
def oracle_disturbance(req: DisturbanceRequest):
    try:
        return oracle.flag_disturbance(oracle.load_dataset(settings.data_dir), req.plotId)
    except oracle.OracleError as e:
        raise HTTPException(400, str(e)) from e


class GasRequest(BaseModel):
    address: str = Field(pattern=ADDRESS)


@app.post("/api/demo/gas")
def demo_gas(req: GasRequest, request: Request):
    """Give an in-browser demo wallet a little free testnet ETH for transaction fees."""
    try:
        return demo.fund_gas(req.address, request.client.host if request.client else "unknown")
    except oracle.OracleError as e:
        raise HTTPException(429 if "limit" in str(e) else 400, str(e)) from e


MAX_PHOTO_BYTES = 12 * 1024 * 1024


@app.post("/api/photo-check")
async def photo(request: Request, plotId: Annotated[str, Form(pattern=PLOT_ID)], file: Annotated[UploadFile, File()]):
    """Steward photo evidence: GPS inside the plot, taken after the fire, not re-used, optional AI look."""
    guards.rate_limit("photo", guards.client_ip(request), limit=20, window_s=3600)
    data = await file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "photo larger than 12 MB")
    fc = _load_json("plots.geojson")
    plot_feature = next((f for f in fc["features"] if f["properties"]["id"] == plotId), None)
    if plot_feature is None:
        raise HTTPException(404, "plot not found")
    try:
        return photo_check.check(plot_feature, data, file.filename or "photo")
    except photo_check.PhotoError as e:
        raise HTTPException(400, str(e)) from e


class AskBody(BaseModel):
    question: str = Field(min_length=3, max_length=300)
    lang: str = Field(default="en", pattern="^(en|de|tr)$")


_ask_cache: dict[tuple[str, str, str], dict] = {}


@app.get("/api/ai/status")
def ai_status():
    """Whether AI features are on, the model, and today's spend from visitors against the daily budget (no secrets)."""
    spent = ai.spent(live_only=True, today_only=True)
    return {"configured": ai.configured(), "model": ai.model_name() if ai.configured() else None,
            "budgetTodayUsd": settings.ai_daily_budget_usd, "spentTodayUsd": round(spent, 4),
            "available": ai.configured() and spent < settings.ai_daily_budget_usd}


@app.get("/api/plots/{plot_id}/facts")
def plot_facts(plot_id: Annotated[str, Path(pattern=PLOT_ID)]):
    """The facts sheet the AI writes from: every number in an AI text must appear here (no AI call, no cost)."""
    try:
        return reports.facts(plot_id)
    except reports.ReportError as e:
        raise HTTPException(404, str(e)) from e


@app.post("/api/plots/{plot_id}/ask")
def ask_plot(request: Request, body: AskBody, plot_id: Annotated[str, Path(pattern=PLOT_ID)]):
    """Answer a visitor's question about a plot from its evidence only; numbers are checked against the facts."""
    key = (plot_id, body.lang, " ".join(body.question.lower().split()))
    if key in _ask_cache:
        return _ask_cache[key] | {"cached": True}
    guards.rate_limit("ask", guards.client_ip(request), limit=12, window_s=3600)
    try:
        out = reports.ask(plot_id, body.question, body.lang)
    except reports.ReportError as e:
        raise HTTPException(404, str(e)) from e
    except ai.AIUnavailable as e:
        raise HTTPException(503, str(e)) from e
    if len(_ask_cache) > 500:
        _ask_cache.clear()
    _ask_cache[key] = out
    return out


def _plots_by_chain() -> dict[int, dict]:
    return {f["properties"]["chainId"]: f["properties"] for f in _load_json("plots.geojson")["features"]
            if f["properties"]["chainId"] is not None}


def _require_chain() -> None:
    if not oracle.chain_ready():
        raise HTTPException(503, "contracts not deployed")


@app.get("/api/certificates")
def list_certificates(funder: Annotated[str | None, Query(pattern=ADDRESS)] = None):
    """All certificates (supporters wall), or one funder's (profile page), with display data."""
    _require_chain()
    plots = _plots_by_chain()
    try:
        return certificates.by_funder(funder, plots) if funder else certificates.all_certificates(plots)
    except ValueError as e:
        raise HTTPException(400, "invalid address") from e


@app.get("/api/certificates/{cert_id}")
def certificate_metadata(
    cert_id: Annotated[str, Path(pattern=r"^([1-9][0-9]{0,7}|[0-9a-f]{12})$")], view: Annotated[str | None, Query(pattern="^full$")] = None
):
    """ERC-721 metadata (tokenURI target, by token id) or, by its 12-character reference, the same certificate.
    ?view=full returns the display data used by the app."""
    _require_chain()
    try:
        c = certificates.certificate(certificates.resolve(cert_id), _plots_by_chain())
    except oracle.OracleError as e:
        raise HTTPException(404, str(e)) from e
    return c if view == "full" else certificates.metadata(c)


@app.get("/api/certificates/{token_id}/image.svg")
def certificate_image(token_id: Annotated[int, Path(ge=1, le=10_000_000)]):
    _require_chain()
    try:
        c = certificates.certificate(token_id, _plots_by_chain())
    except oracle.OracleError as e:
        raise HTTPException(404, str(e)) from e
    return Response(certificates.image_svg(c), media_type="image/svg+xml", headers={"Cache-Control": "max-age=30"})
