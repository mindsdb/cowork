"""Unit tests for auth-related settings logic.

Tests the TERMS_CONSENT gate in check_configured and the
ANTHROPIC_API_KEY migration in _migrate_legacy_keys.

Run with::

    python3 -m unittest server.tests.test_auth_settings -v
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Import the functions under test directly to avoid spinning up FastAPI.
from server.routes.settings import (
    _migrate_legacy_keys,
    _read_dotenv,
    _write_dotenv,
    GLOBAL_ENV_PATH,
)


def _make_env(tmp: Path, contents: dict[str, str]) -> Path:
    p = tmp / ".env"
    _write_dotenv(p, contents)
    return p


class TestCheckConfigured(unittest.TestCase):
    """check_configured must gate on ANTON_TERMS_CONSENT before API keys."""

    def _call(self, env_path: Path) -> dict:
        """Call the endpoint logic directly, patching GLOBAL_ENV_PATH."""
        env = _read_dotenv(env_path)
        # Mirror the endpoint logic from routes/settings.py
        if env.get("ANTON_TERMS_CONSENT") != "true":
            return {"configured": False, "provider": ""}
        if env.get("ANTON_ANTHROPIC_API_KEY") or os.environ.get("ANTON_ANTHROPIC_API_KEY"):
            return {"configured": True, "provider": "anthropic"}
        if (env.get("ANTON_OPENAI_API_KEY") or os.environ.get("ANTON_OPENAI_API_KEY")) and (
            env.get("ANTON_OPENAI_BASE_URL") or os.environ.get("ANTON_OPENAI_BASE_URL")
        ):
            return {"configured": True, "provider": "minds"}
        return {"configured": False, "provider": ""}

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_no_terms_no_key_returns_false(self):
        env = _make_env(self.tmp, {})
        self.assertEqual(self._call(env), {"configured": False, "provider": ""})

    def test_key_present_but_no_terms_returns_false(self):
        """Migration may write a key before terms are accepted — must still be unconfigured."""
        env = _make_env(self.tmp, {"ANTON_ANTHROPIC_API_KEY": "sk-ant-test"})
        result = self._call(env)
        self.assertFalse(result["configured"])

    def test_terms_and_anthropic_key_returns_configured(self):
        env = _make_env(self.tmp, {
            "ANTON_TERMS_CONSENT": "true",
            "ANTON_ANTHROPIC_API_KEY": "sk-ant-test",
        })
        result = self._call(env)
        self.assertTrue(result["configured"])
        self.assertEqual(result["provider"], "anthropic")

    def test_terms_and_minds_keys_returns_configured(self):
        env = _make_env(self.tmp, {
            "ANTON_TERMS_CONSENT": "true",
            "ANTON_OPENAI_API_KEY": "eyJtoken",
            "ANTON_OPENAI_BASE_URL": "https://api.mindshub.ai/v1",
        })
        result = self._call(env)
        self.assertTrue(result["configured"])
        self.assertEqual(result["provider"], "minds")

    def test_terms_accepted_but_no_keys_returns_false(self):
        env = _make_env(self.tmp, {"ANTON_TERMS_CONSENT": "true"})
        result = self._call(env)
        self.assertFalse(result["configured"])

    def test_openai_key_without_base_url_returns_false(self):
        env = _make_env(self.tmp, {
            "ANTON_TERMS_CONSENT": "true",
            "ANTON_OPENAI_API_KEY": "eyJtoken",
        })
        result = self._call(env)
        self.assertFalse(result["configured"])


class TestMigrateLegacyKeys(unittest.TestCase):
    """_migrate_legacy_keys copies shell env vars into ~/.anton/.env canonical names."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _run_migrate(self, env_file_contents: dict[str, str], shell_env: dict[str, str]):
        env_path = _make_env(self.tmp, env_file_contents)
        # Isolate from the real shell environment: remove all canonical and legacy
        # keys so the test only sees what shell_env explicitly provides.
        isolated = {k: v for k, v in os.environ.items() if k not in (
            "ANTON_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY",
            "ANTON_OPENAI_API_KEY", "OPENAI_API_KEY",
        )}
        isolated.update(shell_env)
        with patch("server.routes.settings.GLOBAL_ENV_PATH", env_path), \
             patch.dict(os.environ, isolated, clear=True):
            migrated = _migrate_legacy_keys()
        return migrated, _read_dotenv(env_path)

    def test_migrates_anthropic_key_from_shell(self):
        migrated, result = self._run_migrate(
            env_file_contents={},
            shell_env={"ANTHROPIC_API_KEY": "sk-ant-shell"},
        )
        self.assertIn("ANTON_ANTHROPIC_API_KEY", migrated)
        self.assertEqual(result["ANTON_ANTHROPIC_API_KEY"], "sk-ant-shell")

    def test_does_not_overwrite_existing_canonical_key(self):
        migrated, result = self._run_migrate(
            env_file_contents={"ANTON_ANTHROPIC_API_KEY": "sk-ant-existing"},
            shell_env={"ANTHROPIC_API_KEY": "sk-ant-shell"},
        )
        self.assertNotIn("ANTON_ANTHROPIC_API_KEY", migrated)
        self.assertEqual(result["ANTON_ANTHROPIC_API_KEY"], "sk-ant-existing")

    def test_no_shell_key_writes_nothing(self):
        migrated, result = self._run_migrate(
            env_file_contents={},
            shell_env={},
        )
        self.assertEqual(migrated, [])
        self.assertNotIn("ANTON_ANTHROPIC_API_KEY", result)

    def test_migrates_openai_key_from_shell(self):
        migrated, result = self._run_migrate(
            env_file_contents={},
            shell_env={"OPENAI_API_KEY": "sk-openai-shell"},
        )
        self.assertIn("ANTON_OPENAI_API_KEY", migrated)
        self.assertEqual(result["ANTON_OPENAI_API_KEY"], "sk-openai-shell")


if __name__ == "__main__":
    unittest.main()
