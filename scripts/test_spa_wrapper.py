"""Exercise the Docker SPA wrapper's real routes with an isolated cowork-server app."""

from html import unescape
import importlib.util
import json
import os
import re
from pathlib import Path
import sys
import tempfile
from types import ModuleType
import unittest
from unittest.mock import patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
META_NAME = "cowork-provider-tests-enabled"
PICKER_META_NAME = "cowork-model-picker"
EFFORTS_META_NAME = "cowork-model-efforts"
TOKEN_META_NAME = "cowork-shared-publish-token"


class SpaWrapperTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.spa = Path(temporary.name)
        # Use the renderer's real shell so its head and script placement stay covered.
        self.html = (ROOT / "src/renderer/index-web.html").read_text(encoding="utf-8")
        (self.spa / "index-web.html").write_text(self.html, encoding="utf-8")
        (self.spa / "other.html").write_text("<html><title>A static page</title></html>", encoding="utf-8")
        (self.spa / "icon.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        for folder in ("assets", "brand"):
            (self.spa / folder).mkdir()
        (self.spa / "assets/main.js").write_bytes(b"console.log('bundle');\n")
        (self.spa / "brand/brand.js").write_bytes(b"window.COWORK_DEPLOYMENT_BRAND = {};\n")

    def client(self, value=None, model_picker=None, **extra):
        server = ModuleType("cowork.server")
        server.app = FastAPI()

        @server.app.api_route("/api/v1/echo/", methods=["GET", "POST"])
        async def echo(request: Request):
            return {
                "method": request.method,
                "body": (await request.body()).decode(),
                "query": request.url.query,
            }

        spec = importlib.util.spec_from_file_location("spa_wrapper", ROOT / "scripts/spa_wrapper.py")
        module = importlib.util.module_from_spec(spec)
        environment = {"COWORK_SPA_DIR": str(self.spa)}
        if value is not None:
            environment["COWORK_PROVIDER_TESTS_ENABLED"] = value
        if model_picker is not None:
            environment["COWORK_MODEL_PICKER"] = model_picker
        environment.update(extra)
        with patch.dict(os.environ, environment, clear=True), patch.dict(
            sys.modules, {"cowork": ModuleType("cowork"), "cowork.server": server}
        ):
            spec.loader.exec_module(module)
        return TestClient(server.app, follow_redirects=False)

    def assert_shell(self, response, expected, shared_token="false"):
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "text/html; charset=utf-8")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers.get("x-cowork-spa-shell"), "1")
        self.assertEqual(int(response.headers["content-length"]), len(response.content))
        self.assertNotIn("etag", response.headers)
        self.assertNotIn("last-modified", response.headers)
        meta = f'<meta name="{META_NAME}" content="{expected}">'
        token_meta = f'<meta name="{TOKEN_META_NAME}" content="{shared_token}">'
        self.assertEqual(response.text.count(META_NAME), 1)
        self.assertEqual(response.text.count(TOKEN_META_NAME), 1)
        self.assertIn(meta, response.text)
        self.assertLess(response.text.index(meta), response.text.index("<script"))
        self.assertLess(response.text.index(token_meta), response.text.index("<script"))
        self.assertEqual(response.text.replace(f"\n    {meta}\n    {token_meta}", "", 1), self.html)

    def test_every_shell_url_receives_the_default_or_explicit_setting(self):
        for value, expected in ((None, "true"), ("true", "true"), ("false", "false")):
            with self.client(value) as client:
                for path in ("/", "/c/conversation-id", "/index-web.html", "/index-web.html?from=login"):
                    with self.subTest(value=value, path=path):
                        self.assert_shell(client.get(path), expected)
        self.assertEqual((self.spa / "index-web.html").read_text(encoding="utf-8"), self.html)

    def test_restarting_with_a_different_setting_changes_the_same_shell(self):
        with self.client("true") as client:
            self.assert_shell(client.get("/"), "true")
        with self.client("false") as client:
            response = client.get("/", headers={
                "If-None-Match": "*",
                "If-Modified-Since": "Wed, 21 Oct 2099 07:28:00 GMT",
            })
            self.assert_shell(response, "false")

    def test_malformed_environment_values_fail_without_echoing_them(self):
        for value in ("", "TRUE", "False", "0", "1", " false ", "not-a-boolean"):
            with self.subTest(value=value), self.assertRaises(ValueError) as error:
                self.client(value)
            self.assertEqual(str(error.exception), "COWORK_PROVIDER_TESTS_ENABLED must be 'true' or 'false'.")

    def test_top_level_and_mounted_assets_keep_their_original_bytes(self):
        with self.client("false") as client:
            for path in ("icon.png", "other.html", "assets/main.js", "brand/brand.js"):
                with self.subTest(path=path):
                    response = client.get(f"/{path}")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.content, (self.spa / path).read_bytes())
                    self.assertNotIn(META_NAME, response.text)
                    self.assertNotIn("x-cowork-spa-shell", response.headers)
            for path in ("/assets/missing.js", "/brand/missing.js"):
                with self.subTest(path=path):
                    response = client.get(path)
                    self.assertEqual(response.status_code, 404)
                    self.assertNotIn("x-cowork-spa-shell", response.headers)

    def test_api_redirect_keeps_the_method_query_and_body(self):
        with self.client("false") as client:
            response = client.post("/api/v1/echo?first=one&second=two", content="the posted body")
            self.assertEqual(response.status_code, 307)
            self.assertEqual(response.headers["location"], "/api/v1/echo/?first=one&second=two")
            self.assertNotIn("x-cowork-spa-shell", response.headers)
            response = client.post(
                "/api/v1/echo?first=one&second=two", content="the posted body", follow_redirects=True
            )
            self.assertEqual(response.json(), {
                "method": "POST", "body": "the posted body", "query": "first=one&second=two",
            })
            self.assertNotIn("x-cowork-spa-shell", response.headers)

    def test_unknown_api_routes_never_receive_the_shell(self):
        with self.client("false") as client:
            for method in ("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
                with self.subTest(method=method):
                    response = client.request(method, "/api/v1/missing", follow_redirects=False)
                    self.assertEqual(response.status_code, 307)
                    self.assertEqual(response.headers["location"], "/api/v1/missing/")
                    self.assertNotIn("x-cowork-spa-shell", response.headers)
                    response = client.request(method, "/api/v1/missing/")
                    self.assertEqual(response.status_code, 404)
                    self.assertNotIn(META_NAME, response.text)
                    self.assertNotIn("x-cowork-spa-shell", response.headers)

    def test_changed_templates_cannot_silently_drop_or_duplicate_the_setting(self):
        for html in (
            self.html.replace("<head>", ""),
            self.html.replace("<head>", "<head><head>"),
            self.html.replace("<head>", f"<head><meta name='{META_NAME}' content='true'>"),
        ):
            with self.subTest(html=html[:40]):
                (self.spa / "index-web.html").write_text(html, encoding="utf-8")
                with self.client("false") as client, self.assertRaises(ValueError) as error:
                    client.get("/")
                self.assertEqual(
                    str(error.exception), "The SPA shell needs one <head> and no provider-testing metadata."
                )

    def test_the_shell_says_whether_a_shared_publish_token_is_set_and_never_carries_it(self):
        token = "publish-token-value-7f3a"
        for environment, expected in (
            ({}, "false"),
            ({"COWORK_PUBLISH_TOKEN": ""}, "false"),
            ({"COWORK_PUBLISH_TOKEN": "  "}, "false"),
            ({"COWORK_PUBLISH_TOKEN": token}, "true"),
        ):
            with self.client("false", **environment) as client:
                for path in ("/", "/c/conversation-id", "/index-web.html"):
                    with self.subTest(environment=environment, path=path):
                        response = client.get(path)
                        self.assert_shell(response, "false", shared_token=expected)
                        self.assertNotIn(token, response.text)

    def test_a_template_that_already_names_the_shared_publish_token_is_refused(self):
        html = self.html.replace("<head>", f"<head><meta name='{TOKEN_META_NAME}' content='false'>")
        (self.spa / "index-web.html").write_text(html, encoding="utf-8")
        with self.client("false", COWORK_PUBLISH_TOKEN="a-token") as client, self.assertRaises(ValueError) as error:
            client.get("/")
        self.assertEqual(str(error.exception), "The SPA shell needs no publish-token metadata.")

    def test_model_picker_off_or_unset_leaves_the_shell_as_today(self):
        for model_picker in (None, "off"):
            with self.subTest(model_picker=model_picker), self.client("false", model_picker) as client:
                response = client.get("/")
                self.assert_shell(response, "false")
                self.assertNotIn(PICKER_META_NAME, response.text)

    def test_model_picker_mode_reaches_every_shell_url_before_the_renderer(self):
        for model_picker in ("default", "open"):
            with self.client("false", model_picker) as client:
                for path in ("/", "/c/conversation-id", "/index-web.html"):
                    with self.subTest(model_picker=model_picker, path=path):
                        response = client.get(path)
                        tests_meta = f'<meta name="{META_NAME}" content="false">'
                        token_meta = f'<meta name="{TOKEN_META_NAME}" content="false">'
                        picker_meta = f'<meta name="{PICKER_META_NAME}" content="{model_picker}">'
                        self.assertEqual(response.text.count(PICKER_META_NAME), 1)
                        self.assertLess(response.text.index(picker_meta), response.text.index("<script"))
                        self.assertEqual(
                            response.text.replace(f"\n    {tests_meta}\n    {token_meta}\n    {picker_meta}", "", 1),
                            self.html,
                        )

    def test_malformed_model_picker_values_fail_without_echoing_them(self):
        for model_picker in ("", "DEFAULT", "Open", "on", "true", " open ", "locked"):
            with self.subTest(model_picker=model_picker), self.assertRaises(ValueError) as error:
                self.client("false", model_picker)
            self.assertEqual(str(error.exception), "COWORK_MODEL_PICKER must be 'off', 'default' or 'open'.")

    def test_a_template_that_already_names_the_model_picker_is_refused(self):
        html = self.html.replace("<head>", f"<head><meta name='{PICKER_META_NAME}' content='open'>")
        (self.spa / "index-web.html").write_text(html, encoding="utf-8")
        with self.client("false", "default") as client, self.assertRaises(ValueError) as error:
            client.get("/")
        self.assertEqual(str(error.exception), "The SPA shell needs no model-picker metadata.")

    def efforts_meta(self, response):
        """The efforts tag's content, read back as the renderer's DOM reads it."""
        found = re.findall(rf'<meta name="{EFFORTS_META_NAME}" content="([^"]*)">', response.text)
        self.assertEqual(len(found), 1)
        self.assertLess(response.text.index(EFFORTS_META_NAME), response.text.index("<script"))
        return json.loads(unescape(found[0]))

    def test_model_efforts_reach_every_shell_url_with_the_operator_defaults_shared_efforts(self):
        efforts = {"opus-5-5": ["xhigh"], "gpt-5.6-luna": ["low", "medium"], "gpt-luna-5-6": ["medium", "low"]}
        for planning, coding, shared in (
            ("gpt-5.6-luna", "gpt-luna-5-6", ["low", "medium"]),
            ("gpt-5.6-luna", "gpt-5.6-luna", ["low", "medium"]),
            ("gpt-5.6-luna", "opus-5-5", []),
            # A role model the operator lets users pick no effort on.
            ("gpt-5.6-luna", "claude-haiku-5-5", []),
        ):
            with self.client("false", "default", COWORK_MODEL_EFFORTS=json.dumps(efforts),
                             PLANNING_MODEL=planning, CODING_MODEL=coding) as client:
                for path in ("/", "/c/conversation-id"):
                    with self.subTest(coding=coding, path=path):
                        self.assertEqual(self.efforts_meta(client.get(path)),
                                         {"models": efforts, "operatorDefault": shared})

    def test_model_ids_that_html_would_read_reach_the_renderer_as_written(self):
        efforts = {'op"us<5>&5\'é': ["xhigh"]}
        with self.client("false", "open", COWORK_MODEL_EFFORTS=json.dumps(efforts)) as client:
            response = client.get("/")
        self.assertEqual(self.efforts_meta(response), {"models": efforts, "operatorDefault": []})
        self.assertNotIn("<5>", response.text)

    def test_without_model_efforts_the_shell_has_no_effort_tag(self):
        for model_picker in ("default", "open"):
            with self.subTest(model_picker=model_picker), self.client("false", model_picker,
                                                                      COWORK_MODEL_EFFORTS="") as client:
                self.assertNotIn(EFFORTS_META_NAME, client.get("/").text)

    def test_model_efforts_without_the_picker_fail(self):
        for model_picker in (None, "off"):
            with self.subTest(model_picker=model_picker), self.assertRaises(ValueError) as error:
                self.client("false", model_picker, COWORK_MODEL_EFFORTS='{"opus-5-5": ["xhigh"]}')
            self.assertEqual(str(error.exception), "COWORK_MODEL_EFFORTS needs COWORK_MODEL_PICKER 'default' or 'open'.")

    def test_malformed_model_efforts_fail_without_echoing_them(self):
        for value in ("opus-5-5=xhigh", "[]", '["xhigh"]', '{"opus-5-5": "xhigh"}', '{"opus-5-5": ["XHIGH"]}',
                      '{"opus-5-5": ["x high"]}', '{"opus-5-5": [1]}', '{"opus-5-5": ["xhigh"]'):
            with self.subTest(value=value), self.assertRaises(ValueError) as error:
                self.client("false", "default", COWORK_MODEL_EFFORTS=value)
            self.assertEqual(str(error.exception),
                             "COWORK_MODEL_EFFORTS must be a JSON object of model ids to lists of lowercase efforts.")

    def test_a_template_that_already_names_the_model_efforts_is_refused(self):
        html = self.html.replace("<head>", f"<head><meta name='{EFFORTS_META_NAME}' content='{{}}'>")
        (self.spa / "index-web.html").write_text(html, encoding="utf-8")
        with self.client("false", "default") as client, self.assertRaises(ValueError) as error:
            client.get("/")
        self.assertEqual(str(error.exception), "The SPA shell needs no model-picker metadata.")


if __name__ == "__main__":
    unittest.main()
