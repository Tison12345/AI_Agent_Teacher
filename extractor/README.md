# Submission text extractor

A tiny local service that reads the text out of an uploaded PDF or DOCX. The website sends it the file's bytes and gets text back; it never talks to Supabase or Gemini and never runs anything from a file.

- PDFs: PyMuPDF text layer, page by page. A page with no text layer is **reported**, not guessed (no OCR in this version).
- DOCX: python-docx, paragraphs and tables in document order. Images are reported, not read.
- Limits: 4 MB, 50 PDF pages, 200,000 characters. Password-protected and corrupt files are refused with a clear message.
- Adapted from `extract_pdf_content` / `extract_word_content` in the classroom pipeline. Nothing else from that pipeline is used (no Google Classroom, Ollama, MongoDB, ChromaDB, Whisper or FFmpeg).

## One-time setup (Python 3.12, Windows)

```powershell
cd extractor
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
```

## Run (keep this window open during the demo)

```powershell
cd extractor
.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8001
```

The shared secret `EXTRACTOR_KEY` is read from the website's `.env.local` (or from an `EXTRACTOR_KEY` environment variable). With no key configured the service refuses every request. It listens on `127.0.0.1` only.

Check it: open http://127.0.0.1:8001/health → `{"ok": true, "configured": true}`.

## Tests

```powershell
cd extractor
.venv\Scripts\python -m pytest
```
