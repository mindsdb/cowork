# Cowork web image — cowork-server backend + cowork SPA on the same port.
#
# Build:
#     docker build -f cowork/Dockerfile -t cowork:dev \
#       --build-arg COWORK_SERVER_VERSION=0.1.1 .
#
# Run:
#     docker run -p 26866:26866 \
#       -e OPENAI_API_KEY=... \
#       -v cowork-data:/home/anton/.cowork \
#       cowork:dev
#
# Then browse to http://localhost:26866 — the SPA wrapper serves
# both the cowork SPA (at /) and the API (at /api/v1/*) on the same port.
#
# Image is split into three build stages so the runtime layer ships only
# what's needed to serve traffic:
#
#   spa-builder   Node + npm — builds the renderer; produces /build/dist/
#   py-builder    Python + uv — installs cowork-server from PyPI into /opt/venv
#   runtime       Python — copies /opt/venv + SPA + wrapper.

ARG COWORK_SERVER_VERSION=0.1.4

# ── Stage 1: build the cowork SPA ────────────────────────────────────────
FROM node:22-slim AS spa-builder
WORKDIR /build
# Lockfile-only install first → cached layer when only source changes.
COPY cowork/package.json cowork/package-lock.json ./
# --ignore-scripts skips postinstall hooks (e.g. node-gyp rebuilds for
# native modules) — the web SPA has no native dependencies.
RUN npm ci --ignore-scripts
COPY cowork/ ./
RUN npm run build:web
# Output lives at /build/dist/renderer-web/

# ── Stage 2: install Python deps into an isolated venv ─────────────────
# Dependencies (anton-agent, cowork-server) are pulled from PyPI — no
# git needed. Only /opt/venv is copied to the runtime image.
FROM python:3.12-slim AS py-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# uv for fast installs.
COPY --from=ghcr.io/astral-sh/uv:0.7 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY cowork/scripts/install-cowork-server.sh /tmp/install-cowork-server.sh
ARG COWORK_SERVER_VERSION
ENV COWORK_SERVER_VERSION=${COWORK_SERVER_VERSION}
RUN chmod +x /tmp/install-cowork-server.sh && /tmp/install-cowork-server.sh

# ── Stage 3: runtime — minimal, no compilers, no git, no source tree ─────
FROM python:3.12-slim AS runtime

# OCI labels — visible in registry UI; helps operators match image to commit.
LABEL org.opencontainers.image.title="cowork"
LABEL org.opencontainers.image.source="https://github.com/mindsdb/cowork"
LABEL org.opencontainers.image.description="MindsHub Cowork — FastAPI + SPA"

# ca-certificates is the only runtime apt dep.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user. UID 1000 is the convention for "primary user".
RUN useradd -m -u 1000 -s /bin/bash anton

# Copy the prebuilt venv. Owned by root, world-readable — the venv is
# read-only at runtime.
COPY --from=py-builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# App payload — SPA bundle from the builder + the SPA wrapper entrypoint.
COPY --chown=anton:anton --from=spa-builder /build/dist/renderer-web/ /app/dist/renderer-web/
COPY --chown=anton:anton cowork/scripts/spa_wrapper.py /app/spa_wrapper.py

# Persistent state lives under /home/anton/.cowork — operators bind-mount
# this to keep database/vault/settings across container restarts.
RUN mkdir -p /home/anton/.cowork && chown anton:anton /home/anton/.cowork

USER anton

ENV COWORK_SPA_DIR=/app/dist/renderer-web \
    COWORK_SERVER_HOST=0.0.0.0 \
    COWORK_SERVER_PORT=26866 \
    PYTHONUNBUFFERED=1

EXPOSE 26866

# Plain stdlib healthcheck — no curl needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:26866/api/v1/health/',timeout=3).status==200 else 1)" \
    || exit 1

CMD ["uvicorn", "spa_wrapper:app", "--host", "0.0.0.0", "--port", "26866"]
