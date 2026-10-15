"""ApplyPilot's local FastAPI server and protected Gemini analysis endpoint."""

from __future__ import annotations

import asyncio
import logging
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from analysis_validation import InsufficientJobInformation, assess_input
from config import settings
from gemini import GeminiFailure, analyze_with_gemini
from models import AnalysisRequest, AnalysisResponse
from protection import CapacityGuard, RateLimitExceeded, SlidingWindowLimiter

logger = logging.getLogger(__name__)


class _PypdfWrongPointerFilter(logging.Filter):
    """Hide only pypdf's per-object notice for xref entries it already discarded."""

    _applypilot_wrong_pointer_filter = True

    def filter(self, record: logging.LogRecord) -> bool:
        return not (
            isinstance(record.msg, str)
            and record.msg.startswith("Ignoring wrong pointing object ")
        )


# pypdf emits one warning for every bad cross-reference entry it safely drops
# in non-strict mode. Keep every other pypdf warning and all parse failures.
_pypdf_reader_logger = logging.getLogger("pypdf._reader")
if not any(getattr(item, "_applypilot_wrong_pointer_filter", False) for item in _pypdf_reader_logger.filters):
    _pypdf_reader_logger.addFilter(_PypdfWrongPointerFilter())

app = FastAPI(title="ApplyPilot", version="2.0.0")
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

analysis_limiter = SlidingWindowLimiter(
    settings.analysis_client_limit_per_minute,
    settings.analysis_global_limit_per_minute,
)
analysis_capacity = CapacityGuard(settings.analysis_max_concurrency)
profile_upload_limiter = SlidingWindowLimiter(12, 40)
profile_capacity = CapacityGuard(2)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, retry_after: int | None = None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message
        self.retry_after = retry_after


def error_response(status: int, code: str, message: str, retry_after: int | None = None):
    headers = {"Retry-After": str(retry_after)} if retry_after is not None else None
    return JSONResponse(
        status_code=status,
        headers=headers,
        content={"error": {"code": code, "message": message}},
    )


@app.exception_handler(ApiError)
async def handle_api_error(_request: Request, exc: ApiError):
    return error_response(exc.status, exc.code, exc.message, exc.retry_after)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_request: Request, _exc: RequestValidationError):
    return error_response(422, "invalid_request", "The request contains invalid or oversized input.")


class AnalysisBodyLimitMiddleware:
    """Bound analysis JSON and CV uploads before parsing chunked request bodies."""

    def __init__(self, wrapped_app, max_bytes: int):
        self.wrapped_app = wrapped_app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        path = scope.get("path")
        if scope["type"] != "http" or path not in {"/api/analyze-job", "/api/parse-profile-file"}:
            await self.wrapped_app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        origin = headers.get(b"origin")
        same_origin = (scope.get("scheme", "http") + "://" + headers.get(b"host", b"").decode("latin-1"))
        if origin is not None and origin.decode("latin-1") not in {same_origin, *settings.cors_origins}:
            await error_response(403, "origin_forbidden", "This browser origin is not allowed.")(scope, receive, send)
            return
        if path == "/api/parse-profile-file":
            client = scope.get("client")
            try:
                profile_upload_limiter.check(client[0] if client else "unknown")
            except RateLimitExceeded as exc:
                await error_response(429, "rate_limited", "Too many file uploads.", exc.retry_after)(scope, receive, send)
                return
        max_bytes = self.max_bytes if path == "/api/analyze-job" else 11 * 1024 * 1024
        overflow_message = "The analysis request is too large." if path == "/api/analyze-job" else "The uploaded file is too large."
        raw_length = headers.get(b"content-length")
        if raw_length:
            try:
                if int(raw_length) > max_bytes:
                    await error_response(413, "invalid_request", overflow_message)(
                        scope, receive, send
                    )
                    return
            except ValueError:
                await error_response(400, "invalid_request", "Invalid Content-Length header.")(
                    scope, receive, send
                )
                return

        chunks = []
        received = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body = message.get("body", b"")
            received += len(body)
            if received > max_bytes:
                await error_response(413, "invalid_request", overflow_message)(
                    scope, receive, send
                )
                return
            chunks.append(body)
            if not message.get("more_body", False):
                break

        replayed = False

        async def replay_receive():
            nonlocal replayed
            if replayed:
                return await receive()
            replayed = True
            return {"type": "http.request", "body": b"".join(chunks), "more_body": False}

        await self.wrapped_app(scope, replay_receive, send)


app.add_middleware(AnalysisBodyLimitMiddleware, max_bytes=settings.analysis_max_body_bytes)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )


async def _read_profile_upload(file: UploadFile) -> tuple[str, str]:
    """Extract selectable text from a supported CV/profile file."""
    filename = Path(file.filename or "").name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".txt", ".pdf", ".docx"}:
        raise HTTPException(400, "Unsupported file type. Please upload a .txt, .pdf, or .docx file.")

    raw = await file.read(10 * 1024 * 1024 + 1)
    if not raw:
        raise HTTPException(400, "The uploaded file is empty.")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, "File is too large. Maximum size is 10 MB.")
    return filename, await run_in_threadpool(_extract_profile_text, raw, suffix)


def _extract_profile_text(raw: bytes, suffix: str) -> str:
    """Run document decoding off the event loop with bounded concurrency."""

    if suffix == ".pdf" and not raw.startswith(b"%PDF-"):
        raise HTTPException(400, "The file is not a valid PDF.")
    if suffix == ".docx":
        try:
            with ZipFile(BytesIO(raw)) as archive:
                parts = archive.infolist()
                if (len(parts) > 500 or len({part.filename for part in parts}) != len(parts)
                        or sum(part.file_size for part in parts) > 30 * 1024 * 1024
                        or "word/document.xml" not in archive.namelist()):
                    raise HTTPException(400, "The Word file is invalid or too large when opened.")
        except BadZipFile as exc:
            raise HTTPException(400, "The file is not a valid DOCX.") from exc

    try:
        if suffix == ".txt":
            text = raw.decode("utf-8")
        elif suffix == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(BytesIO(raw))
            if len(reader.pages) > 100:
                raise HTTPException(400, "PDF has too many pages. Maximum is 100.")
            excerpts = []
            total = 0
            for page in reader.pages:
                excerpt = (page.extract_text() or "").strip()
                total += len(excerpt)
                if total > 30_000:
                    raise HTTPException(400, "Extracted CV text is too long. Maximum is 30,000 characters.")
                excerpts.append(excerpt)
            text = "\n\n".join(excerpts)
        else:
            from docx import Document

            text = "\n".join(p.text.strip() for p in Document(BytesIO(raw)).paragraphs if p.text.strip())
    except HTTPException:
        raise
    except UnicodeDecodeError as exc:
        raise HTTPException(400, "Could not read the text file as UTF-8.") from exc
    except Exception as exc:  # noqa: BLE001
        logger.warning("profile parse failed: %s", type(exc).__name__)
        raise HTTPException(400, "Could not parse the uploaded file.") from exc

    text = text.strip()
    if not text:
        raise HTTPException(400, "No selectable text was found. Scanned PDFs are not supported.")
    if len(text) > 30_000:
        raise HTTPException(400, "Extracted CV text is too long. Maximum is 30,000 characters.")
    return text


@app.post("/api/parse-profile-file")
async def parse_profile_file(file: UploadFile = File(...)):
    if not await profile_capacity.try_acquire():
        raise ApiError(503, "capacity_exhausted", "File processing is busy.", 1)
    try:
        filename, text = await _read_profile_upload(file)
        return {"filename": filename, "text": text}
    finally:
        await profile_capacity.release()


_GEMINI_ERRORS = {
    "output_exhausted": (502, "The analysis could not be completed within its response budget. No partial result was saved."),
    "incomplete_analysis": (502, "The analysis did not cover the full posting. No partial result was saved."),
    "provider_configuration": (503, "The analysis service configuration needs attention."),
    "configuration_missing": (503, "Gemini is not configured on this server."),
    "provider_authentication": (502, "Gemini authentication failed."),
    "provider_quota": (503, "Gemini usage quota is exhausted."),
    "provider_timeout": (504, "Gemini did not respond in time."),
    "provider_unavailable": (503, "Gemini is temporarily unavailable."),
    "invalid_provider_response": (502, "Gemini returned an invalid analysis."),
    "evidence_validation_failed": (502, "Gemini could not return verifiable job evidence. Please try again."),
}


async def _analysis_until_disconnect(request: Request, analysis: AnalysisRequest) -> AnalysisResponse:
    async def disconnected():
        while True:
            if (await request.receive())["type"] == "http.disconnect":
                return

    work = asyncio.create_task(analyze_with_gemini(analysis, current_settings=settings))
    monitor = asyncio.create_task(disconnected())
    try:
        done, _ = await asyncio.wait({work, monitor}, return_when=asyncio.FIRST_COMPLETED)
        if work in done:
            return await work
        raise ApiError(499, "request_cancelled", "Analysis was cancelled.")
    finally:
        for task in (work, monitor):
            if not task.done():
                task.cancel()
        await asyncio.gather(work, monitor, return_exceptions=True)


@app.post("/api/analyze-job", response_model=AnalysisResponse)
async def analyze_job(request: Request, analysis: AnalysisRequest) -> AnalysisResponse:
    try:
        assess_input(analysis)
    except InsufficientJobInformation as exc:
        raise ApiError(422, "insufficient_job_information", str(exc)) from exc
    client = request.client.host if request.client else "unknown"
    try:
        analysis_limiter.check(client)
    except RateLimitExceeded as exc:
        raise ApiError(429, "rate_limited", "Too many analysis requests.", exc.retry_after) from exc

    if not await analysis_capacity.try_acquire():
        raise ApiError(503, "capacity_exhausted", "Analysis capacity is currently full.", 1)
    try:
        return await _analysis_until_disconnect(request, analysis)
    except GeminiFailure as exc:
        status, message = _GEMINI_ERRORS.get(
            exc.code, (503, "Gemini is temporarily unavailable.")
        )
        raise ApiError(status, exc.code, message) from exc
    finally:
        await analysis_capacity.release()


@app.middleware("http")
async def no_store_frontend(request: Request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response


# Mounted last so /api/* routes take precedence.
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True, check_dir=False), name="frontend")
