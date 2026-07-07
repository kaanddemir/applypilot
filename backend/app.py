"""ApplyPilot backend: FastAPI app serving the static frontend plus a few
utility endpoints. All AI calls happen in the browser (cloud providers with a
user key, or local WebLLM), so the backend is stateless and needs no API key.

Endpoints:
- POST /api/fetch-job         fetch + clean a posting URL
- POST /api/parse-profile-file extract text from an uploaded .txt/.pdf/.docx
- GET  /api/prompt-config      shared prompt templates for the browser providers

Run with:  uvicorn app:app --reload
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import prompts
from fetcher import FetchError, fetch_job_posting

load_dotenv()

app = FastAPI(title="ApplyPilot")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


# --- Request models --------------------------------------------------------

class FetchJobRequest(BaseModel):
    url: str


# --- Helpers ---------------------------------------------------------------

async def _read_profile_upload(file: UploadFile) -> tuple[str, str]:
    """Extract selectable text from a supported CV/profile file."""
    filename = Path(file.filename or "").name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".txt", ".pdf", ".docx"}:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload a .txt, .pdf, or .docx file.",
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File is too large. Maximum size is 10 MB.")

    try:
        if suffix == ".txt":
            text = raw.decode("utf-8")
        elif suffix == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(BytesIO(raw))
            text = "\n\n".join((page.extract_text() or "").strip() for page in reader.pages)
        else:
            from docx import Document

            doc = Document(BytesIO(raw))
            text = "\n".join(p.text.strip() for p in doc.paragraphs if p.text.strip())
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Could not read the text file as UTF-8.") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not parse the file: {exc}") from exc

    text = text.strip()
    if not text:
        raise HTTPException(
            status_code=400,
            detail="No selectable text was found in the file. Scanned PDFs are not supported.",
        )
    return filename, text


# --- Endpoints -------------------------------------------------------------

@app.post("/api/fetch-job")
def fetch_job(req: FetchJobRequest):
    try:
        text = fetch_job_posting(req.url)
    except FetchError as exc:
        # Not a 500: the URL just wasn't usable. The UI falls back to paste.
        return {"text": "", "error": str(exc)}
    return {"text": text}


@app.post("/api/parse-profile-file")
async def parse_profile_file(file: UploadFile = File(...)):
    filename, text = await _read_profile_upload(file)
    return {"filename": filename, "text": text}


@app.get("/api/prompt-config")
def prompt_config():
    """Expose the prompt templates so the browser providers (cloud or local
    WebLLM) can build the exact same persona and analysis framing. No profile is
    sent here; the client fills the {user_profile} slot itself."""
    return {
        "system_prompt": prompts.system_prompt_template(),
        "analyze_framing": prompts.ANALYZE_FRAMING,
    }


# Serve the frontend at the root. Mounted last so /api/* takes precedence.
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
