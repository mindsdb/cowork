# Cowork web image — cowork-server backend + cowork SPA on the same port.
#
# Build:
#     docker build -f cowork/Dockerfile -t cowork:dev .
#     # Pin a specific version:
#     docker build -f cowork/Dockerfile -t cowork:dev \
#       --build-arg COWORK_SERVER_VERSION=0.26.7.13.3 .
#     # Install cowork-server from a git ref instead of PyPI (staging builds):
#     docker build -f cowork/Dockerfile -t cowork:dev \
#       --build-arg COWORK_SERVER_REF=staging .
#
# Run:
#     docker run -p 26866:26866 \
#       -e OPENAI_API_KEY=... \
#       -v cowork-data:/home/anton/.cowork \
#       cowork:dev
#
# Preconfigured run (skips onboarding — see scripts/docker-entrypoint.py
# and deploy/gateway/ for Anthropic-protocol gateway deployments):
#     docker run -p 26866:26866 \
#       -e ANTHROPIC_BASE_URL=https://<anthropic-protocol-gateway> \
#       -e ANTON_ANTHROPIC_API_KEY=<gateway-issued-key> \
#       -e ANTON_PLANNING_PROVIDER=anthropic -e ANTON_CODING_PROVIDER=anthropic \
#       -e ANTON_PLANNING_MODEL=claude-opus-4-7 -e ANTON_CODING_MODEL=claude-opus-4-7 \
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
#   py-builder    UBI9 + uv  — installs cowork-server (PyPI version, or a git
#                 ref when COWORK_SERVER_REF is set) into /opt/venv
#   runtime       UBI9       — copies /opt/venv + SPA + wrapper.
#                              NO uv, NO compilers, NO source tree.

ARG COWORK_SERVER_VERSION=

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
FROM registry.access.redhat.com/ubi9-minimal@sha256:062c52ff973065752b0965787649db2bcf551a6c727a00e95a3eb42cebadbdab AS py-builder

# microdnf is UBI minimal's slim package manager. The update step pulls
# Red Hat security errata published since the base digest was tagged.
# python3.12 is the interpreter the venv is seeded from (uv links the
# venv to this RPM-managed Python so it stays Red Hat-patched and
# scannable — no downloaded standalone CPython). ca-certificates is
# required for HTTPS to PyPI during the install. git-core is needed only
# when COWORK_SERVER_REF is set (install from a git ref instead of PyPI);
# it never reaches the runtime stage.
RUN microdnf update -y \
    && microdnf install -y --nodocs \
        python3.12 \
        ca-certificates \
        git-core \
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
ARG COWORK_SERVER_REF=
ENV COWORK_SERVER_VERSION=${COWORK_SERVER_VERSION} \
    COWORK_SERVER_REF=${COWORK_SERVER_REF}
RUN chmod +x /tmp/install-cowork-server.sh && /tmp/install-cowork-server.sh

# Security floor for transitive Python deps. PyJWT < 2.13.0 (pulled in
# by the cowork-server closure) accepts forged JWTs (CVE-2026-48526,
# HIGH). Re-check on every version bump and drop entries once the
# closure's own pins move past the floor.
RUN uv pip install --python /opt/venv/bin/python "pyjwt>=2.13.0"

# Drop the hermes harness. cowork-server hard-depends on hermes-agent but
# imports it lazily (cowork/harnesses/__init__.py wraps the import in
# try/except ImportError), and CVS only uses the anton harness. Every one
# of hermes-agent's transitive deps is also required by anton-agent, so
# removing the top-level package alone drops the entire hermes footprint
# without disturbing anything else (verified: 0 packages become orphaned).
# This also removes hermes-agent's exact `Pillow==12.2.0` pin, which is
# what blocks the Pillow security floor below.
RUN uv pip uninstall --python /opt/venv/bin/python hermes-agent

# Security floor: Pillow < 12.3.0 carries 10 HIGH CVEs (CVE-2026-54058/
# -54059/-54060/-55379/-55380/-59197/-59199/-59200/-59204/-59205 — heap
# OOB writes, decompression bombs, memory disclosure across the image
# codecs), all fixed in 12.3.0. Pillow stays in the image because the PDF
# export stack (xhtml2pdf -> reportlab) and anton both need it; only the
# now-removed hermes `==12.2.0` pin held it back. Re-check on version bumps.
RUN uv pip install --python /opt/venv/bin/python "pillow>=12.3.0"

# Fail the build if the harness stack no longer imports without hermes, or
# if Pillow didn't reach the floor — cheaper to catch here than in a scan.
RUN /opt/venv/bin/python -c "import cowork.harnesses, PIL; \
from importlib.metadata import version; \
assert tuple(map(int, version('pillow').split('.')[:2])) >= (12, 3), version('pillow'); \
print('✓ harnesses import; pillow', version('pillow'))"

# ── Stage 3: runtime — minimal, no compilers, no uv, no source tree ──────
# Same digest-pinned UBI 9 minimal base as py-builder. The runtime stage
# is what the customer actually pulls, so this digest is the one their
# Snyk Container / Trivy scan resolves against. Keep both FROM digests in
# sync when bumping the base.
FROM registry.access.redhat.com/ubi9-minimal@sha256:062c52ff973065752b0965787649db2bcf551a6c727a00e95a3eb42cebadbdab AS runtime

# OCI labels — visible in registry UI; helps operators match image to commit.
LABEL org.opencontainers.image.title="cowork"
LABEL org.opencontainers.image.source="https://github.com/mindsdb/cowork"
LABEL org.opencontainers.image.description="MindsHub Cowork — cowork-server + SPA (UBI 9 minimal)"
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
COPY --chown=anton:anton --chmod=755 cowork/scripts/docker-entrypoint.py /app/docker-entrypoint.py

# Persistent state lives under /home/anton/.cowork — operators bind-mount
# this to keep database/vault/settings across container restarts.
RUN mkdir -p /home/anton/.cowork && chown anton:anton /home/anton/.cowork

# ── Final hardening: allowlist strip — remove every unused RPM ────────────
# Customer image-intake scanners block on any HIGH/
# CRITICAL CVE physically present in the image, fixable or not, and
# Red Hat regularly has no patch for new CVEs on base packages the app
# never executes (gnutls 2026-06, libacl/libattr 2026-07-01,
# curl-minimal 2026-07-02, ...). Enumerating packages to REMOVE is
# whack-a-mole, so the strip is allowlist-based instead: the script
# declares the packages the runtime genuinely needs (python3.12 + venv
# native-wheel deps, bash for docker exec, the TLS trust store),
# computes their dependency closure live against the rpm database, and
# removes everything else — ~76 of ~117 packages, including microdnf,
# curl, rpm itself and every no-fix-CVE carrier. The rpm DATABASE
# (/var/lib/rpm/rpmdb.sqlite) survives, so scanners still enumerate
# the ~41 remaining packages honestly. Full rationale, the allowlist,
# and the scriptlet-dependency DENY list live in the script.
#
# Runs LAST: after every microdnf install and useradd (both are
# removed by the strip), before USER anton. The bind mount leaves no
# copy of the script in the image.
RUN --mount=type=bind,source=cowork/scripts/docker-strip-packages.py,target=/tmp/strip.py \
    python3.12 /tmp/strip.py

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
# skips onboarding) and can pull the API key from a mounted JSON
# credentials file. Pure Python — coreutils/sed are stripped above.
# See scripts/docker-entrypoint.py.
ENTRYPOINT ["python", "/app/docker-entrypoint.py"]
CMD ["uvicorn", "spa_wrapper:app", "--host", "0.0.0.0", "--port", "26866"]
