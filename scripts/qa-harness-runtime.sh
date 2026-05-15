#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-/Users/ian/.local/share/uv/tools/anton/bin/python}"

cd "$ROOT"

echo "== Python compile =="
"$PYTHON_BIN" -m py_compile \
  server/runtime/schemas.py \
  server/runtime/events.py \
  server/runtime/access.py \
  server/runtime/approvals.py \
  server/runtime/artifacts.py \
  server/runtime/artifact_events.py \
  server/runtime/conversations.py \
  server/runtime/inference.py \
  server/runtime/service.py \
  server/harnesses/base.py \
  server/harnesses/legacy_events.py \
  server/harnesses/anton_provider.py \
  server/harnesses/hermes_provider.py \
  server/harnesses/nanoclaw_provider.py \
  server/routes/conversations.py \
  server/routes/responses.py \
  server/routes/schedules.py \
  server/routes/settings.py \
  server/tests/test_runtime.py

echo "== Runtime unit tests =="
ANTON_COWORK_STATE_DIR="${ANTON_COWORK_STATE_DIR:-$(mktemp -d)}" \
  "$PYTHON_BIN" -m unittest server.tests.test_runtime

echo "== Main build =="
npm run build:main

echo "== Renderer build =="
npm run build:renderer

if [[ "${RUN_EVALS:-0}" == "1" ]]; then
  if ! command -v anton-eval >/dev/null 2>&1; then
    echo "anton-eval was not found on PATH" >&2
    exit 127
  fi
  echo "== Anton eval: core12 =="
  COWORK_HARNESS=anton anton-eval core12
  echo "== Hermes eval: core12 =="
  COWORK_HARNESS=hermes anton-eval core12
else
  echo "== Evals skipped =="
  echo "Set RUN_EVALS=1 to run: COWORK_HARNESS=anton/hermes anton-eval core12"
fi
