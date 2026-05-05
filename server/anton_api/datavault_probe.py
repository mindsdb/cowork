"""Headless anton probe — runs as a server-side worker, not a chat turn.

The Form Handler (`datavault_agent.process_submission_stream`) calls
`run_probe(...)` to find out whether a set of credentials actually
works. The probe spins up a FRESH ChatSession with:

  - empty history
  - no history_store → nothing persists to disk
  - no session_id   → ditto
  - a tiny toolbelt: set_status, report_success, report_failure,
    request_extra_field

The session runs `turn_stream(prompt)` once and ends. The only thing
that survives is the events it yielded back to the caller — which the
Form Handler translates into UI updates (form patches, chat lines,
right-rail scratchpad cells).

The probe is intentionally invisible to the user-facing conversation:
no system probe prompt leaks into chat history, no separate user/assistant
turn pollutes `_history.json`, the cached anton session for the
conversation isn't touched.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

logger = logging.getLogger(__name__)


# ── Event vocabulary the probe yields back to the Form Handler ───────
#
# Tuples of (kind, payload) so the handler can route without isinstance
# checks. Kept dead simple — V1 only needs four kinds.

# kind = 'text'         payload = str        (anton's prose, into chat)
# kind = 'scratchpad'   payload = dict       (right rail, action=start|end|result)
# kind = 'status'       payload = str        (form's live status row)
# kind = 'field_status' payload = dict       ({name, status} — small line under the field; status=null clears)
# kind = 'remove_field' payload = str        (field name to delete from the form)
# kind = 'extra_field'  payload = dict       (patch the form with a new field)
# kind = 'verdict'      payload = ProbeOutcome  (terminal: success/fail/needs_input)


@dataclass
class ProbeOutcome:
    """Final state of a probe run. Set exactly once via the report_*
    or request_extra_field tools (or by the runner if the LLM exits
    without calling any verdict tool — the catch-all is 'failure').
    """
    status: str = "unresolved"  # success | failure | needs_input | unresolved
    summary: str = ""           # one-liner for the chat
    error: str = ""             # the actual problem (failure path)
    extra_fields: list[dict] = field(default_factory=list)  # needs_input
    follow_up: str = ""         # short advice tied to the verdict


def _write_credentials_env(credentials: dict) -> tuple[str, list[str]]:
    """Persist credentials to a tempfile in `.env` format. Returns the
    path + the list of variable names so the prompt can tell anton
    exactly what's available without ever printing the values.

    Caller deletes the file when the probe completes (success or fail).
    """
    var_names: list[str] = []
    lines: list[str] = []
    for key, value in (credentials or {}).items():
        if not key:
            continue
        var = f"DS_{str(key).upper()}"
        var_names.append(var)
        # Backslash + double-quote escaping; literal `\n` for embedded
        # newlines so each var stays single-row. python-dotenv handles
        # this convention natively.
        escaped = (
            str(value)
            .replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("\n", "\\n")
        )
        lines.append(f'{var}="{escaped}"')

    fd, path = tempfile.mkstemp(prefix="anton-vault-", suffix=".env")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    except Exception:
        try: os.unlink(path)
        except Exception: pass
        raise
    return path, var_names


def _summarize_field_roster(form_spec: dict, filled_names: set[str], skipped: list[str]) -> str:
    """Render the current form's fields as a compact bullet list so
    anton can see what already exists (and in what state) before
    deciding whether to add new fields, set per-field status, or
    remove a field. Values themselves are NEVER included — just the
    name + type + a small marker for filled/empty/skipped.
    """
    fields = (form_spec or {}).get("fields") or []
    if not fields:
        return "  (no fields in the current form)"
    skipped_set = set(skipped or [])
    lines: list[str] = []
    for f in fields:
        if not isinstance(f, dict):
            continue
        name = f.get("name") or ""
        if not name:
            continue
        ftype = f.get("type") or "text"
        label = f.get("label") or name
        if name in skipped_set:
            state = "skipped"
        elif name in filled_names:
            state = "filled"
        else:
            state = "empty"
        lines.append(f"  • `{name}` ({ftype}, {state}) — {label}")
    return "\n".join(lines) if lines else "  (no fields)"


def _build_probe_prompt(
    engine: str,
    env_path: str,
    var_names: list[str],
    form_spec: dict,
    skipped: list[str],
) -> str:
    """The single message we pass to the probe session. The system
    prompt (built into ChatSessionConfig.system_prompt_context) is the
    standard anton prompt — we steer behaviour entirely via this user
    message + the toolbelt.
    """
    filled_names = {v.replace("DS_", "", 1).lower() for v in var_names}
    # var_names are uppercased+prefixed env-var names; the field names
    # in form_spec are the original lowercase keys. Normalize both
    # sides for matching the "filled" state in the roster.
    field_names_lower = set()
    for f in (form_spec or {}).get("fields") or []:
        if isinstance(f, dict) and f.get("name"):
            field_names_lower.add(str(f["name"]).lower())
    filled_names = {n for n in filled_names if n in field_names_lower}
    # Map back to original-case names for the roster.
    filled_original = {
        f["name"] for f in ((form_spec or {}).get("fields") or [])
        if isinstance(f, dict) and f.get("name")
        and str(f["name"]).lower() in filled_names
    }
    roster = _summarize_field_roster(form_spec, filled_original, skipped)
    return (
        f"You are a connection prober for `{engine}`. Your only job is "
        f"to determine if the credentials we just collected actually "
        f"work, and report back via your tools.\n\n"
        f"The user-submitted credentials are in a temporary `.env` file:\n"
        f"  Path: `{env_path}`\n"
        f"  Variable names: {', '.join(var_names) or '(none)'}\n\n"
        f"——— CURRENT FORM ROSTER ———\n"
        f"These are the fields ALREADY in the form. Do NOT call "
        f"`request_extra_field` for any of these — they're already "
        f"there (even if empty or skipped). Use exact names if you "
        f"reference them via `set_field_status` or `remove_field`:\n"
        f"{roster}\n\n"
        f"——— STEPS (follow in order) ———\n"
        f"1. Call `set_status` with a short message like \"Loading credentials…\".\n"
        f"2. In the scratchpad, parse the .env file (e.g. `dotenv_values('{env_path}')`). "
        f"NEVER print the values. NEVER echo them back in any tool input.\n"
        f"3. Call `set_status` with \"Installing <pkg>…\" if you need a client library, "
        f"then install it via the scratchpad's `packages` array.\n"
        f"4. Call `set_status` with \"Probing {engine}…\" and run a tiny test query "
        f"(e.g. `SELECT 1` for a database, `/me` for an API, list-buckets for storage).\n"
        f"5. Call EXACTLY ONE of:\n"
        f"   • `report_success(summary=...)` — connection works.\n"
        f"   • `report_failure(error=..., follow_up=...)` — definitively broken. "
        f"`error` should be the underlying issue in plain language; `follow_up` is a "
        f"one-line hint about what the user should fix.\n"
        f"   • `request_extra_field(fields=[{{name, label, type, help}}, ...])` — "
        f"the credentials we have aren't enough (e.g. PostHog needs a project_id we "
        f"didn't ask for). The form will reopen with the new fields appended.\n\n"
        f"——— STATUS + FORM EDIT TOOLS ———\n"
        f"• `set_status(text)` — form-WIDE status (the bar at the top of the panel). "
        f"Use for overall phase: \"Loading\", \"Probing\", etc.\n"
        f"• `set_field_status(name, status)` — PER-FIELD status (a small line under "
        f"one specific field). Use when you want to show that you're testing or "
        f"validating a particular value, e.g. set_field_status(name='api_key', "
        f"status='Validating…') then later set_field_status(name='api_key', "
        f"status='OK') or set_field_status(name='api_key', status=null) to clear. "
        f"`name` MUST match an existing field from the roster above.\n"
        f"• `remove_field(name)` — delete a field from the form. Use when a field "
        f"is no longer relevant (e.g. user picked OAuth so the password field is "
        f"obsolete, or the engine doesn't actually need what we asked for). The "
        f"removal is final for this turn — only do this when you're sure.\n\n"
        f"——— DON'T DUPLICATE ———\n"
        f"Before calling `request_extra_field`, scan the roster above and confirm "
        f"the field isn't already there under any name (including close variants — "
        f"`api_token` vs `api_key`, `account_id` vs `project_id`, etc). If a field "
        f"already exists but is empty/skipped, surface that to the user via "
        f"`set_field_status(name, 'Required for this engine')` instead of adding a "
        f"new one with a similar name.\n\n"
        f"——— RULES ———\n"
        f"• Keep prose to one sentence at most. The form panel shows your live "
        f"status; the user can see scratchpad cells in the right rail.\n"
        f"• NEVER print credential values. NEVER include them in tool inputs.\n"
        f"• You MUST call exactly one verdict tool before stopping. If you don't, "
        f"the run is treated as a failure.\n"
        f"• Don't ask follow-up questions in prose — use `request_extra_field` "
        f"if you need more from the user.\n"
    )


async def run_probe(
    *,
    engine: str,
    credentials: dict,
    base_session,
    form_spec: dict | None = None,
    skipped: list[str] | None = None,
    timeout_seconds: float = 90.0,
) -> AsyncIterator[tuple[str, Any]]:
    """Run one probe attempt against `engine` using `credentials`.

    `base_session` is the conversation's anton ChatSession — we crib
    its llm_client, settings, workspace, etc so the probe inherits the
    same model + configuration without re-doing the build dance. The
    probe itself uses a FRESH ChatSession instance with empty history
    and no persistence, so nothing the LLM does here pollutes the user's
    conversation.

    Yields (kind, payload) tuples; the final yield is always
    `('verdict', ProbeOutcome)` — even on timeout / runner exception
    so the Form Handler can rely on a terminal event.
    """
    # Local imports — anton may not be installed in dev environments,
    # and we don't want this module to crash on import if so.
    from anton.core.session import ChatSession, ChatSessionConfig, SystemPromptContext
    from anton.core.llm.provider import (
        StreamTextDelta, StreamToolResult,
        StreamToolUseStart, StreamToolUseEnd, StreamToolUseDelta, StreamComplete,
    )
    from anton.core.tools.tool_defs import ToolDef
    # ChatSession auto-registers SCRATCHPAD_TOOL inside _build_core_tools(),
    # so we don't have to add it to `tools` ourselves.

    env_path, var_names = _write_credentials_env(credentials)

    outcome = ProbeOutcome()
    # Tools push events into this buffer; the runner drains it between
    # each upstream StreamEvent so updates land in roughly real-time.
    pending: list[tuple[str, Any]] = []

    async def _set_status(_session, tc_input):
        text = (tc_input.get("text") or "").strip()
        if text:
            pending.append(("status", text))
        return "ok"

    async def _set_field_status(_session, tc_input):
        name = (tc_input.get("name") or "").strip()
        if not name:
            return "ignored: missing field name"
        # `status` may be intentionally null/empty to CLEAR an earlier
        # status — pass through verbatim so the patch carries the
        # right semantic (form-store treats null as "delete property").
        status = tc_input.get("status")
        if isinstance(status, str):
            status = status.strip()
        pending.append(("field_status", {"name": name, "status": status}))
        return "ok"

    async def _remove_field(_session, tc_input):
        name = (tc_input.get("name") or "").strip()
        if not name:
            return "ignored: missing field name"
        pending.append(("remove_field", name))
        return "ok"

    async def _report_success(_session, tc_input):
        outcome.status = "success"
        outcome.summary = (tc_input.get("summary") or "").strip()
        return "ok"

    async def _report_failure(_session, tc_input):
        outcome.status = "failure"
        outcome.error = (tc_input.get("error") or "").strip() or "Connection failed."
        outcome.follow_up = (tc_input.get("follow_up") or "").strip()
        return "ok"

    async def _request_extra_field(_session, tc_input):
        outcome.status = "needs_input"
        fields = tc_input.get("fields") or []
        if isinstance(fields, list):
            outcome.extra_fields = [f for f in fields if isinstance(f, dict) and f.get("name")]
        outcome.follow_up = (tc_input.get("reason") or "").strip()
        return "ok"

    SET_FIELD_STATUS_TOOL = ToolDef(
        name="set_field_status",
        description=(
            "Update the small status line under a SPECIFIC field in "
            "the form (e.g. \"Validating…\" under the api_key field). "
            "Use this for granular per-field feedback that's distinct "
            "from the form-wide `set_status`. Pass `status=null` to "
            "clear an earlier status. Never echo credential values."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Field name (must match an existing "
                                   "field in the form, e.g. 'api_key').",
                },
                "status": {
                    "type": ["string", "null"],
                    "description": "Short status line (e.g. 'Validating…', "
                                   "'OK'). Pass null to clear.",
                },
            },
            "required": ["name"],
        },
        handler=_set_field_status,
    )

    REMOVE_FIELD_TOOL = ToolDef(
        name="remove_field",
        description=(
            "Permanently delete a field from the form. Use when a "
            "field is obsolete (e.g. user picked OAuth and the password "
            "is no longer needed) or was a wrong ask. The `name` MUST "
            "match an existing field from the roster."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name of the field to delete.",
                },
            },
            "required": ["name"],
        },
        handler=_remove_field,
    )

    SET_STATUS_TOOL = ToolDef(
        name="set_status",
        description=(
            "Update the form's live status line. Call before every "
            "scratchpad step so the user sees the probe progressing. "
            "Use 3-6 word phrases (e.g. 'Loading credentials', "
            "'Installing posthog', 'Probing /api/me'). Never include "
            "credential values."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Short status line."},
            },
            "required": ["text"],
        },
        handler=_set_status,
    )

    REPORT_SUCCESS_TOOL = ToolDef(
        name="report_success",
        description=(
            "Verdict: the connection works. The form panel flips to a "
            "success state and the credentials are saved to the vault. "
            "Call AT MOST ONCE."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "One-line summary for the chat (e.g. "
                                   "'PostHog reachable, found 3 projects').",
                },
            },
            "required": ["summary"],
        },
        handler=_report_success,
    )

    REPORT_FAILURE_TOOL = ToolDef(
        name="report_failure",
        description=(
            "Verdict: the connection does not work. The form panel "
            "shows the error and lets the user edit + resubmit. The "
            "credentials are NOT saved to the vault. Call AT MOST ONCE."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "error": {
                    "type": "string",
                    "description": "Underlying issue in plain language "
                                   "(e.g. 'API key rejected — token "
                                   "expired or malformed').",
                },
                "follow_up": {
                    "type": "string",
                    "description": "One-line hint for the user "
                                   "(e.g. 'Generate a new personal API "
                                   "key from posthog.com/settings').",
                },
            },
            "required": ["error"],
        },
        handler=_report_failure,
    )

    REQUEST_EXTRA_FIELD_TOOL = ToolDef(
        name="request_extra_field",
        description=(
            "Verdict: the credentials we collected aren't enough — we "
            "need more fields from the user. The form panel re-opens "
            "with the new fields appended. Use this when the engine "
            "needs something the original form didn't ask for "
            "(e.g. PostHog needs `project_id`)."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "fields": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "label": {"type": "string"},
                            "type": {
                                "type": "string",
                                "enum": ["text", "password", "url", "select", "textarea"],
                            },
                            "help": {"type": "string"},
                            "placeholder": {"type": "string"},
                            "required": {"type": "boolean"},
                        },
                        "required": ["name"],
                    },
                },
                "reason": {
                    "type": "string",
                    "description": "Short reason shown above the fields "
                                   "(e.g. 'PostHog also needs your project ID').",
                },
            },
            "required": ["fields"],
        },
        handler=_request_extra_field,
    )

    # Build a probe-only session. Lift the heavy bits (llm client,
    # workspace, settings, scratchpad runtime factory) off the
    # conversation's anton session so we don't redo the build dance.
    # Persistence-related fields are intentionally omitted/None —
    # nothing about this run survives.
    # Probe-only session: lift llm_client + workspace from the
    # conversation's anton session so we get the same model + working
    # directory; everything else is intentionally default. Persistence
    # fields stay None so this run leaves no trace on disk.
    config = ChatSessionConfig(
        llm_client=base_session._llm,
        system_prompt_context=SystemPromptContext(
            runtime_context="",
            suffix=(
                "You are a connection prober. You are NOT in a user-facing "
                "chat — your job is to call your tools to verify a "
                "credential set, then exit. Don't narrate. Don't ask "
                "the user questions in prose."
            ),
            output_context="",
        ),
        workspace=base_session._workspace,
        tools=[
            SET_STATUS_TOOL,
            SET_FIELD_STATUS_TOOL,
            REMOVE_FIELD_TOOL,
            REPORT_SUCCESS_TOOL,
            REPORT_FAILURE_TOOL,
            REQUEST_EXTRA_FIELD_TOOL,
        ],
    )

    try:
        probe_session = ChatSession(config)
    except Exception as exc:
        logger.exception("Could not build probe session")
        outcome.status = "failure"
        outcome.error = f"Could not start probe: {exc}"
        try: os.unlink(env_path)
        except Exception: pass
        yield ("verdict", outcome)
        return

    prompt = _build_probe_prompt(engine, env_path, var_names, form_spec or {}, skipped or [])

    # Track scratchpad lifecycle so the right rail can render cells.
    # turn_stream emits StreamToolUseStart/End around tool calls and
    # StreamToolResult after — for the scratchpad tool, those mean
    # "cell starting" / "cell finished, here's what it printed".
    current_tool_name: dict[str, str] = {}     # id → name
    current_tool_input_json: dict[str, str] = {}  # id → assembled json

    try:
        # Wrap the iteration in a timeout so a hung probe doesn't lock
        # up the SSE stream forever.
        async def _drive():
            async for event in probe_session.turn_stream(prompt):
                # Drain status updates (and any other tool-pushed events)
                # before yielding the upstream event so they appear in
                # roughly the order anton intended.
                while pending:
                    yield pending.pop(0)

                if isinstance(event, StreamTextDelta):
                    if event.text:
                        yield ("text", event.text)
                elif isinstance(event, StreamToolUseStart):
                    current_tool_name[event.id] = event.name
                    current_tool_input_json[event.id] = ""
                    if event.name == "scratchpad":
                        yield ("scratchpad", {"action": "start"})
                elif isinstance(event, StreamToolUseDelta):
                    current_tool_input_json[event.id] = (
                        current_tool_input_json.get(event.id, "") + (event.json_delta or "")
                    )
                elif isinstance(event, StreamToolUseEnd):
                    name = current_tool_name.pop(event.id, "")
                    raw = current_tool_input_json.pop(event.id, "")
                    if name == "scratchpad":
                        # Parse the assembled tool input so the right
                        # rail can show the code + description.
                        import json as _json
                        try:
                            parsed = _json.loads(raw or "{}")
                        except Exception:
                            parsed = {}
                        if (parsed.get("action") or "") == "exec":
                            yield ("scratchpad", {
                                "action": "end",
                                "name": parsed.get("name", ""),
                                "code": parsed.get("code", ""),
                                "one_line_description": parsed.get("one_line_description", ""),
                            })
                elif isinstance(event, StreamToolResult):
                    if event.name == "scratchpad":
                        # `content` is the rendered result (stdout +
                        # stderr + error). Forward verbatim — the rail
                        # already knows how to display this shape.
                        yield ("scratchpad", {
                            "action": "result",
                            "content": event.content or "",
                        })
                elif isinstance(event, StreamComplete):
                    pass  # turn_stream's outer iteration handles termination

            # Drain any final tool-pushed events that arrived after the
            # last upstream event (e.g. report_success fired in the
            # final assistant message).
            while pending:
                yield pending.pop(0)

        # Manual timeout — wraps each `__anext__` so per-iteration
        # progress resets the clock would be nice but we keep it
        # simple here. Total probe budget is `timeout_seconds`.
        gen = _drive().__aiter__()
        deadline = asyncio.get_event_loop().time() + timeout_seconds
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                outcome.status = "failure"
                outcome.error = f"Probe timed out after {int(timeout_seconds)}s."
                outcome.follow_up = "Try again, or check that the service is reachable."
                break
            try:
                evt = await asyncio.wait_for(gen.__anext__(), timeout=remaining)
            except StopAsyncIteration:
                break
            except asyncio.TimeoutError:
                outcome.status = "failure"
                outcome.error = f"Probe timed out after {int(timeout_seconds)}s."
                outcome.follow_up = "Try again, or check that the service is reachable."
                break
            yield evt

    except Exception as exc:
        logger.exception("Probe session crashed")
        outcome.status = "failure"
        outcome.error = f"Probe crashed: {exc}"
    finally:
        try:
            os.unlink(env_path)
        except Exception:
            logger.debug("Could not delete temp env file %s", env_path, exc_info=True)

    # Default verdict if anton stopped without calling any of the
    # report_* tools — treat as failure rather than silently succeeding.
    if outcome.status == "unresolved":
        outcome.status = "failure"
        outcome.error = "Probe ended without a verdict."
        outcome.follow_up = "Try resubmitting; if it persists, check that the engine name matches what you intend to connect to."

    yield ("verdict", outcome)
