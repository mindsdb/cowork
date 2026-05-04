# syntax=docker/dockerfile:1.7
#
# Antontron — headless container for the cowork-skin web deployment.
#
# Builds the React/Vite renderer (`src/renderer`) into static assets and
# runs the FastAPI backend (`server/main.py`). The Electron wrapper
# (`src/main`) is not included — this image is for browser-served
# deployments behind a reverse proxy (anton_services Lightsail bootstrap,
# anton-local-environment).
#
# Layout in the runtime image:
#   /app/server/        FastAPI source (with anton_api/, routes/, main.py)
#   /app/dist/          Built SPA (Vite output from src/renderer/)
#   /app/server/main.py CMD entry, listens on $ANTON_SERVER_HOST:$ANTON_SERVER_PORT
#
# This image does NOT serve the SPA itself — `dist/` ships at /app/dist/
# for an external web server (nginx) to mount/copy. anton-local-environment
# bind-mounts ${COWORK_PATH}/dist/renderer onto an nginx container that
# also reverse-proxies /v1/* here.
#
# Build:
#   docker build -t cowork:local .
# Run (API only — UI needs an external web server):
#   docker run --rm -p 8765:8765 -e ANTON_ANTHROPIC_API_KEY=... cowork:local

# --- Stage 1: build the renderer -------------------------------------------
FROM node:24-bookworm-slim AS frontend

WORKDIR /build

# Cache npm install layer. --ignore-scripts skips native-module postinstalls
# (node-pty, etc.) that Electron-side code needs but the headless renderer
# build (pure Vite + React) doesn't. Saves ~5min and dodges the whole
# node-gyp / python / make toolchain.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

# Renderer source + the configs Vite/React need at build time.
COPY tsconfig.json tsconfig.main.json ./
COPY postcss.config.js tailwind.config.js ./
COPY src ./src
COPY scripts ./scripts

# build:renderer alone produces dist/renderer/. Skipping build:main (which
# compiles the Electron main process to dist/main/) — that's ~5s saved and
# we don't ship the Electron entry from this image.
RUN npm run build:renderer


# --- Stage 2: runtime ------------------------------------------------------
FROM python:3.11-slim-bookworm AS runtime

# Where to install anton from. Override with --build-arg ANTON_PIP_SPEC=anton
# once it's on PyPI, or pin a specific commit/branch.
ARG ANTON_PIP_SPEC=git+https://github.com/mindsdb/anton.git@main

# `git` is required because the default ANTON_PIP_SPEC is a git URL.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates curl git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first for layer caching.
COPY server/requirements.txt /app/server/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r /app/server/requirements.txt && \
    pip install --no-cache-dir "${ANTON_PIP_SPEC}"

COPY server /app/server
COPY --from=frontend /build/dist/renderer /app/dist

# Listen on all interfaces by default. Override with -e ANTON_SERVER_HOST=127.0.0.1
# to revert to the Electron-launched loopback bind.
# Pin port 8765 so anton-local-environment's nginx.conf and healthcheck
# don't have to track antontron's internal default (26866).
ENV ANTON_SERVER_HOST=0.0.0.0 \
    ANTON_SERVER_PORT=8765 \
    PYTHONUNBUFFERED=1

EXPOSE 8765

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD curl -fs "http://127.0.0.1:${ANTON_SERVER_PORT}/health" > /dev/null || exit 1

WORKDIR /app/server
CMD ["python", "main.py"]
