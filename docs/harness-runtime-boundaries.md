# Cowork Harness Runtime Boundaries

This branch treats Cowork as the application runtime and each harness as a
turn executor.

## Cowork-owned

- Conversations, messages, turns, events, approvals, uploads, artifacts, schedules, settings, and inference profiles.
- Canonical event schema: `cowork.event.v1`.
- Responses SSE compatibility mapping for the current renderer.
- Artifact validation and registration under `<project>/artifacts/<slug>/`.
- Access policy and approval ledger.

## Harness-owned

- Native execution loop and tool semantics.
- Native memory and skills surfaces.
- Adapter-private working state needed to run a turn.
- Translation from native or legacy stream events into `CoworkEvent`.

Harness-side episode files are not a UI source of truth for new runtime
conversations. They can exist only as adapter-private state.

## Extraction Candidates

Move these stable primitives to `mindsdb/cowork-server` when Stage 11 is
approved:

- `server/runtime/schemas.py`
- `server/harnesses/base.py`
- `server/runtime/events.py`
- `server/harnesses/legacy_events.py`
- `server/runtime/inference.py`
- `server/runtime/access.py`
- `server/runtime/approvals.py`
- `server/runtime/artifacts.py`
- `server/runtime/artifact_events.py`
- storage primitives from `server/runtime/conversations.py`

Keep these in the desktop app unless there is a separate product decision:

- Electron process supervision.
- Local app launch/restart scripts.
- Desktop-only filesystem open/reveal behavior.
- Existing Anton/Hermes desktop adapter wiring.
