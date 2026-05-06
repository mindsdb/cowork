from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def add_middleware(app: FastAPI) -> None:
    renderer_url = os.environ.get("VITE_RENDERER_URL", "").rstrip("/")
    origins = ["http://localhost:5173", "http://127.0.0.1:5173", "app://-", "null"]
    if renderer_url and renderer_url not in origins:
        origins.append(renderer_url)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
