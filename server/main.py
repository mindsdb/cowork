"""
Anton CoWork — FastAPI backend server.

Runs on http://127.0.0.1:8765
Wraps Anton's Python API and exposes /v1/* REST + SSE endpoints.

Usage:
  python main.py
  # or: uvicorn main:app --host 127.0.0.1 --port 8765 --reload
"""
from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Load ~/.anton/.env if it exists (before anything else)
_env_path = Path.home() / ".anton" / ".env"
if _env_path.exists():
    for _line in _env_path.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from anton_api import conversation_manager, projects_store, scratchpad_runtime
from routes.responses import router as responses_router
from routes.conversations import router as conversations_router
from routes.scratchpad import router as scratchpad_router
from routes.projects import router as projects_router
from routes.settings import router as settings_router
from routes.settings import get_config_status
from routes.artifacts import router as artifacts_router
from routes.utilities import router as utilities_router
from routes.attachments import router as attachments_router
from routes.search import router as search_router
from routes.pins import router as pins_router
from routes.schedules import router as schedules_router, start_scheduler
from routes.browse import router as browse_router
from routes.integrations import router as integrations_router
from routes.datavault import router as datavault_router
from routes.dispatch import (
    router as dispatch_router,
    close_repo as close_dispatch_repo,
    start_dispatch,
    stop_dispatch,
)
from routes.dispatch_slack import router as dispatch_slack_router

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s  %(name)s  %(message)s",
)
logger = logging.getLogger("anton-server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    projects_store.ensure_default_project()
    start_scheduler()
    await start_dispatch()
    yield
    await stop_dispatch()
    await close_dispatch_repo()
    await conversation_manager.close_all()
    await scratchpad_runtime.close_all()


app = FastAPI(title="Anton CoWork API", version="1.0.0", lifespan=lifespan)

_renderer_url = os.environ.get("VITE_RENDERER_URL", "").rstrip("/")
_allow_origins = ["http://localhost:5173", "http://127.0.0.1:5173", "app://-", "null"]
if _renderer_url and _renderer_url not in _allow_origins:
    _allow_origins.append(_renderer_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Chat layer (OpenAI-style)
app.include_router(responses_router)
app.include_router(conversations_router)
app.include_router(scratchpad_router)

# Cowork resources — all under /v1/*
app.include_router(projects_router, prefix="/v1/projects",  tags=["projects"])
app.include_router(settings_router, prefix="/v1/settings",  tags=["settings"])
app.include_router(artifacts_router, prefix="/v1/artifacts", tags=["artifacts"])
# utilities.py exposes /memory, /skills, /datasources, /publish at the prefix root
app.include_router(utilities_router, prefix="/v1", tags=["utilities"])
app.include_router(attachments_router)
app.include_router(search_router)
app.include_router(pins_router)
app.include_router(schedules_router)
app.include_router(browse_router)
app.include_router(integrations_router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(datavault_router, prefix="/v1/datavault", tags=["datavault"])
app.include_router(dispatch_router, prefix="/v1/dispatch", tags=["dispatch"])
app.include_router(dispatch_slack_router, prefix="/v1/dispatch", tags=["dispatch-slack"])


@app.get("/health")
async def health():
    config = get_config_status()
    anton_available = conversation_manager.is_anton_available()
    return {
        "status": "ok",
        "anton_available": anton_available,
        "mode": "anton" if anton_available else "demo",
        "config_ready": config["config_ready"],
        "config_error": config["config_error"],
        "provider": config["provider"],
        "model": config["model"],
        "provider_label": config["provider_label"],
        "live_conversations": conversation_manager.list_live(),
        "live_pads": scratchpad_runtime.list_pads(),
    }


@app.get("/")
async def root():
    return {
        "message": "Anton CoWork API",
        "anton_available": conversation_manager.is_anton_available(),
    }


if __name__ == "__main__":
    import uvicorn

    # Default port 26866 spells "ANTON" on a phone T9 keypad (A=2, N=6,
    # T=8, O=6, N=6). Lives in the dynamic/private port range and avoids
    # the usual web-dev / database collisions (3000, 5000, 5173, 5432,
    # 6379, 8000, 8080, 8765, etc.). Override with ANTON_SERVER_PORT.
    port = int(os.environ.get("ANTON_SERVER_PORT", 26866))
    host = os.environ.get("ANTON_SERVER_HOST", "127.0.0.1")

    logger.info("─" * 50)
    logger.info("Anton CoWork server starting on %s:%d", host, port)
    logger.info("Anton available: %s", conversation_manager.is_anton_available())
    if not conversation_manager.is_anton_available():
        logger.info("Anton is not installed; chat endpoints will return 503")
        logger.info("To install: pip install anton  (from github.com/mindsdb/anton)")
    logger.info("─" * 50)

    uvicorn.run("main:app", host=host, port=port, reload=False, log_level="info")
