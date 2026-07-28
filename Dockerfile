# Cowork web image — cowork-server backend + cowork SPA on the same port.
#
# Build:
#     docker build -f Dockerfile -t cowork:dev .
#     # Pin a specific version:
#     docker build -f Dockerfile -t cowork:dev \
#       --build-arg COWORK_SERVER_VERSION=0.2.25.6.20.1 .
#     # Install cowork-server from a git ref instead of PyPI (staging builds):
#     docker build -f Dockerfile -t cowork:dev \
#       --build-arg COWORK_SERVER_REF=staging .
#     # Also install anton-agent from a git ref instead of PyPI (staging builds):
#     docker build -f cowork/Dockerfile -t cowork:dev \
#       --build-arg COWORK_SERVER_REF=staging --build-arg ANTON_REF=staging .
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
#   py-builder    Python + uv — installs cowork-server (PyPI version, or a git
#                 ref when COWORK_SERVER_REF is set) into /opt/venv
#   runtime       Python — copies /opt/venv + SPA + wrapper.

ARG COWORK_SERVER_VERSION=

# ── Stage 1: build the cowork SPA ────────────────────────────────────────
FROM node:22-slim AS spa-builder
WORKDIR /build
# Lockfile-only install first → cached layer when only source changes.
COPY package.json package-lock.json ./
# --ignore-scripts skips postinstall hooks (e.g. node-gyp rebuilds for
# native modules) — the web SPA has no native dependencies.
RUN npm ci --ignore-scripts
COPY . ./
RUN npm run build:web
# Output lives at /build/dist/renderer-web/

# ── Stage 2: install Python deps into an isolated venv ─────────────────
# cowork-server (and its anton-agent dep) are installed from PyPI by default,
# or from a git ref when COWORK_SERVER_REF is set (staging builds) — the latter
# needs git, installed below. Only /opt/venv is copied to the runtime image.
FROM python:3.12-slim AS py-builder

# git is needed when COWORK_SERVER_REF is set (install cowork-server from the
# git repo instead of PyPI). Harmless for the PyPI path.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
    && rm -rf /var/lib/apt/lists/*

# uv for fast installs.
COPY --from=ghcr.io/astral-sh/uv:0.7 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY scripts/install-cowork-server.sh /tmp/install-cowork-server.sh
ARG COWORK_SERVER_VERSION
ARG COWORK_SERVER_REF=
ENV COWORK_SERVER_VERSION=${COWORK_SERVER_VERSION} \
    COWORK_SERVER_REF=${COWORK_SERVER_REF}
RUN chmod +x /tmp/install-cowork-server.sh && /tmp/install-cowork-server.sh

# Security floor for transitive Python deps. PyJWT < 2.13.0 (pulled in
# by the cowork-server closure) accepts forged JWTs (CVE-2026-48526,
# HIGH). Re-check on every version bump and drop the floor once the
# closure's own pins move past it.
RUN uv pip install --python /opt/venv/bin/python "pyjwt>=2.13.0"

# Staging builds override anton-agent with a git ref instead of the PyPI
# release that cowork-server pins. Declared *after* the cowork-server and
# pyjwt RUNs so a moving anton branch only invalidates this layer — the
# cowork-server install layer survives (same post-install-override-as-a-
# separate-RUN pattern as the pyjwt floor above). Empty ANTON_REF → no-op
# (prod path, anton stays on PyPI). The direct-URL requirement
# (anton-agent @ git+...) is what forces replacement of the already-installed
# PyPI anton regardless of resolver order; a broken-pin warning from uv is
# harmless.
ARG ANTON_REF=
RUN if [ -n "$ANTON_REF" ]; then \
        echo "→ Overriding anton-agent with git ref '$ANTON_REF'" >&2; \
        uv pip install --python /opt/venv/bin/python \
            "anton-agent @ git+https://github.com/mindsdb/anton.git@${ANTON_REF}" && \
        /opt/venv/bin/python -c "import anton; import importlib.metadata as m; print('✓ anton-agent', m.version('anton-agent'))"; \
    fi

# ── Stage 3: runtime — minimal, no compilers, no git, no source tree ─────
FROM python:3.12-slim AS runtime

# OCI labels — visible in registry UI; helps operators match image to commit.
LABEL org.opencontainers.image.title="cowork"
LABEL org.opencontainers.image.source="https://github.com/mindsdb/cowork"
LABEL org.opencontainers.image.description="MindsHub Cowork — FastAPI + SPA"

# ca-certificates is the only runtime apt dep. The upgrade pulls Debian
# security errata published since the base image was tagged — without
# it, cached base layers silently miss fixed packages.
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user. UID 1000 is the convention for "primary user".
# Shell is /bin/sh (dash): bash is removed in the hardening strip below.
RUN useradd -m -u 1000 -s /bin/sh anton

# Copy the prebuilt venv. Owned by root, world-readable — the venv is
# read-only at runtime.
COPY --from=py-builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# App payload — SPA bundle from the builder + the SPA wrapper entrypoint.
COPY --chown=anton:anton --from=spa-builder /build/dist/renderer-web/ /app/dist/renderer-web/
COPY --chown=anton:anton scripts/spa_wrapper.py /app/spa_wrapper.py

# Persistent state lives under /home/anton/.cowork — operators bind-mount
# this to keep database/vault/settings across container restarts.
RUN mkdir -p /home/anton/.cowork && chown anton:anton /home/anton/.cowork

# ── Final hardening: purge every package the runtime doesn't use ──────────
# Enterprise image-intake scanners (Wiz, Snyk, ECR) block on any HIGH/
# CRITICAL CVE physically present in the image, fixable or not — and
# Debian regularly has no fix for new CVEs on required-but-unused base
# packages (perl-base carries 2 CRITICALs; gzip, ncurses, libacl1/
# libattr1 and libuuid1 all carry no-fix HIGHs today). The app runs a
# single non-root python process (uvicorn CMD is exec-form, the
# healthcheck is `python -c`), so none of the shell tooling, package
# manager, login/PAM stack, or mount machinery is ever executed. A
# package that isn't in the image can't fail a scan.
#
# What stays (~30 packages): python + venv's native-lib closure
# (libc, openssl, sqlite, expat, ffi, gdbm, stdc++, compression libs),
# ca-certificates + openssl for TLS, dash for `docker exec sh` and
# build-time RUNs, dpkg's status DB so scanners still enumerate the
# survivors honestly (dpkg itself becomes inert once tar/diff are gone
# — the image is immutable by construction).
#
# Notes on the removals:
# - Three batches because maintainer postrm scripts need rm/sed until
#   the final batch, and debconf's postrm needs perl-base.
# - bash goes with libtinfo6/ncurses (its HIGH CVE); dash remains /bin/sh.
# - libuuid1 goes: CPython's uuid module falls back to pure Python when
#   the _uuid extension can't load (verified; uuid4 works).
# - Derived images that need apt must build FROM the py-builder stage
#   or an earlier layer instead.
RUN set -eux; \
    FORCE="--force-depends --force-remove-essential --force-remove-protected"; \
    dpkg --purge $FORCE \
        apt libapt-pkg7.0 debian-archive-keyring sqv adduser debconf \
        libdebconfclient0 readline-common debianutils hostname \
        ncurses-bin ncurses-base; \
    dpkg --purge $FORCE \
        passwd login login.defs libpam-runtime libpam-modules \
        libpam-modules-bin libpam0g libsemanage2 libsemanage-common \
        util-linux mount bsdutils sysvinit-utils init-system-helpers \
        liblastlog2-2 libsmartcols1 libmount1 libblkid1 libaudit1 \
        libaudit-common libcap-ng0 libcap2 libudev1 libsystemd0 libuuid1; \
    dpkg --purge $FORCE \
        perl-base gzip tar coreutils sed grep findutils diffutils mawk \
        bash libreadline8t64 libncursesw6 libtinfo6 libacl1 libattr1 \
        libdb5.3t64 libgmp10 libnettle8t64 libhogweed6t64 libbsd0; \
    python -c "import ssl, sqlite3, uuid; uuid.uuid4(); \
ssl.create_default_context().cert_store_stats()"

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
