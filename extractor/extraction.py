"""Text extraction for student submissions: PDF text layers and DOCX documents.

Adapted from the classroom pipeline's `extract_pdf_content` (PyMuPDF, one call per page) and
`extract_word_content` (python-docx). Differences, on purpose:
  * it works on bytes, not on a Google Drive file id;
  * it reports each page and every problem instead of returning a bare string, so a scanned page
    is never silently turned into "no text";
  * DOCX paragraphs and tables are read in document order;
  * it has hard limits, because the files come from students.
No OCR happens here. A page with no text layer is reported, not guessed.
"""

from __future__ import annotations

import io
import zipfile

MAX_PAGES = 50
MAX_TEXT_CHARS = 200_000
MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
#: A PDF page with fewer characters than this is treated as having no text layer.
BLANK_PAGE_CHARS = 30


class ExtractionError(Exception):
    """The file cannot be read. `code` is stable; `message` is safe to show to a user."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _result(parts: list[str], pages: list[dict], warnings: list[str]) -> dict:
    text = "\n\n".join(parts)
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]
        warnings.append(f"The text was cut off after {MAX_TEXT_CHARS:,} characters.")
    return {"text": text, "pages": pages, "warnings": warnings}


def extract_pdf(data: bytes) -> dict:
    import pymupdf

    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # corrupt or not a PDF
        raise ExtractionError("unreadable", "This file could not be opened as a PDF.") from exc

    try:
        if doc.needs_pass:
            raise ExtractionError("encrypted", "This PDF is password protected.")
        if doc.page_count == 0:
            raise ExtractionError("empty", "This PDF has no pages.")
        if doc.page_count > MAX_PAGES:
            raise ExtractionError(
                "too_many_pages", f"This PDF has {doc.page_count} pages; the limit is {MAX_PAGES}."
            )

        parts: list[str] = []
        pages: list[dict] = []
        warnings: list[str] = []
        for index in range(doc.page_count):
            number = index + 1
            try:
                text = doc[index].get_text().strip()
            except Exception as exc:
                raise ExtractionError("unreadable", f"Page {number} could not be read.") from exc
            pages.append({"number": number, "chars": len(text)})
            if len(text) < BLANK_PAGE_CHARS:
                warnings.append(f"Page {number} has no readable text (it may be a scan or an image).")
            parts.append(f"Page {number}:\n{text}")
        return _result(parts, pages, warnings)
    finally:
        doc.close()


def _check_docx_zip(data: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            total = sum(info.file_size for info in archive.infolist())
            names = set(archive.namelist())
    except zipfile.BadZipFile as exc:
        raise ExtractionError("unreadable", "This file could not be opened as a Word document.") from exc
    if "word/document.xml" not in names:
        raise ExtractionError("unreadable", "This file is not a Word (.docx) document.")
    if total > MAX_DOCX_UNCOMPRESSED_BYTES:
        raise ExtractionError("too_large", "This document is too large once unpacked.")


def extract_docx(data: bytes) -> dict:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    _check_docx_zip(data)
    try:
        document = Document(io.BytesIO(data))
    except Exception as exc:
        raise ExtractionError("unreadable", "This file could not be opened as a Word document.") from exc

    parts: list[str] = []
    # Paragraphs and tables in the order they appear (the pipeline read all paragraphs, then all tables).
    for child in document.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            text = Paragraph(child, document).text.strip()
            if text:
                parts.append(text)
        elif tag == "tbl":
            for row in Table(child, document).rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    parts.append(" | ".join(cells))

    text_length = len("\n\n".join(parts))
    warnings: list[str] = []
    images = len(document.inline_shapes)
    if images:
        warnings.append(
            f"The document contains {images} image(s); any text inside images was not read."
        )
    # A Word file has no fixed pages: report it as one block of text.
    return _result(parts, [{"number": 1, "chars": text_length}], warnings)


def extract(data: bytes, file_type: str) -> dict:
    if file_type == "pdf":
        return extract_pdf(data)
    if file_type == "docx":
        return extract_docx(data)
    raise ExtractionError("unsupported_type", "Only PDF and DOCX files are supported.")
