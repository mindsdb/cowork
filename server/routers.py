"""Router registry — mounts all API routers onto the FastAPI app."""
from __future__ import annotations

from fastapi import FastAPI

from routes.responses import router as responses_router
from routes.conversations import router as conversations_router
from routes.scratchpad import router as scratchpad_router
from routes.projects import router as projects_router
from routes.settings import router as settings_router
from routes.artifacts import router as artifacts_router
from routes.utilities import router as utilities_router
from routes.attachments import router as attachments_router
from routes.search import router as search_router
from routes.pins import router as pins_router
from routes.schedules import router as schedules_router
from routes.browse import router as browse_router
from routes.integrations import router as integrations_router
from routes.datavault import router as datavault_router
from routes.connectors import router as connectors_router


def mount_routers(app: FastAPI) -> None:
    # Chat layer (OpenAI-style)
    app.include_router(responses_router)
    app.include_router(conversations_router)
    app.include_router(scratchpad_router)

    # Cowork resources — all under /v1/*
    app.include_router(projects_router,     prefix="/v1/projects",      tags=["projects"])
    app.include_router(settings_router,     prefix="/v1/settings",      tags=["settings"])
    app.include_router(artifacts_router,    prefix="/v1/artifacts",     tags=["artifacts"])
    app.include_router(utilities_router,    prefix="/v1",               tags=["utilities"])
    app.include_router(attachments_router)
    app.include_router(search_router)
    app.include_router(pins_router)
    app.include_router(schedules_router)
    app.include_router(browse_router)
    app.include_router(integrations_router, prefix="/v1/integrations",  tags=["integrations"])
    app.include_router(datavault_router,    prefix="/v1/datavault",     tags=["datavault"])
    app.include_router(connectors_router)
