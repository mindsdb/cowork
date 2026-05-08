# Cowork web image — FastAPI backend + cowork SPA on the same port.
#
# Two invocations from one Dockerfile:
#
#   Dev (local sibling source — fastest iteration, no GitHub auth needed):
#     cd antonworld/        # parent dir, so anton/ is in build context
#     docker build -f cowork/Dockerfile -t cowork:dev \
#       --build-arg ANTON_SOURCE=local .
#
#   Prod (pinned anton version from GitHub via SSH):
#     docker buildx build -f cowork/Dockerfile -t ghcr.io/mindsdb/cowork:1.2.3 \
#       --build-arg ANTON_SOURCE=git --build-arg ANTON_VERSION=v1.2.3 \
#       --platform linux/amd64,linux/arm64 \
#       --ssh default \
#       cowork/
#
# Run:
#     docker run -p 26866:26866 \
#       -e ANTON_ANTHROPIC_API_KEY=... \
#       -v anton-data:/home/anton/.anton \
#       cowork:dev
#
# Then browse to http://localhost:26866 — the FastAPI process serves
# both the cowork SPA (at /) and the API (at /v1/*) on the same port.
#
# Image is split into four build stages so the runtime layer ships only
# what's needed to serve traffic:
#
#   spa-builder    Node + npm — builds the renderer; produces /build/dist/
#   anton-source   scratch    — picks local sibling vs empty (git mode)
#   py-builder     Python +
#                  git +
#                  ssh-client — pip-installs cowork + anton into /opt/venv
#   runtime        Python     — copies /opt/venv + SPA + server source.
#                                NO git, NO ssh-client, NO source tree.
#
# Net effect for a customer security scan: ~half the previous image size,
# no /build/anton leftovers, no .git/.venv/.env leakage, fewer binaries
# in the runtime CVE surface.

# Global ARGs — must appear before the first FROM so the
# FROM anton-source-${ANTON_SOURCE} substitution below resolves.
ARG ANTON_SOURCE=git
ARG ANTON_VERSION=main

# ── Stage 1: build the cowork SPA ────────────────────────────────────────
FROM node:22-slim AS spa-builder
WORKDIR /build
# Lockfile-only install first → cached layer when only source changes.
COPY cowork/package.json cowork/package-lock.json ./
# --ignore-scripts skips postinstall hooks (notably node-pty's node-gyp
# rebuild) — node-pty is Electron-only (Terminal page) and doesn't ship
# in the web SPA, so its missing native binding is harmless here.
RUN npm ci --ignore-scripts
COPY cowork/ ./
RUN npm run build:web
# Output lives at /build/dist/renderer-web/

# ── Stage 2a: anton source = local sibling ──────────────────────────────
# Used when ANTON_SOURCE=local. Build context must be antonworld/
# (parent of cowork/) so anton/ is visible. The py-builder stage COPYs
# from this scratch marker; if ANTON_SOURCE=git, it COPYs from
# anton-source-git instead and gets nothing.
FROM scratch AS anton-source-local
COPY anton/ /

FROM scratch AS anton-source-git
# Empty: git mode pulls inside py-builder with --mount=type=ssh.

# Pick the source stage based on ANTON_SOURCE (declared at file top).
FROM anton-source-${ANTON_SOURCE} AS anton-source

# ── Stage 3: install Python deps into an isolated venv ────────────────────
# This stage carries git + ssh-client because ANTON_SOURCE=git uses
# `pip install git+ssh://...`. Neither tool reaches the runtime image —
# only /opt/venv is copied forward. That keeps the runtime CVE surface
# small (no git binary; no openssh) while still supporting both install
# paths from the same Dockerfile.
FROM python:3.11-slim AS py-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        ssh-client \
        git \
    && rm -rf /var/lib/apt/lists/*

# Self-contained venv at /opt/venv. Using a venv (rather than the system
# site-packages) gives us a clean directory to COPY into the runtime
# stage without dragging pip's own footprint or apt-managed packages.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# FastAPI stack first — its pinned set rarely changes, so this layer caches.
COPY cowork/server/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

# Anton install. Empty git-marker → COPY is a no-op when ANTON_SOURCE=git;
# install-anton.sh handles the git-mode pull. Local mode reads the source
# from /build/anton/ inside this builder stage.
COPY --from=anton-source / /build/anton/
COPY cowork/scripts/install-anton.sh /tmp/install-anton.sh
ARG ANTON_SOURCE
ARG ANTON_VERSION
ENV ANTON_SOURCE=${ANTON_SOURCE}
ENV ANTON_VERSION=${ANTON_VERSION}
RUN --mount=type=ssh chmod +x /tmp/install-anton.sh && /tmp/install-anton.sh

# ── Stage 4: runtime — minimal, no compilers, no git, no source tree ─────
FROM python:3.11-slim AS runtime

# OCI labels — visible in registry UI; helps operators match image to commit.
LABEL org.opencontainers.image.title="cowork"
LABEL org.opencontainers.image.source="https://github.com/mindsdb/cowork"
LABEL org.opencontainers.image.description="Anton CoWork — FastAPI + SPA"

# ca-certificates is the only runtime apt dep. git and ssh-client live
# only in py-builder; dropping them here removes ~50 MB and the entire
# git CVE surface from customer security scans.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user. UID 1000 is the convention for "primary user"
# on most distros — easy to bind-mount host directories with matching
# ownership.
RUN useradd -m -u 1000 -s /bin/bash anton

# Copy the prebuilt venv. Owned by root, world-readable — the venv is
# read-only at runtime; no need for the anton user to write into it.
COPY --from=py-builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# App payload — SPA bundle from the builder + server source. Use
# --chown so we don't need a `chown -R` layer afterward (which would
# duplicate every file's metadata in a fresh layer).
COPY --chown=anton:anton --from=spa-builder /build/dist/renderer-web/ /app/dist/renderer-web/
COPY --chown=anton:anton cowork/server/ /app/server/

# Persistent state lives under /home/anton/.anton — operators bind-mount
# this to keep vault/settings across container restarts.
RUN mkdir -p /home/anton/.anton && chown anton:anton /home/anton/.anton

USER anton

# ANTON_SERVE_SPA=1 turns on the static-file mount in server/main.py so
# the SPA is served at /. ANTON_SERVER_HOST=0.0.0.0 makes the port
# reachable from outside the container.
ENV ANTON_SERVE_SPA=1 \
    ANTON_SPA_DIR=/app/dist/renderer-web \
    ANTON_SERVER_HOST=0.0.0.0 \
    ANTON_SERVER_PORT=26866 \
    PYTHONUNBUFFERED=1

EXPOSE 26866

# Plain stdlib healthcheck — no curl needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:26866/health',timeout=3).status==200 else 1)" \
    || exit 1

WORKDIR /app/server
CMD ["python", "main.py"]
