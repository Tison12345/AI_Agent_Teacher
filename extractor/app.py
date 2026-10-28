"""A small HTTP service that turns an uploaded PDF or DOCX into text.

Run it from this folder (see README): `uvicorn app:app --host 127.0.0.1 --port 8001`.

Safety, kept simple for a demo:
  * it listens on localhost only (the start command binds 127.0.0.1);
  * every request must carry the shared secret in `X-Extractor-Key`; with no secret configured the
    service refuses all work instead of running open;
  * it never talks to Supabase or Gemini, and never runs anything from the uploaded file.
"""

from __future__ import annotations

import hmac
import os
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from extraction import ExtractionError, extract

MAX_UPLOAD_BYTES = 4 * 1024 * 1024  # the same cap as the website and the storage bucket


def _key_from_env_file() -> str | None:
    """Reads EXTRACTOR_KEY from the website's .env.local so the demo needs only one place for it."""
    path = Path(__file__).resolve().parent.parent / ".env.local"
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            name, sep, value = line.partition("=")
            if sep and name.strip() == "EXTRACTOR_KEY":
                return value.strip().strip("\"'") or None
    except OSError:
        pass
    return None


def configured_key() -> str | None:
    return os.environ.get("EXTRACTOR_KEY") or _key_from_env_file()


app = FastAPI(title="Submission text extractor", docs_url=None, redoc_url=None, openapi_url=None)


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


@app.get("/health")
def health() -> dict:
    return {"ok": True, "configured": configured_key() is not None}


@app.post("/extract")
async def extract_endpoint(
    request: Request,
    type: str = Query(..., pattern="^(pdf|docx)$"),
    x_extractor_key: str | None = Header(default=None),
):
    expected = configured_key()
    if not expected:
        return _error(503, "not_configured", "The extractor has no EXTRACTOR_KEY configured.")
    if not x_extractor_key or not hmac.compare_digest(x_extractor_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        return _error(413, "too_large", "The file is larger than 4 MB.")
    data = await request.body()
    if not data:
        return _error(400, "empty", "No file was sent.")
    if len(data) > MAX_UPLOAD_BYTES:
        return _error(413, "too_large", "The file is larger than 4 MB.")

    try:
        return extract(data, type)
    except ExtractionError as exc:
        return _error(422, exc.code, exc.message)
