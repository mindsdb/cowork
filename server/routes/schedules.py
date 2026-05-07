"""Local scheduled task APIs for Anton CoWork."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from anton_api import conversation_manager
from .cowork_state import load_state, save_state, utc_now_iso


router = APIRouter(prefix="/v1/schedules", tags=["schedules"])


def _task_title(content: str) -> str:
    text = (content or "").strip().splitlines()[0] if content else "Scheduled task"
    return text[:60] + ("…" if len(text) > 60 else "")

SERVER_STARTED_AT = datetime.now(timezone.utc)
_scheduler_task: asyncio.Task | None = None


class ScheduleRequest(BaseModel):
    title: str = Field(default="Scheduled task", max_length=160)
    prompt: str
    cadence: str = "once"
    timezone: str = "local"
    next_run_at: str
    project: str | None = None
    model: str | None = None
    enabled: bool = True


class ScheduleUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    prompt: str | None = None
    cadence: str | None = None
    timezone: str | None = None
    next_run_at: str | None = None
    project: str | None = None
    model: str | None = None
    enabled: bool | None = None


def _parse_datetime(value: str | None) -> datetime | None:
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


def _new_schedule_id() -> str:
    return f"sch_{uuid.uuid4().hex[:14]}"


def _normalise_cadence(value: str) -> str:
    cadence = value.strip().lower()
    if cadence not in {"once", "hourly", "daily", "weekly"}:
        raise HTTPException(status_code=400, detail="Cadence must be once, hourly, daily, or weekly.")
    return cadence


def _mark_missed(state: dict) -> bool:
    changed = False
    now = datetime.now(timezone.utc)
    for schedule in state.get("schedules", []):
        if not schedule.get("enabled"):
            continue
        if schedule.get("catchupPending"):
            continue
        next_run = _parse_datetime(schedule.get("nextRunAt"))
        if next_run and next_run < SERVER_STARTED_AT and next_run < now:
            schedule["catchupPending"] = True
            schedule["updatedAt"] = utc_now_iso()
            changed = True
    return changed


def _advance_schedule(schedule: dict) -> None:
    cadence = schedule.get("cadence", "once")
    if cadence == "once":
        schedule["enabled"] = False
        return
    next_run = _parse_datetime(schedule.get("nextRunAt")) or datetime.now(timezone.utc)
    delta = {
        "hourly": timedelta(hours=1),
        "daily": timedelta(days=1),
        "weekly": timedelta(days=7),
    }[cadence]
    now = datetime.now(timezone.utc)
    while next_run <= now:
        next_run += delta
    schedule["nextRunAt"] = next_run.isoformat()


def _serialise_schedule(request: ScheduleRequest) -> dict:
    cadence = _normalise_cadence(request.cadence)
    next_run = _parse_datetime(request.next_run_at)
    if not next_run:
        raise HTTPException(status_code=400, detail="Next run time must be a valid ISO datetime.")
    now = utc_now_iso()
    return {
        "id": _new_schedule_id(),
        "title": request.title.strip() or _task_title(request.prompt),
        "prompt": request.prompt,
        "cadence": cadence,
        "timezone": request.timezone or "local",
        "nextRunAt": next_run.isoformat(),
        "enabled": request.enabled,
        "project": request.project,
        "model": request.model,
        "lastRunAt": None,
        "lastResultSessionId": None,
        "lastError": None,
        "catchupPending": False,
        "createdAt": now,
        "updatedAt": now,
    }


# Cap how many run records we keep per schedule. Old records fall
# off the front, newest stay at the end. 500 covers a year of daily
# runs or a month of hourly — plenty for the in-app health view, and
# keeps state.json small enough to round-trip cheaply.
_MAX_RUNS_PER_SCHEDULE = 500


def _append_run_record(state: dict, schedule_id: str, record: dict) -> None:
    runs_by_id = state.setdefault("schedule_runs", {})
    if not isinstance(runs_by_id, dict):
        runs_by_id = {}
        state["schedule_runs"] = runs_by_id
    bucket = runs_by_id.setdefault(schedule_id, [])
    if not isinstance(bucket, list):
        bucket = []
        runs_by_id[schedule_id] = bucket
    bucket.append(record)
    if len(bucket) > _MAX_RUNS_PER_SCHEDULE:
        del bucket[: len(bucket) - _MAX_RUNS_PER_SCHEDULE]


async def _run_schedule(schedule: dict, manual: bool = False, *, state: dict | None = None) -> dict:
    """Execute one run of a scheduled task.

    Side effects on the schedule itself: updates `lastRunAt`,
    `lastResultSessionId`, `lastError`, `updatedAt`. For non-manual
    runs the cadence advances `nextRunAt`.

    Side effects on state: when `state` is provided, appends a run
    record to `state["schedule_runs"][<schedule_id>]`. The caller is
    responsible for save_state() afterward so writes happen once.
    """
    from anton.core.llm.provider import StreamTextDelta

    title = schedule.get("title") or _task_title(schedule.get("prompt", "Scheduled task"))
    started_at_iso = utc_now_iso()
    started_at_dt  = datetime.now(timezone.utc)
    task = {
        "title": title,
        "summary": "Scheduled Anton task",
        "project": schedule.get("project"),
        "model": schedule.get("model"),
        "status": "running",
        "createdAt": started_at_iso,
        "updatedAt": started_at_iso,
        "scheduledId": schedule.get("id"),
        "attachments": [],
        "messages": [
            {
                "role": "user",
                "content": schedule.get("prompt", ""),
                "createdAt": started_at_iso,
                "attachments": [],
            }
        ],
    }

    conversation_id: str | None = None
    error_message: str | None = None
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
        error_message = str(exc)
        task["status"] = "error"
        task["error"] = error_message
        task["updatedAt"] = utc_now_iso()
        schedule["lastError"] = error_message

    finished_at_iso = utc_now_iso()
    finished_at_dt  = datetime.now(timezone.utc)
    schedule["lastRunAt"] = finished_at_iso
    schedule["lastResultSessionId"] = conversation_id
    schedule["catchupPending"] = False
    if not manual:
        _advance_schedule(schedule)
    schedule["updatedAt"] = finished_at_iso

    # Persist the run record alongside the schedule update so the
    # detail page can graph health over time, and individual runs are
    # navigable from the runs list.
    if state is not None and schedule.get("id"):
        _append_run_record(state, schedule["id"], {
            "id": f"run_{uuid.uuid4().hex[:14]}",
            "scheduleId": schedule["id"],
            "startedAt": started_at_iso,
            "finishedAt": finished_at_iso,
            "durationMs": int((finished_at_dt - started_at_dt).total_seconds() * 1000),
            "status": "error" if error_message else "success",
            "error": error_message,
            "sessionId": conversation_id,
            "manual": bool(manual),
        })

    return {"schedule": schedule, "session": task}


async def _scheduler_loop() -> None:
    while True:
        await asyncio.sleep(30)
        state = load_state()
        now = datetime.now(timezone.utc)
        changed = _mark_missed(state)
        for schedule in state.get("schedules", []):
            if not schedule.get("enabled") or schedule.get("catchupPending"):
                continue
            next_run = _parse_datetime(schedule.get("nextRunAt"))
            if not next_run or next_run > now:
                continue
            await _run_schedule(schedule, manual=False, state=state)
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


@router.get("")
def list_schedules():
    state = load_state()
    if _mark_missed(state):
        save_state(state)
    return {"schedules": state.get("schedules", [])}


@router.post("")
def create_schedule(request: ScheduleRequest):
    state = load_state()
    schedule = _serialise_schedule(request)
    state["schedules"].insert(0, schedule)
    save_state(state)
    return {"schedule": schedule}


@router.put("/{schedule_id}")
def update_schedule(schedule_id: str, request: ScheduleUpdateRequest):
    state = load_state()
    schedule = next((item for item in state.get("schedules", []) if item.get("id") == schedule_id), None)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    if request.title is not None:
        schedule["title"] = request.title.strip() or schedule["title"]
    if request.prompt is not None:
        schedule["prompt"] = request.prompt
    if request.cadence is not None:
        schedule["cadence"] = _normalise_cadence(request.cadence)
    if request.timezone is not None:
        schedule["timezone"] = request.timezone or "local"
    if request.next_run_at is not None:
        next_run = _parse_datetime(request.next_run_at)
        if not next_run:
            raise HTTPException(status_code=400, detail="Next run time must be a valid ISO datetime.")
        schedule["nextRunAt"] = next_run.isoformat()
        schedule["catchupPending"] = False
    if request.project is not None:
        schedule["project"] = request.project
    if request.model is not None:
        schedule["model"] = request.model
    if request.enabled is not None:
        schedule["enabled"] = request.enabled
        if request.enabled:
            schedule["catchupPending"] = False
    schedule["updatedAt"] = utc_now_iso()
    save_state(state)
    return {"schedule": schedule}


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: str):
    state = load_state()
    before = len(state.get("schedules", []))
    state["schedules"] = [item for item in state.get("schedules", []) if item.get("id") != schedule_id]
    if len(state["schedules"]) == before:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    save_state(state)
    return {"ok": True}


@router.post("/{schedule_id}/pause")
def pause_schedule(schedule_id: str):
    return update_schedule(schedule_id, ScheduleUpdateRequest(enabled=False))


@router.post("/{schedule_id}/resume")
def resume_schedule(schedule_id: str):
    return update_schedule(schedule_id, ScheduleUpdateRequest(enabled=True))


@router.post("/{schedule_id}/run-now")
async def run_schedule_now(schedule_id: str):
    state = load_state()
    schedule = next((item for item in state.get("schedules", []) if item.get("id") == schedule_id), None)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    result = await _run_schedule(schedule, manual=True, state=state)
    save_state(state)
    return result


@router.get("/{schedule_id}/runs")
def list_schedule_runs(schedule_id: str, limit: int = 100):
    """Return the schedule's run history, newest first.

    Each record:
      { id, scheduleId, startedAt, finishedAt, durationMs,
        status: 'success'|'error', error, sessionId, manual }

    The history is capped per-schedule (see _MAX_RUNS_PER_SCHEDULE).
    The optional `limit` query param caps the response further; default
    100 is enough to power the detail page's recent-runs list and the
    7/30-day health chart without paging.
    """
    state = load_state()
    schedule = next((s for s in state.get("schedules", []) if s.get("id") == schedule_id), None)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    bucket = state.get("schedule_runs", {}).get(schedule_id, []) or []
    # Newest first — append-order is oldest→newest, so reverse and slice.
    runs = list(reversed(bucket))
    if limit and limit > 0:
        runs = runs[: int(limit)]
    return {"schedule_id": schedule_id, "runs": runs}
