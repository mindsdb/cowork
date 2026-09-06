# Serve cowork-server and the SPA together on port 26866.
# COWORK_SERVER_VERSION pins PyPI; COWORK_SERVER_REF selects git and ANTON_REF overrides Anton.
# Mount /home/anton/.cowork for persistent data and pass provider credentials at runtime.

ARG COWORK_SERVER_VERSION=

FROM node:22-slim AS spa-builder
WORKDIR /build
# Copy lockfiles first so source changes reuse the dependency layer.
COPY package.json package-lock.json ./
# Skip native hooks: the web SPA needs no native modules.
RUN npm ci --ignore-scripts
COPY . ./
RUN npm run build:web

# Only the isolated /opt/venv is copied into runtime.
FROM python:3.12-slim AS py-builder

# git is required for COWORK_SERVER_REF installs.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.7 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY scripts/install-cowork-server.sh /tmp/install-cowork-server.sh
ARG COWORK_SERVER_VERSION
ARG COWORK_SERVER_REF=
ENV COWORK_SERVER_VERSION=${COWORK_SERVER_VERSION} \
    COWORK_SERVER_REF=${COWORK_SERVER_REF}
RUN chmod +x /tmp/install-cowork-server.sh && /tmp/install-cowork-server.sh

# Keep PyJWT >= 2.13.0 for CVE-2026-48526 until upstream dependency pins enforce the floor.
RUN uv pip install --python /opt/venv/bin/python "pyjwt>=2.13.0"

# Install the Anton git override after cowork-server so moving refs only invalidate this layer.
# A direct-URL requirement forces replacement of the pinned PyPI dependency.
ARG ANTON_REF=
RUN if [ -n "$ANTON_REF" ]; then \
        echo "→ Overriding anton-agent with git ref '$ANTON_REF'" >&2; \
        uv pip install --python /opt/venv/bin/python \
            "anton-agent @ git+https://github.com/mindsdb/anton.git@${ANTON_REF}" && \
        /opt/venv/bin/python -c "import anton; import importlib.metadata as m; print('✓ anton-agent', m.version('anton-agent'))"; \
    fi

FROM python:3.12-slim AS runtime

LABEL org.opencontainers.image.title="cowork"
LABEL org.opencontainers.image.source="https://github.com/mindsdb/cowork"
LABEL org.opencontainers.image.description="MindsHub Cowork — FastAPI + SPA"

# Upgrade base packages to pick up security errata published after the image tag.
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 -s /bin/sh anton

# Keep the venv root-owned and read-only at runtime.
COPY --from=py-builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

COPY --chown=anton:anton --from=spa-builder /build/dist/renderer-web/ /app/dist/renderer-web/
COPY --chown=anton:anton scripts/spa_wrapper.py /app/spa_wrapper.py

# Mount this directory to preserve database, vault, and settings across restarts.
RUN mkdir -p /home/anton/.cowork && chown anton:anton /home/anton/.cowork

# Remove unused runtime packages to reduce the security-update surface. Keep the native Python closure and TLS roots.
# Purge in batches: maintainer scripts still need rm/sed, and debconf needs perl until their removals complete.
# dash remains for sh; uuid falls back to Python without libuuid.
# Derived images needing apt must start from py-builder or an earlier layer.
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

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:26866/api/v1/health/',timeout=3).status==200 else 1)" \
    || exit 1

CMD ["uvicorn", "spa_wrapper:app", "--host", "0.0.0.0", "--port", "26866"]
