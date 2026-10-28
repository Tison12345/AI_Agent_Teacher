"""Tests for the HTTP layer. Needs fastapi and httpx (see requirements-dev.txt)."""

import os

from fastapi.testclient import TestClient

import app as app_module
from test_extraction import make_docx, make_pdf

client = TestClient(app_module.app)
KEY = "test-key-123"


def with_key(value):
    """Sets (or removes) the configured key for one test and stops the .env.local fallback."""
    if value is None:
        os.environ.pop("EXTRACTOR_KEY", None)
    else:
        os.environ["EXTRACTOR_KEY"] = value
    app_module._key_from_env_file = lambda: None


def post(data: bytes, type_: str = "pdf", key: str | None = KEY):
    headers = {"X-Extractor-Key": key} if key is not None else {}
    return client.post(f"/extract?type={type_}", content=data, headers=headers)


def test_extracts_a_pdf_with_the_right_key():
    with_key(KEY)
    res = post(make_pdf(["A loop repeats a block of code until a condition stops it."]))
    assert res.status_code == 200
    body = res.json()
    assert "A loop repeats" in body["text"]
    assert body["pages"] == [{"number": 1, "chars": body["pages"][0]["chars"]}]


def test_extracts_a_docx():
    with_key(KEY)
    res = post(make_docx(lambda d: d.add_paragraph("An array is an ordered collection.")), "docx")
    assert res.status_code == 200
    assert "ordered collection" in res.json()["text"]


def test_wrong_or_missing_key_is_refused():
    with_key(KEY)
    assert post(make_pdf(["hello world, long enough text"]), key="nope").status_code == 401
    assert post(make_pdf(["hello world, long enough text"]), key=None).status_code == 401


def test_without_a_configured_key_the_service_refuses_all_work():
    with_key(None)
    res = post(make_pdf(["hello world, long enough text"]))
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "not_configured"
    assert client.get("/health").json() == {"ok": True, "configured": False}


def test_unreadable_file_gives_a_clear_422():
    with_key(KEY)
    res = post(b"definitely not a pdf")
    assert res.status_code == 422
    assert res.json()["error"] == {"code": "unreadable", "message": "This file could not be opened as a PDF."}


def test_empty_oversize_and_bad_type_are_refused():
    with_key(KEY)
    assert post(b"").status_code == 400
    assert post(b"x" * (4 * 1024 * 1024 + 1)).status_code == 413
    assert client.post("/extract?type=exe", content=b"x", headers={"X-Extractor-Key": KEY}).status_code == 422


def test_health_does_not_need_a_key_and_hides_it():
    with_key(KEY)
    body = client.get("/health").json()
    assert body == {"ok": True, "configured": True}
    assert KEY not in str(body)
