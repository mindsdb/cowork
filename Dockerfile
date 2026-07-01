# Cowork web image — cowork-server backend + cowork SPA on the same port.
#
# Build:
#     docker build -f cowork/Dockerfile -t cowork:dev \
#       --build-arg COWORK_SERVER_VERSION=0.1.4 .
#
# Run:
#     docker run -p 26866:26866 \
#       -e OPENAI_API_KEY=... \
#       -v cowork-data:/home/anton/.cowork \
#       cowork:dev
#
# Preconfigured run (skips onboarding — see scripts/docker-entrypoint.sh
# and deploy/cvs/ for the CVS AIP-gateway deployment):
#     docker run -p 26866:26866 \
#       -e ANTHROPIC_BASE_URL=https://<anthropic-protocol-gateway> \
#       -e ANTON_PLANNING_PROVIDER=anthropic -e ANTON_CODING_PROVIDER=anthropic \
#       -e ANTON_PLANNING_MODEL=claude-opus-4-7 -e ANTON_CODING_MODEL=claude-opus-4-7 \
#       -v ~/.cvscode:/home/anton/.cvscode:ro \
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
#   py-builder    UBI9 + uv  — installs cowork-server from PyPI into /opt/venv
#   runtime       UBI9       — copies /opt/venv + SPA + wrapper.
#                              NO uv, NO compilers, NO source tree.

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

# ── Stage 2: install Python deps into an isolated venv ────────────────────
# cowork-server (and its anton-agent dependency) is pulled from PyPI with
# uv — no git, no SSH. Only /opt/venv is copied forward to the runtime
# stage, so uv itself never reaches the shipped image.
#
# Base is Red Hat UBI 9 minimal, pinned to its multi-arch manifest-list
# digest. UBI is freely redistributable (no RHEL subscription required)
# and Red Hat aggressively backports security patches into their RPM
# packages — concretely, the previous Debian base shipped several HIGH OS
# CVEs without upstream fixes. UBI 9.8 minimal lands the 9.7 base's
# krb5-libs/libcap/python HIGH errata. Of the HIGHs that still had no
# upstream fix, the gnutls ones (DTLS DoS + RSA-PSK auth-bypass) are
# removed outright by the package-manager strip in the runtime stage
# (gnutls is only pulled by the unused dnf/glib2/gnupg stack). Net: a
# true scan of the shipped image (OS layer + the cowork-server Python
# closure) is 0 HIGH / 0 CRITICAL — confirmed by Trivy on both arches and
# by ECR scan-on-push. .trivyignore retains a single defensive expat
# suppression that no current scan reports; see that file for rationale.
# To bump after a CVE patch lands:
#   docker pull registry.access.redhat.com/ubi9-minimal
#   docker buildx imagetools inspect registry.access.redhat.com/ubi9-minimal
# Replace the digest below in BOTH FROM lines.
FROM registry.access.redhat.com/ubi9-minimal@sha256:5b74fce9d6e629942a0c6dc0f546c193e70d7f974d999a48c948c53dd3d36362 AS py-builder

# microdnf is UBI minimal's slim package manager. The update step pulls
# Red Hat security errata published since the base digest was tagged.
# python3.12 is the interpreter the venv is seeded from (uv links the
# venv to this RPM-managed Python so it stays Red Hat-patched and
# scannable — no downloaded standalone CPython). ca-certificates is
# required for HTTPS to PyPI during the install.
RUN microdnf update -y \
    && microdnf install -y --nodocs \
        python3.12 \
        ca-certificates \
    && microdnf clean all \
    && rm -rf /var/cache/yum

# uv for fast installs — copied from the official static-binary image.
COPY --from=ghcr.io/astral-sh/uv:0.7 /uv /usr/local/bin/uv

# Pin uv to the RPM Python. only-system forbids uv from downloading a
# managed CPython (which would land an unpatched standalone build in
# /opt/venv); UV_PYTHON=3.12 selects the python3.12 installed above so
# install-cowork-server.sh's `uv venv` seeds the venv from it.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_PREFERENCE=only-system \
    UV_PYTHON=3.12

COPY cowork/scripts/install-cowork-server.sh /tmp/install-cowork-server.sh
ARG COWORK_SERVER_VERSION
ENV COWORK_SERVER_VERSION=${COWORK_SERVER_VERSION}
RUN chmod +x /tmp/install-cowork-server.sh && /tmp/install-cowork-server.sh

# ── Stage 3: runtime — minimal, no compilers, no uv, no source tree ──────
# Same digest-pinned UBI 9 minimal base as py-builder. The runtime stage
# is what the customer actually pulls, so this digest is the one their
# Snyk Container / Trivy scan resolves against. Keep both FROM digests in
# sync when bumping the base.
FROM registry.access.redhat.com/ubi9-minimal@sha256:5b74fce9d6e629942a0c6dc0f546c193e70d7f974d999a48c948c53dd3d36362 AS runtime

# OCI labels — visible in registry UI; helps operators match image to commit.
LABEL org.opencontainers.image.title="cowork"
LABEL org.opencontainers.image.source="https://github.com/mindsdb/cowork"
LABEL org.opencontainers.image.description="Anton Cowork — cowork-server + SPA (UBI 9 minimal)"
LABEL org.opencontainers.image.base.name="registry.access.redhat.com/ubi9-minimal"

# Apply Red Hat security errata published since the base digest was
# tagged, then install ONLY the packages the runtime needs:
#   - python3.12      — the interpreter the /opt/venv is linked to. Must
#                        match the version uv seeded the venv from in
#                        py-builder, at the same /usr/bin path.
#   - ca-certificates — TLS root anchors for outbound HTTPS to LLM APIs.
#   - shadow-utils    — provides `useradd` for non-root user creation.
# No pip is installed: the app runs from the uv-built venv (which has no
# seed pip), so there is no system pip/setuptools/wheel metadata for a
# scanner to flag.
RUN microdnf update -y \
    && microdnf install -y --nodocs \
        python3.12 \
        ca-certificates \
        shadow-utils \
    && microdnf clean all \
    && rm -rf /var/cache/yum

# Run as a non-root user. UID 1000 is the convention for "primary user"
# on most distros — easy to bind-mount host directories with matching
# ownership.
RUN useradd -m -u 1000 -s /bin/bash anton

# Copy the prebuilt venv. Owned by root, world-readable — the venv is
# read-only at runtime; no need for the anton user to write into it.
COPY --from=py-builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# App payload — SPA bundle from the builder + the SPA wrapper entrypoint.
# Use --chown so we don't need a `chown -R` layer afterward (which would
# duplicate every file's metadata in a fresh layer).
COPY --chown=anton:anton --from=spa-builder /build/dist/renderer-web/ /app/dist/renderer-web/
COPY --chown=anton:anton cowork/scripts/spa_wrapper.py /app/spa_wrapper.py
COPY --chown=anton:anton --chmod=755 cowork/scripts/docker-entrypoint.sh /app/docker-entrypoint.sh

# Persistent state lives under /home/anton/.cowork — operators bind-mount
# this to keep database/vault/settings across container restarts.
RUN mkdir -p /home/anton/.cowork && chown anton:anton /home/anton/.cowork

# ── Final hardening: strip the package manager + its TLS/XML stack ────────
# UBI's microdnf transitively requires glib2, which requires gnutls; the
# dnf machinery also pulls gpgme/gnupg2. None of these are used at runtime
# — cowork runs only the /opt/venv Python interpreter (which links openssl,
# not gnutls) and serves plain HTTP. The base ships gnutls + gnupg2 with
# four HIGH CVEs that have NO upstream fix (DTLS DoS + RSA-PSK auth-bypass,
# CVE-2026-33845/-33846/-42009/-42010); rather than suppress them in
# .trivyignore, we remove the whole unused closure so they vanish from the
# scan entirely. This also drops the dnf/microdnf attack surface, matching
# the distroless philosophy for an immutable runtime image.
#
# `rpm` itself is intentionally kept so the package DB stays readable —
# Trivy/Snyk still enumerate the remaining RPMs (e.g. expat, which python
# hard-requires and which has no fix) honestly. The removal runs LAST, after
# every microdnf install + useradd, since it destroys microdnf. The closure
# below is the full set rpm reports as requiring libgnutls.so / glib2 /
# gnupg2 on UBI 9.8; re-derive with `rpm -e --test` after a base bump.
RUN rpm -e \
        gnutls glib2 gnupg2 gpgme \
        gobject-introspection json-glib libpeas libmodulemd \
        librhsm librepo libdnf microdnf \
    && rm -rf /var/cache/dnf /var/lib/dnf

USER anton

# COWORK_SPA_DIR points the wrapper at the bundled SPA; COWORK_SERVER_HOST
# 0.0.0.0 makes the port reachable from outside the container.
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

# The entrypoint pre-seeds ~/.anton/.env from ANTON_* env vars on first
# boot (so the env→DB migration configures the provider and the SPA
# skips onboarding) and can pull the API key from a mounted CVS Code
# credentials file. See scripts/docker-entrypoint.sh.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "spa_wrapper:app", "--host", "0.0.0.0", "--port", "26866"]
