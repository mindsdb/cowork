"""Process-global registry of in-flight turn buffers.

Phase 1 of the task-lifecycle rewrite. One ``TurnHandle`` per
(``conversation_id``, ``turn_id``). The handle owns:

  - the producer ``asyncio.Task`` driving anton-core's ``turn_stream``
  - the ``BufferedTurnWriter`` it writes into
  - the project name + filesystem path metadata

Lookup is by ``conversation_id`` — a conversation has at most one
in-flight turn at a time (the renderer-side message queue enforces
that). When a new turn starts on the same conversation, the previous
handle is moved aside (still readable by anyone holding a reference)
and a fresh one takes its place.

This module is intentionally small — the harder logic lives in
``turn_buffer.py`` (the JSONL writer + tail) and
``conversation_manager.py`` (what actually runs inside the producer
task). The registry's only job is "find me the in-flight buffer for
conversation X."
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .turn_buffer import BufferedTurnWriter


logger = logging.getLogger(__name__)


@dataclass
class TurnHandle:
    """One in-flight (or recently-finished) turn.

    Kept after the producer task completes so a returning client can
    still tail the buffer — they'll see the terminal record and exit
    cleanly. GC sweeps stale handles after a grace period (see
    ``StreamRegistry.gc_finished``).
    """

    conversation_id: str
    turn_id: int
    project: Optional[str]
    buffer: BufferedTurnWriter
    task: asyncio.Task
    # Wall-clock created-at, for GC ordering.
    created_at_monotonic: float = field(default_factory=lambda: 0.0)

    @property
    def is_running(self) -> bool:
        return not self.task.done()

    @property
    def buffer_path(self) -> Path:
        return self.buffer.path

    def cancel(self) -> bool:
        """Request cancellation of the producer task.

        Returns True if a cancel was issued (the task was still
        running), False if it had already completed. Idempotent.
        """
        if self.task.done():
            return False
        self.task.cancel()
        return True


class StreamRegistry:
    """Process-wide map of in-flight turns.

    Not thread-safe; the asyncio event loop is single-threaded, and
    every method that mutates ``_by_cid`` runs on the loop. If we
    ever need a multi-process server (we don't today), this becomes
    sqlite-backed and the in-memory shape goes away.
    """

    def __init__(self) -> None:
        self._by_cid: dict[str, TurnHandle] = {}
        self._lock = asyncio.Lock()

    async def start(
        self,
        *,
        conversation_id: str,
        turn_id: int,
        project: Optional[str],
        buffer: BufferedTurnWriter,
        producer_coro,
    ) -> TurnHandle:
        """Spawn a producer task wrapping ``producer_coro`` and register it.

        Caller is responsible for constructing ``buffer`` at the right
        on-disk path (we don't reach into the filesystem here — that's
        the conversation-manager's job, since it knows the project).

        If a previous handle exists for the same ``conversation_id``,
        it's left in place under a different key until the producer
        finishes. (The new turn always wins the primary slot; the old
        turn stays reachable by anyone who still has a TurnHandle
        reference.)
        """
        loop = asyncio.get_running_loop()
        async with self._lock:
            existing = self._by_cid.get(conversation_id)
            if existing is not None and existing.is_running:
                # A duplicate POST for an already-in-flight turn. The
                # renderer's message queue should prevent this, but be
                # defensive — return the existing handle so the new
                # request just tails along.
                logger.info(
                    "Duplicate turn start for conversation %s; returning "
                    "existing handle (turn %d).",
                    conversation_id, existing.turn_id,
                )
                return existing

            task = asyncio.create_task(
                producer_coro,
                name=f"turn[{conversation_id}/{turn_id}]",
            )
            handle = TurnHandle(
                conversation_id=conversation_id,
                turn_id=turn_id,
                project=project,
                buffer=buffer,
                task=task,
                created_at_monotonic=loop.time(),
            )
            self._by_cid[conversation_id] = handle
            return handle

    def get(self, conversation_id: str) -> Optional[TurnHandle]:
        """Return the current handle for *conversation_id*, if any.

        Includes recently-finished handles — they're useful for
        replay until GC sweeps them. Callers can check
        ``handle.is_running`` to distinguish.
        """
        return self._by_cid.get(conversation_id)

    async def cancel(self, conversation_id: str) -> bool:
        """Cancel the in-flight turn for *conversation_id*, if any.

        Returns True if a task was cancelled, False if there was
        nothing in flight. Phase 3 (``/cancel`` endpoint) is the
        primary caller; tests use this too.
        """
        handle = self._by_cid.get(conversation_id)
        if handle is None:
            return False
        return handle.cancel()

    async def gc_finished(self, max_age_seconds: float = 300.0) -> int:
        """Drop handles whose producer finished more than
        *max_age_seconds* ago. Returns the number dropped.

        The buffer file stays on disk — we're only freeing the
        in-memory TurnHandle. A late reader can still tail the file
        directly via the buffer path; just not via the registry.
        """
        loop = asyncio.get_running_loop()
        now = loop.time()
        dropped = 0
        async with self._lock:
            stale: list[str] = []
            for cid, handle in self._by_cid.items():
                if handle.is_running:
                    continue
                if now - handle.created_at_monotonic > max_age_seconds:
                    stale.append(cid)
            for cid in stale:
                self._by_cid.pop(cid, None)
                dropped += 1
        return dropped

    def in_flight_count(self) -> int:
        """How many handles are currently producing. Used for tests
        and the lightweight in-flight-status endpoint."""
        return sum(1 for h in self._by_cid.values() if h.is_running)


# Single global instance — one registry per server process. Imported
# by ``conversation_manager`` (the only writer) and by the
# ``/responses`` route (the reader side).
registry: StreamRegistry = StreamRegistry()
