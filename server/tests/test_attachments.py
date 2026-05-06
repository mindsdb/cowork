"""Tests for services/attachments.py."""
import zipfile
from base64 import b64decode
from io import BytesIO
from unittest.mock import patch

import pytest
from services.attachments import (
    UrlValidationError,
    attachment_context,
    new_id,
    safe_name,
    text_preview,
    truncate_text,
    validate_url_target,
)


def _zipped(parts: dict[str, str]) -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in parts.items():
            zf.writestr(name, content)
    return buf.getvalue()


class TestSafeName:
    def test_preserves_normal(self):
        assert safe_name("hello world.txt") == "hello world.txt"

    def test_sanitizes_slashes(self):
        assert safe_name("../../etc/passwd") == ".._.._etc_passwd"

    def test_empty_fallback(self):
        assert safe_name("") == "attachment"

    def test_whitespace_fallback(self):
        assert safe_name("   ") == "attachment"

    def test_truncates_long(self):
        assert len(safe_name("a" * 200 + ".txt")) <= 140


class TestTextPreview:
    def test_none(self):
        assert text_preview(None) == ""

    def test_empty(self):
        assert text_preview("") == ""

    def test_truncates(self):
        assert len(text_preview("x" * 500)) <= 320

    def test_collapses_whitespace(self):
        assert text_preview("hello\n\nworld") == "hello world"


class TestTruncateText:
    def test_short_text(self):
        text, truncated = truncate_text("short")
        assert text == "short"
        assert truncated is False

    def test_long_text(self):
        text, truncated = truncate_text("x" * 200_000)
        assert truncated is True
        assert len(text) <= 120_000

    def test_exact_limit(self):
        _, truncated = truncate_text("ab", limit=2)
        assert truncated is False

    def test_over_limit(self):
        text, truncated = truncate_text("abc", limit=2)
        assert truncated is True
        assert text == "ab"


class TestNewId:
    def test_unique(self):
        assert new_id() != new_id()

    def test_default_prefix(self):
        assert new_id().startswith("att_")

    def test_custom_prefix(self):
        assert new_id("file").startswith("file_")


class TestValidateUrlTarget:
    def test_rejects_ftp(self):
        with pytest.raises(UrlValidationError):
            validate_url_target("ftp://example.com/file")

    def test_rejects_javascript(self):
        with pytest.raises(UrlValidationError):
            validate_url_target("javascript:alert(1)")

    def test_rejects_file(self):
        with pytest.raises(UrlValidationError):
            validate_url_target("file:///etc/passwd")

    def test_rejects_empty_hostname(self):
        with pytest.raises(UrlValidationError):
            validate_url_target("http://")

    def test_rejects_localhost(self):
        with pytest.raises(UrlValidationError):
            validate_url_target("http://localhost/path")

    def test_rejects_localdomain(self):
        with pytest.raises(UrlValidationError):
            validate_url_target("http://localhost.localdomain/path")

    def test_rejects_dot_local(self):
        with pytest.raises(UrlValidationError):
            validate_url_target("https://myhost.local/api")

    @pytest.mark.parametrize("ip,label", [
        ("192.168.1.1", "private"),
        ("127.0.0.1", "loopback"),
        ("169.254.169.254", "metadata"),
        ("169.254.1.1", "link-local"),
    ])
    def test_rejects_internal_ips(self, ip, label):
        import socket
        def mock(*a, **kw):
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", (ip, 80))]
        with patch("socket.getaddrinfo", mock):
            with pytest.raises(UrlValidationError):
                validate_url_target("http://evil.com")

    def test_allows_public_ip(self):
        import socket
        def mock(*a, **kw):
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.216.34", 80))]
        with patch("socket.getaddrinfo", mock):
            assert validate_url_target("http://example.com/page") == "http://example.com/page"


class TestAttachmentContext:
    def test_none_ids(self):
        assert attachment_context(None) == ""

    def test_empty_ids(self):
        assert attachment_context([]) == ""

    def test_nonexistent_ids(self):
        assert attachment_context(["nonexistent"]) == ""


class TestAttachmentRoutes:
    def test_snippet_create(self, app_client):
        resp = app_client.post("/v1/attachments/snippet", json={
            "title": "Test", "content": "hello",
        })
        assert resp.status_code == 200
        assert resp.json()["attachment"]["kind"] == "snippet"

    def test_file_upload_text_extraction(self, app_client):
        resp = app_client.post("/v1/attachments/upload",
            files=[("files", ("test.txt", b"extracted text", "text/plain"))])
        assert resp.status_code == 200
        assert "extracted text" in resp.json()["attachments"][0]["text"]

    def test_docx_extraction(self, app_client):
        docx = _zipped({
            "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DocxOK</w:t></w:r></w:p></w:body></w:document>',
        })
        resp = app_client.post("/v1/attachments/upload",
            files=[("files", ("t.docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))])
        assert "DocxOK" in resp.json()["attachments"][0]["text"]

    def test_xlsx_extraction(self, app_client):
        xlsx = _zipped({
            "xl/sharedStrings.xml": '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>XlsxOK</t></si></sst>',
            "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c t="s"><v>0</v></c></row></sheetData></worksheet>',
        })
        resp = app_client.post("/v1/attachments/upload",
            files=[("files", ("t.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))])
        assert "XlsxOK" in resp.json()["attachments"][0]["text"]

    def test_pptx_extraction(self, app_client):
        pptx = _zipped({
            "ppt/slides/slide1.xml": '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>PptxOK</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
        })
        resp = app_client.post("/v1/attachments/upload",
            files=[("files", ("t.pptx", pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation"))])
        assert "PptxOK" in resp.json()["attachments"][0]["text"]

    def test_image_preview_only(self, app_client):
        png = b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=")
        resp = app_client.post("/v1/attachments/upload",
            files=[("files", ("pixel.png", png, "image/png"))])
        assert resp.json()["attachments"][0]["extractionStatus"] == "preview_only"

    def test_ssrf_blocked(self, app_client):
        resp = app_client.post("/v1/attachments/url", json={"url": "http://127.0.0.1:8765/private"})
        assert resp.status_code == 400

    def test_delete(self, app_client):
        created = app_client.post("/v1/attachments/snippet", json={"title": "X", "content": "y"})
        att_id = created.json()["attachment"]["id"]
        resp = app_client.delete(f"/v1/attachments/{att_id}")
        assert resp.status_code == 200

    def test_delete_missing_404(self, app_client):
        resp = app_client.delete("/v1/attachments/nonexistent")
        assert resp.status_code == 404

    def test_list(self, app_client):
        app_client.post("/v1/attachments/snippet", json={"title": "A", "content": "a"})
        resp = app_client.get("/v1/attachments")
        assert resp.status_code == 200
        assert len(resp.json()["attachments"]) >= 1
