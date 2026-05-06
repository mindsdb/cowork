"""Health and root endpoints."""
from __future__ import annotations

from fastapi import APIRouter

from anton_api import conversation_manager, scratchpad_runtime
from routes.settings import get_config_status

router = APIRouter(tags=["health"])


@router.get("/health")
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


@router.get("/")
async def root():
    return {
        "message": "Anton CoWork API",
        "anton_available": conversation_manager.is_anton_available(),
    }
