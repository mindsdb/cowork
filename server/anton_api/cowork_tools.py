"""Cowork-side tool wrappers.

Anton's stock tools (PUBLISH_TOOL, CONNECT_DATASOURCE_TOOL, …) are
written for the CLI: they assume a Rich Console attached to a TTY,
they pop the system browser, and they hold the user's gaze with
animated spinners. None of that works inside the FastAPI process the
desktop app spawns.

We build cowork-flavoured wrappers that share the LLM-facing schema
(name / description / input_schema) so the model uses them
identically, but whose handlers do the actual work in a way that
makes sense for a server process: no console.print, no Live spinner,
no webbrowser.open. Status flows back to the desktop UI through the
normal SSE event stream and the response string the LLM renders.

Right now we only override PUBLISH_TOOL — the only one users have hit.
Add more here as needed (CONNECT_DATASOURCE_TOOL is the next likely
candidate; same pattern).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


async def _cowork_publish_or_preview(session: Any, tc_input: dict) -> str:
    """Server-side equivalent of anton.tools.handle_publish_or_preview.

    Mirrors the same `action` semantics:
      - 'ask' / 'preview' → return a string pointing the user at the
        Live Artifacts panel; the desktop UI already exposes preview
        and publish buttons there. We don't open a browser here.
      - 'publish' → call anton.publisher.publish directly, persist the
        result in `<output_dir>/.published.json`, return the view URL.
    """
    raw_path = tc_input.get("file_path", "")
    title = tc_input.get("title", "Dashboard")
    action = (tc_input.get("action") or "ask").lower()

    if not raw_path:
        return "publish_or_preview: missing file_path"

    file_path = Path(raw_path).expanduser()
    if not file_path.is_absolute():
        # Anton's session carries the active workspace base.
        workspace = getattr(session, "_workspace", None)
        if workspace is not None:
            base = getattr(workspace, "base", None)
            if base:
                file_path = Path(base) / raw_path
    file_path = file_path.resolve()

    if not file_path.exists():
        return f"File not found: {file_path}"

    # 'ask' and 'preview' are no-ops in the desktop chat — the artifact
    # is already visible in the Live Artifacts panel and inline in the
    # assistant turn. Returning a clear string lets the LLM continue
    # without ever invoking a CLI prompt.
    if action in ("ask", "preview"):
        return (
            f"Created {title} at {file_path}. The user can preview, publish, "
            f"or copy a public URL from the Live Artifacts panel — they don't "
            f"need a /publish command in the desktop app."
        )

    if action != "publish":
        return f"publish_or_preview: unknown action '{action}'"

    # ── action == 'publish' ───────────────────────────────────────────
    # Read the API key the same way the cowork HTTP endpoint does so
    # both code paths agree on what's "configured".
    try:
        from .settings import _get_env
    except Exception as exc:
        logger.exception("Cowork publish tool could not import settings helper")
        return f"PUBLISH FAILED: settings module unavailable ({exc})"

    api_key = _get_env("ANTON_MINDS_API_KEY")
    if not api_key:
        return (
            "STOP: No Minds API key configured. Tell the user to set their "
            "Minds API key in Settings (or in their .env) before publishing. "
            "Do NOT call this tool again until they confirm the key is set."
        )

    publish_url = _get_env("ANTON_PUBLISH_URL", "https://4nton.ai")
    ssl_verify = _get_env("ANTON_MINDS_SSL_VERIFY", "true").lower() == "true"

    try:
        from anton.publisher import publish
    except Exception as exc:
        logger.exception("Cowork publish tool could not import anton.publisher")
        return f"PUBLISH FAILED: anton.publisher unavailable ({exc})"

    output_dir = file_path.parent
    published_json_path = output_dir / ".published.json"
    published_map: dict[str, Any] = {}
    if published_json_path.is_file():
        try:
            published_map = json.loads(published_json_path.read_text(encoding="utf-8"))
        except Exception:
            published_map = {}

    file_key = file_path.name
    prev = published_map.get(file_key)
    report_id = prev.get("report_id") if isinstance(prev, dict) else None

    def _do_publish(rid: str | None):
        return publish(
            file_path,
            api_key=api_key,
            report_id=rid,
            publish_url=publish_url,
            ssl_verify=ssl_verify,
        )

    try:
        result = _do_publish(report_id)
    except Exception as exc:
        # If we tried to update an existing report and the upstream
        # rejected it (e.g. report was deleted), retry as a fresh one
        # — same recovery path anton's CLI tool uses.
        if report_id:
            try:
                result = _do_publish(None)
            except Exception as retry_exc:
                logger.exception("Cowork publish retry failed")
                return f"PUBLISH FAILED: {retry_exc}"
        else:
            logger.exception("Cowork publish failed")
            return f"PUBLISH FAILED: {exc}"

    view_url = result.get("view_url", "") if isinstance(result, dict) else ""
    returned_report_id = result.get("report_id", "") if isinstance(result, dict) else ""

    if returned_report_id:
        published_map[file_key] = {
            "report_id": returned_report_id,
            "url": view_url,
            "last_md5": result.get("md5", "") if isinstance(result, dict) else "",
        }
        try:
            published_json_path.write_text(
                json.dumps(published_map, indent=2) + "\n",
                encoding="utf-8",
            )
        except Exception:
            logger.debug("Could not persist .published.json", exc_info=True)

    if not view_url:
        return "Published, but no view URL was returned."
    return f"Published successfully! View URL: {view_url}"


def build_cowork_publish_tool():
    """Construct a ToolDef matching anton's PUBLISH_TOOL schema, but
    with the cowork-aware handler. Lazy-imports anton.tools so callers
    can build the session config without paying the import cost twice.
    """
    from anton.tools import PUBLISH_TOOL
    from anton.core.tools.tool_defs import ToolDef

    return ToolDef(
        name=PUBLISH_TOOL.name,
        description=PUBLISH_TOOL.description,
        input_schema=PUBLISH_TOOL.input_schema,
        handler=_cowork_publish_or_preview,
        prompt=PUBLISH_TOOL.prompt,
    )
