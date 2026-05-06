"""Schedule business logic — parsing, validation, execution, scheduler loop.

Raises ValueError for validation failures instead of HTTPException.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from anton_api import conversation_manager
from routes.cowork_state import load_state, save_state, utc_now_iso

SERVER_STARTED_AT = datetime.now(timezone.utc)
_scheduler_task: asyncio.Task | None = None

VALID_CADENCES = {"once", "hourly", "daily", "weekly"}


class InvalidScheduleError(ValueError):
    """Raised when schedule input fails validation."""


def task_title(content: str) -> str:
    lines = (content or "").strip().splitlines() if content else []
    text = lines[0].strip() if lines else "Scheduled task"
    return text[:60] + ("\u2026" if len(text) > 60 else "")


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def new_schedule_id() -> str:
    return f"sch_{uuid.uuid4().hex[:14]}"


def normalise_cadence(value: str) -> str:
    cadence = value.strip().lower()
    if cadence not in VALID_CADENCES:
        raise InvalidScheduleError("Cadence must be once, hourly, daily, or weekly.")
    return cadence


def mark_missed(state: dict) -> bool:
    changed = False
    now = datetime.now(timezone.utc)
    for schedule in state.get("schedules", []):
        if not schedule.get("enabled"):
            continue
        if schedule.get("catchupPending"):
            continue
        next_run = parse_datetime(schedule.get("nextRunAt"))
        if next_run and next_run < SERVER_STARTED_AT and next_run < now:
            schedule["catchupPending"] = True
            schedule["updatedAt"] = utc_now_iso()
            changed = True
    return changed


def advance_schedule(schedule: dict) -> None:
    cadence = schedule.get("cadence", "once")
    if cadence == "once":
        schedule["enabled"] = False
        return
    next_run = parse_datetime(schedule.get("nextRunAt")) or datetime.now(timezone.utc)
    delta = {
        "hourly": timedelta(hours=1),
        "daily": timedelta(days=1),
        "weekly": timedelta(days=7),
    }[cadence]
    now = datetime.now(timezone.utc)
    while next_run <= now:
        next_run += delta
    schedule["nextRunAt"] = next_run.isoformat()


def serialise_schedule(
    *,
    title: str,
    prompt: str,
    cadence: str,
    tz: str,
    next_run_at: str,
    enabled: bool,
    project: str | None,
    model: str | None,
) -> dict:
    cadence = normalise_cadence(cadence)
    next_run = parse_datetime(next_run_at)
    if not next_run:
        raise InvalidScheduleError("Next run time must be a valid ISO datetime.")
    now = utc_now_iso()
    return {
        "id": new_schedule_id(),
        "title": title.strip() or task_title(prompt),
        "prompt": prompt,
        "cadence": cadence,
        "timezone": tz or "local",
        "nextRunAt": next_run.isoformat(),
        "enabled": enabled,
        "project": project,
        "model": model,
        "lastRunAt": None,
        "lastResultSessionId": None,
        "lastError": None,
        "catchupPending": False,
        "createdAt": now,
        "updatedAt": now,
    }


async def run_schedule(schedule: dict, manual: bool = False) -> dict:
    from anton.core.llm.provider import StreamTextDelta

    title = schedule.get("title") or task_title(schedule.get("prompt", "Scheduled task"))
    task = {
        "title": title,
        "summary": "Scheduled Anton task",
        "project": schedule.get("project"),
        "model": schedule.get("model"),
        "status": "running",
        "createdAt": utc_now_iso(),
        "updatedAt": utc_now_iso(),
        "scheduledId": schedule.get("id"),
        "attachments": [],
        "messages": [
            {
                "role": "user",
                "content": schedule.get("prompt", ""),
                "createdAt": utc_now_iso(),
                "attachments": [],
            }
        ],
    }

    conversation_id: str | None = None
    try:
        event_stream, conversation_id = await conversation_manager.chat_stream(
            schedule.get("prompt", ""),
            project=schedule.get("project"),
            model=schedule.get("model"),
        )
        task["id"] = conversation_id
        parts: list[str] = []
        async for event in event_stream:
            if isinstance(event, StreamTextDelta):
                parts.append(event.text)
        answer = "".join(parts).strip()
        task["messages"].append({"role": "assistant", "content": answer, "createdAt": utc_now_iso()})
        task["status"] = "idle"
        task["updatedAt"] = utc_now_iso()
        schedule["lastError"] = None
    except Exception as exc:
        if conversation_id is None:
            conversation_id = f"sched_{uuid.uuid4().hex[:12]}"
            task["id"] = conversation_id
        task["status"] = "error"
        task["error"] = str(exc)
        task["updatedAt"] = utc_now_iso()
        schedule["lastError"] = str(exc)

    schedule["lastRunAt"] = utc_now_iso()
    schedule["lastResultSessionId"] = conversation_id
    schedule["catchupPending"] = False
    if not manual:
        advance_schedule(schedule)
    schedule["updatedAt"] = utc_now_iso()
    return {"schedule": schedule, "session": task}


def get_schedules() -> list[dict]:
    state = load_state()
    if mark_missed(state):
        save_state(state)
    return state.get("schedules", [])


def create_schedule(
    *,
    title: str,
    prompt: str,
    cadence: str,
    tz: str,
    next_run_at: str,
    enabled: bool,
    project: str | None,
    model: str | None,
) -> dict:
    schedule = serialise_schedule(
        title=title, prompt=prompt, cadence=cadence, tz=tz,
        next_run_at=next_run_at, enabled=enabled,
        project=project, model=model,
    )
    state = load_state()
    state["schedules"].insert(0, schedule)
    save_state(state)
    return schedule


def update_schedule_fields(schedule_id: str, **fields) -> dict | None:
    """Returns updated schedule or None if not found.

    Raises InvalidScheduleError for bad cadence/datetime.
    """
    state = load_state()
    schedule = next((s for s in state.get("schedules", []) if s.get("id") == schedule_id), None)
    if not schedule:
        return None

    if "title" in fields and fields["title"] is not None:
        schedule["title"] = fields["title"].strip() or schedule["title"]
    if "prompt" in fields and fields["prompt"] is not None:
        schedule["prompt"] = fields["prompt"]
    if "cadence" in fields and fields["cadence"] is not None:
        schedule["cadence"] = normalise_cadence(fields["cadence"])
    if "timezone" in fields and fields["timezone"] is not None:
        schedule["timezone"] = fields["timezone"] or "local"
    if "next_run_at" in fields and fields["next_run_at"] is not None:
        next_run = parse_datetime(fields["next_run_at"])
        if not next_run:
            raise InvalidScheduleError("Next run time must be a valid ISO datetime.")
        schedule["nextRunAt"] = next_run.isoformat()
        schedule["catchupPending"] = False
    if "project" in fields and fields["project"] is not None:
        schedule["project"] = fields["project"]
    if "model" in fields and fields["model"] is not None:
        schedule["model"] = fields["model"]
    if "enabled" in fields and fields["enabled"] is not None:
        schedule["enabled"] = fields["enabled"]
        if fields["enabled"]:
            schedule["catchupPending"] = False

    schedule["updatedAt"] = utc_now_iso()
    save_state(state)
    return schedule


def delete_schedule_by_id(schedule_id: str) -> bool:
    """Returns True if found and deleted, False if not found."""
    state = load_state()
    before = len(state.get("schedules", []))
    state["schedules"] = [s for s in state.get("schedules", []) if s.get("id") != schedule_id]
    if len(state["schedules"]) == before:
        return False
    save_state(state)
    return True


def find_schedule(schedule_id: str) -> dict | None:
    state = load_state()
    return next((s for s in state.get("schedules", []) if s.get("id") == schedule_id), None)


async def run_schedule_now(schedule_id: str) -> dict | None:
    """Returns result dict or None if not found."""
    state = load_state()
    schedule = next((s for s in state.get("schedules", []) if s.get("id") == schedule_id), None)
    if not schedule:
        return None
    result = await run_schedule(schedule, manual=True)
    save_state(state)
    return result


# ── Scheduler loop ───────────────────────────────────────────────────────

async def _scheduler_loop() -> None:
    while True:
        await asyncio.sleep(30)
        state = load_state()
        now = datetime.now(timezone.utc)
        changed = mark_missed(state)
        for schedule in state.get("schedules", []):
            if not schedule.get("enabled") or schedule.get("catchupPending"):
                continue
            next_run = parse_datetime(schedule.get("nextRunAt"))
            if not next_run or next_run > now:
                continue
            await run_schedule(schedule, manual=False)
            changed = True
        if changed:
            save_state(state)


def start_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _scheduler_task = loop.create_task(_scheduler_loop())
