"""Shared fixtures for backend tests."""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[1]
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))

SECRET_KEYS = [
    "ANTON_ANTHROPIC_API_KEY",
    "ANTON_OPENAI_API_KEY",
    "ANTON_OPENAI_BASE_URL",
    "ANTON_MINDS_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
]


@pytest.fixture()
def isolated_home(tmp_path):
    """Set up an isolated HOME with empty .anton and projects dirs.

    Yields the home Path. Restores env on teardown.
    """
    old_home = os.environ.get("HOME")
    old_projects = os.environ.get("ANTON_PROJECTS_DIR")
    old_cowork = os.environ.get("ANTON_COWORK_STATE_DIR")

    home = tmp_path / "home"
    (home / ".anton").mkdir(parents=True)
    (home / "projects" / "general" / ".anton").mkdir(parents=True)

    os.environ["HOME"] = str(home)
    os.environ["ANTON_PROJECTS_DIR"] = str(home / "projects")
    os.environ["ANTON_COWORK_STATE_DIR"] = str(home / "cowork")
    os.environ["ANTON_PLANNING_PROVIDER"] = "anthropic"
    os.environ["ANTON_PLANNING_MODEL"] = "claude-sonnet-4-6"
    for key in SECRET_KEYS:
        os.environ.pop(key, None)

    # Force reimport so modules pick up the new HOME
    for name in list(sys.modules):
        if name in ("main", "routes", "services", "anton_api") or name.startswith(("routes.", "services.", "anton_api.")):
            del sys.modules[name]

    yield home

    # Restore
    if old_home is not None:
        os.environ["HOME"] = old_home
    if old_projects is not None:
        os.environ["ANTON_PROJECTS_DIR"] = old_projects
    elif "ANTON_PROJECTS_DIR" in os.environ:
        del os.environ["ANTON_PROJECTS_DIR"]
    if old_cowork is not None:
        os.environ["ANTON_COWORK_STATE_DIR"] = old_cowork
    elif "ANTON_COWORK_STATE_DIR" in os.environ:
        del os.environ["ANTON_COWORK_STATE_DIR"]


@pytest.fixture()
def app_client(isolated_home):
    """FastAPI TestClient against an isolated server instance."""
    from fastapi.testclient import TestClient

    main_mod = importlib.import_module("main")
    return TestClient(main_mod.app)
