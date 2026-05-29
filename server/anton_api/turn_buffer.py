"""File-backed buffer for one LLM turn.

Phase 1 of the task-lifecycle rewrite. The producer (anton-core's
`turn_stream` consumer) writes JSONL records to a per-turn file
inside ``<project>/.anton/streams/<conversation_id>/<turn_id>.jsonl``.
Any number of readers (the SSE response, a reconnecting client, a
dev running ``tail -f``) can read from the file independently.

Two properties this gives us:

  1. **The work is decoupled from any single consumer.** Producer is
     spawned as ``asyncio.create_task``; closing one consumer never
     reaches it. Closing all consumers doesn't reach it either.
  2. **State survives across reconnects (and the page-close/-reopen
     loop in the renderer).** A returning client passes ``from_seq``;
     ``tail_buffer`` re-reads the file from that offset and continues
     into the live tail.

JSONL record shape::

    {"seq": 0, "ts": "...", "type": "TextDelta",  "data": {"text": "Let me"}}
    {"seq": 1, "ts": "...", "type": "TaskProgress", "data": {"phase": "scratchpad_start"}}
    ...
    {"seq": N, "ts": "...", "type": "Done",        "data": {"reason": "completed"}}

The terminal record is always one of ``Done`` / ``Cancelled`` /
``Error`` / ``Interrupted`` — readers loop until they see one and
then stop.

The event-renew pattern is the classic "many readers, one writer"
async signal. Each ``append`` swaps in a fresh ``asyncio.Event`` and
fires the old one — any reader awaiting the old event wakes up; any
reader that arrives after the swap awaits the fresh event. No risk
of a fire-and-clear race wiping out a signal between waiters.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Literal


logger = logging.getLogger(__name__)


TerminalReason = Literal["completed", "cancelled", "error", "interrupted", "restart"]
_TERMINAL_TYPES = frozenset({"Done", "Cancelled", "Error", "Interrupted"})


@dataclass(frozen=True)
class TurnRecord:
    seq: int
    ts: str
    type: str
    data: dict

    @property
    def is_terminal(self) -> bool:
        return self.type in _TERMINAL_TYPES


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Reserved chars that the OS / filesystem dislike in filenames.
_BAD_NAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_segment(name: str) -> str:
    """Sanitize a conversation_id / turn_id for use as a path segment.

    Conversation IDs are server-generated UUIDs today, but a defensive
    pass means a malformed inbound value (e.g. a hand-edited request)
    can't escape the buffers directory.
    """
    cleaned = _BAD_NAME_CHARS.sub("_", name or "").strip("_") or "_"
    return cleaned[:128]


def turn_buffer_path(streams_dir: Path, conversation_id: str, turn_id: int) -> Path:
    return (
        streams_dir
        / _safe_segment(conversation_id)
        / f"turn_{int(turn_id):06d}.jsonl"
    )


class BufferedTurnWriter:
    """One-producer, many-readers JSONL buffer for a single turn.

    Producer side: call ``append(type, data)`` for each event, then
    call ``close(reason)`` exactly once. Both are synchronous and
    cheap — disk write + ``flush()`` per record, no fsync. (Losing
    the last few KB on a hard process crash is acceptable for what
    is fundamentally a UI replay log; durability is handled by the
    higher-level "interrupted by restart" sweep on boot.)

    Reader side: see ``tail_buffer`` below — no API on the writer
    itself, readers just consume the file and the renewable event.
    """

    def __init__(self, path: Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # Open the file for append. Each record is one JSONL line.
        self._writer = self._path.open("a", encoding="utf-8")
        self._seq: int = 0
        # Renewable signal: see module docstring. ``_new_data`` is the
        # event a CURRENT waiter will be awaiting. Each append swaps it
        # for a fresh event AND fires the old one, so old waiters wake
        # without racing future waiters.
        self._new_data: asyncio.Event = asyncio.Event()
        # One-shot terminal event so callers can also wait specifically
        # for "the turn is done."
        self._done: asyncio.Event = asyncio.Event()
        self._closed: bool = False

    # ── writer API ───────────────────────────────────────────────────

    def append(self, type_: str, data: dict) -> int:
        """Write one JSONL record and signal waiters. Returns the seq."""
        if self._closed:
            # Closed buffers shouldn't be appended to. Logged rather
            # than raised — telemetry isn't a turn-stopper.
            logger.warning("Append to closed buffer %s ignored", self._path)
            return self._seq
        record = {
            "seq": self._seq,
            "ts": _now_iso(),
            "type": type_,
            "data": data,
        }
        try:
            self._writer.write(json.dumps(record, ensure_ascii=False) + "\n")
            self._writer.flush()
        except Exception:
            logger.exception("Failed to write turn record (path=%s)", self._path)
            return self._seq
        seq = self._seq
        self._seq += 1
        # Renew the event so future waiters get a clean wait + fire the
        # one current waiters are blocked on.
        old, self._new_data = self._new_data, asyncio.Event()
        old.set()
        return seq

    def close(self, reason: TerminalReason, extra: dict | None = None) -> None:
        """Write the terminal record and mark the buffer done.

        Idempotent: a second close() is a no-op. Always writes the
        terminal as the next sequence — no skipped seq.
        """
        if self._closed:
            return
        terminal_type = {
            "completed":   "Done",
            "cancelled":   "Cancelled",
            "error":       "Error",
            "interrupted": "Interrupted",
            "restart":     "Interrupted",
        }.get(reason, "Done")
        self.append(terminal_type, {"reason": reason, **(extra or {})})
        try:
            self._writer.close()
        except Exception:
            pass
        self._closed = True
        self._done.set()
        # Also fire the new-data event so any straggler readers wake.
        old, self._new_data = self._new_data, asyncio.Event()
        old.set()

    # ── reader API (used by tail_buffer; kept on the writer for
    #    locality with the swap-event pattern) ───────────────────────

    @property
    def path(self) -> Path:
        return self._path

    @property
    def done(self) -> asyncio.Event:
        return self._done

    @property
    def is_closed(self) -> bool:
        return self._closed

    @property
    def latest_seq(self) -> int:
        """Sequence of the NEXT record (== count of records written)."""
        return self._seq

    def snapshot_new_data_event(self) -> asyncio.Event:
        """Snapshot the current new-data event for a reader to await.

        Readers MUST capture this BEFORE re-reading the file, so any
        append that lands between the read and the wait either:
          - already shows in the file (reader picks it up on re-read), or
          - swaps the snapshotted event for a fresh one and fires the
            snapshot (reader's wait returns immediately).
        Either way, no signal lost.
        """
        return self._new_data


def read_records(path: Path, from_seq: int = 0) -> Iterator[TurnRecord]:
    """Read all JSONL records from *path* with ``seq >= from_seq``.

    Yields ``TurnRecord``s in file order. Tolerates partial last lines
    (a producer crash mid-write) — they're skipped, not raised.
    """
    if not path.is_file():
        return
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    # Half-written record from a producer crash. Skip
                    # rather than break the reader — the next append
                    # will overwrite the line break, and the terminal
                    # sweep on boot will surface the missing close.
                    continue
                seq = int(obj.get("seq", -1))
                if seq < from_seq:
                    continue
                yield TurnRecord(
                    seq=seq,
                    ts=str(obj.get("ts", "")),
                    type=str(obj.get("type", "")),
                    data=dict(obj.get("data") or {}),
                )
    except OSError as exc:
        logger.warning("Could not read turn buffer at %s: %s", path, exc)


def latest_terminal_reason(path: Path) -> TerminalReason | None:
    """Return the terminal record's ``reason`` if the file ends with
    one, else None. Used by the boot-time interrupted-sweep to decide
    which buffers need a synthetic close.

    Cheap implementation: scan all records. These files are small (a
    typical turn is a few KB) so a backwards-scan optimisation isn't
    worth the complexity for v1.
    """
    if not path.is_file():
        return None
    last_terminal: TerminalReason | None = None
    for rec in read_records(path):
        if rec.is_terminal:
            reason = rec.data.get("reason")
            if isinstance(reason, str):
                last_terminal = reason  # type: ignore[assignment]
    return last_terminal


def seal_orphan_buffers(streams_root: Path) -> int:
    """Phase 4 — boot-time recovery for buffers left open by a crash.

    Walks ``streams_root/<conversation_id>/turn_*.jsonl`` and, for
    every file whose last record is not a terminal type, appends a
    synthetic ``Interrupted`` record so any future tail reader gets a
    clean end-of-stream rather than waiting forever.

    Returns the number of buffers sealed. Logs at info if any were
    found — a healthy startup is silent.

    Safe to call multiple times; already-terminated buffers are
    skipped. Safe to call on a non-existent directory; returns 0.
    """
    if not streams_root.is_dir():
        return 0
    sealed = 0
    for conv_dir in streams_root.iterdir():
        if not conv_dir.is_dir():
            continue
        for path in conv_dir.glob("turn_*.jsonl"):
            # Cheap check first: empty file means producer never even
            # got to its first append. Append a terminal anyway so
            # readers can finish.
            try:
                if latest_terminal_reason(path) is not None:
                    continue  # already cleanly closed
            except Exception:
                logger.debug("Could not inspect %s for terminal", path, exc_info=True)
                continue
            # Determine the next seq by counting records on disk.
            next_seq = sum(1 for _ in read_records(path))
            try:
                with path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps({
                        "seq": next_seq,
                        "ts": _now_iso(),
                        "type": "Interrupted",
                        "data": {"reason": "restart"},
                    }) + "\n")
                sealed += 1
            except OSError:
                logger.warning("Could not seal orphan buffer %s", path, exc_info=True)
    if sealed:
        logger.info("Sealed %d orphan turn buffer(s) on boot.", sealed)
    return sealed


def gc_old_buffers(streams_root: Path, max_age_days: int) -> int:
    """Phase 5 — delete turn buffer files older than ``max_age_days``.

    Walks ``streams_root/<conversation_id>/turn_*.jsonl`` and removes
    files whose mtime is older than the cutoff. Conversations whose
    every buffer file gets removed lose their (now empty) directory
    too. Best-effort: errors are logged, not raised.

    Returns the number of files deleted. The buffer dir is purely a
    UI replay log — the persisted conversation history (in
    ``episodes/`` + ``messages.json``) is the canonical record and
    is untouched.
    """
    if not streams_root.is_dir() or max_age_days <= 0:
        return 0
    import time as _time
    cutoff = _time.time() - max_age_days * 86400.0
    deleted = 0
    for conv_dir in list(streams_root.iterdir()):
        if not conv_dir.is_dir():
            continue
        for path in list(conv_dir.glob("turn_*.jsonl")):
            try:
                if path.stat().st_mtime >= cutoff:
                    continue
                path.unlink()
                deleted += 1
            except OSError:
                logger.debug("Could not GC buffer %s", path, exc_info=True)
        # Tidy up empty conversation directories so the streams tree
        # doesn't accumulate empty husks.
        try:
            if not any(conv_dir.iterdir()):
                conv_dir.rmdir()
        except OSError:
            pass
    if deleted:
        logger.info("GC swept %d old turn buffer(s).", deleted)
    return deleted


async def tail_buffer(
    writer: BufferedTurnWriter,
    *,
    from_seq: int = 0,
) -> "asyncio.AsyncIterator[TurnRecord]":
    """Yield records from a buffer starting at ``from_seq``, then live-tail.

    Order of operations on each loop iteration:

      1. Snapshot the writer's new-data event (BEFORE re-reading the
         file — see ``snapshot_new_data_event`` docstring).
      2. Read any records with ``seq > seen_seq`` from the file and
         yield them.
      3. If we've seen a terminal record, stop.
      4. If the writer is already done (terminal record written), stop.
      5. Otherwise, await the snapshotted event OR the done event,
         whichever fires first. Go back to step 1.

    Notes:
      - This generator never raises on consumer cancellation; the
        underlying writer is unaffected by readers coming and going.
      - Yielding a terminal record IS a yield — the caller decides
        whether to stop tailing or restart on a new turn.
    """
    seen_seq = from_seq - 1  # so seq >= from_seq passes the > check below

    while True:
        # Step 1: snapshot the event BEFORE reading the file.
        waiter = writer.snapshot_new_data_event()

        # Step 2: read new records.
        emitted_terminal = False
        for rec in read_records(writer.path, from_seq=seen_seq + 1):
            seen_seq = rec.seq
            yield rec
            if rec.is_terminal:
                emitted_terminal = True

        # Step 3/4: stop conditions.
        if emitted_terminal:
            return
        if writer.is_closed:
            # Writer closed since we last read but we missed the
            # terminal record (shouldn't happen — close() writes the
            # terminal before flipping the flag — but defense in depth).
            return

        # Step 5: wait for either new data or done.
        done_waiter = asyncio.create_task(writer.done.wait())
        data_waiter = asyncio.create_task(waiter.wait())
        try:
            await asyncio.wait(
                {done_waiter, data_waiter},
                return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            done_waiter.cancel()
            data_waiter.cancel()
