"""Smoke tests for the file-backed turn buffer (Phase 1).

These tests don't construct a full FastAPI server — they exercise
``BufferedTurnWriter`` + ``tail_buffer`` directly. The point is to
prove the bug fix's load-bearing property: the producer is decoupled
from any single consumer, and the buffer file is the durable handoff
between them.

Run with::

    python3 -m unittest server.tests.test_turn_buffer -v

(or with pytest if you've added it to the venv).
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


# Make ``anton_api.*`` importable when run from the repo root.
_THIS_DIR = Path(__file__).resolve().parent
_SERVER_DIR = _THIS_DIR.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))


from anton_api.turn_buffer import (  # noqa: E402
    BufferedTurnWriter,
    gc_old_buffers,
    read_records,
    seal_orphan_buffers,
    tail_buffer,
    turn_buffer_path,
    latest_terminal_reason,
)


class TurnBufferTests(unittest.IsolatedAsyncioTestCase):
    """Pin the contract: producer writes, multiple readers tail, no
    single reader's lifetime can starve the producer."""

    async def test_writer_appends_and_closes(self):
        with TemporaryDirectory() as td:
            path = Path(td) / "turn.jsonl"
            buf = BufferedTurnWriter(path)
            buf.append("TextDelta", {"text": "hello"})
            buf.append("TextDelta", {"text": " world"})
            buf.close("completed")

            recs = list(read_records(path))
            # 2 events + 1 terminal.
            self.assertEqual(len(recs), 3)
            self.assertEqual(recs[0].type, "TextDelta")
            self.assertEqual(recs[0].data["text"], "hello")
            self.assertEqual(recs[2].type, "Done")
            self.assertEqual(recs[2].data["reason"], "completed")
            self.assertTrue(recs[2].is_terminal)

    async def test_tail_yields_records_in_order_and_terminates(self):
        with TemporaryDirectory() as td:
            path = Path(td) / "turn.jsonl"
            buf = BufferedTurnWriter(path)

            async def produce():
                for i in range(5):
                    buf.append("TextDelta", {"text": f"chunk-{i}"})
                    await asyncio.sleep(0.005)
                buf.close("completed")

            producer = asyncio.create_task(produce())

            collected = []
            async for rec in tail_buffer(buf):
                collected.append((rec.type, rec.data))

            await producer
            self.assertEqual(len(collected), 6)  # 5 deltas + 1 Done
            self.assertEqual(collected[-1][0], "Done")
            self.assertEqual(
                [d["text"] for kind, d in collected[:5]],
                [f"chunk-{i}" for i in range(5)],
            )

    async def test_consumer_disconnect_does_not_stop_producer(self):
        """The whole reason for this rewrite. A reader cancels mid-tail
        (simulating the renderer closing its tab). The producer keeps
        writing. A NEW reader picks up everything from the start."""
        with TemporaryDirectory() as td:
            path = Path(td) / "turn.jsonl"
            buf = BufferedTurnWriter(path)

            async def produce():
                for i in range(10):
                    buf.append("TextDelta", {"text": f"chunk-{i}"})
                    await asyncio.sleep(0.005)
                buf.close("completed")

            producer = asyncio.create_task(produce())

            # Reader 1: gives up after seeing the first two records.
            r1_seen: list[str] = []
            r1_tail = tail_buffer(buf)
            async def reader_one():
                async for rec in r1_tail:
                    r1_seen.append(rec.type)
                    if len(r1_seen) >= 2:
                        break  # disconnect — generator is dropped

            await reader_one()

            # Producer should still be running.
            self.assertFalse(producer.done())

            # Reader 2 (fresh) reads the buffer to completion. Should
            # see ALL the records the producer ever wrote, regardless
            # of what reader 1 did.
            r2_seen: list[str] = []
            async for rec in tail_buffer(buf):
                r2_seen.append(rec.type)

            await producer
            self.assertEqual(len(r2_seen), 11)  # 10 deltas + Done
            self.assertEqual(r2_seen[-1], "Done")

    async def test_tail_replay_from_seq(self):
        """A returning client passes ``from_seq=N`` to skip the events
        it already has. This is the Phase 2 reconnect primitive — the
        tail call is the same shape."""
        with TemporaryDirectory() as td:
            path = Path(td) / "turn.jsonl"
            buf = BufferedTurnWriter(path)
            for i in range(5):
                buf.append("TextDelta", {"text": f"chunk-{i}"})
            buf.close("completed")

            seen = [r async for r in tail_buffer(buf, from_seq=3)]
            # Records at seq >= 3 are: chunk-3 (seq=3), chunk-4 (seq=4), Done (seq=5).
            self.assertEqual(len(seen), 3)
            self.assertEqual(seen[0].data["text"], "chunk-3")
            self.assertEqual(seen[-1].type, "Done")

    async def test_close_is_idempotent(self):
        with TemporaryDirectory() as td:
            path = Path(td) / "turn.jsonl"
            buf = BufferedTurnWriter(path)
            buf.append("TextDelta", {"text": "hi"})
            buf.close("completed")
            buf.close("completed")  # second close — must be a no-op
            recs = list(read_records(path))
            # Exactly one terminal record.
            terminals = [r for r in recs if r.is_terminal]
            self.assertEqual(len(terminals), 1)

    async def test_error_terminal_carries_message(self):
        with TemporaryDirectory() as td:
            path = Path(td) / "turn.jsonl"
            buf = BufferedTurnWriter(path)
            buf.append("Error", {"message": "boom"})
            buf.close("error")
            self.assertEqual(latest_terminal_reason(path), "error")

    async def test_seal_orphan_buffers_appends_interrupted(self):
        """Phase 4 — a buffer left open by a crash gets a synthetic
        Interrupted terminal on boot."""
        with TemporaryDirectory() as td:
            streams = Path(td)
            # Two buffers: one closed cleanly, one left open.
            clean = streams / "conv-clean" / "turn_000000.jsonl"
            orphan = streams / "conv-orphan" / "turn_000000.jsonl"
            cb = BufferedTurnWriter(clean)
            cb.append("TextDelta", {"text": "ok"})
            cb.close("completed")
            ob = BufferedTurnWriter(orphan)
            ob.append("TextDelta", {"text": "half"})
            # Don't close — simulates a crash.

            sealed = seal_orphan_buffers(streams)
            self.assertEqual(sealed, 1)
            # Re-running is a no-op (already sealed).
            self.assertEqual(seal_orphan_buffers(streams), 0)

            recs = list(read_records(orphan))
            self.assertEqual(recs[-1].type, "Interrupted")
            self.assertEqual(recs[-1].data.get("reason"), "restart")
            # The cleanly-closed buffer wasn't touched.
            self.assertEqual(latest_terminal_reason(clean), "completed")

    async def test_gc_old_buffers_removes_aged_files(self):
        """Phase 5 — old buffer files get swept; recent ones stay."""
        import os as _os
        import time as _time
        with TemporaryDirectory() as td:
            streams = Path(td)
            old = streams / "conv-old" / "turn_000000.jsonl"
            new = streams / "conv-new" / "turn_000000.jsonl"
            BufferedTurnWriter(old).close("completed")
            BufferedTurnWriter(new).close("completed")
            # Backdate the "old" file 40 days.
            old_ts = _time.time() - 40 * 86400
            _os.utime(old, (old_ts, old_ts))

            deleted = gc_old_buffers(streams, max_age_days=30)
            self.assertEqual(deleted, 1)
            self.assertFalse(old.exists())
            self.assertTrue(new.exists())
            # Empty conv-old directory got swept too.
            self.assertFalse(old.parent.exists())

    async def test_path_layout_uses_safe_segments(self):
        with TemporaryDirectory() as td:
            streams = Path(td) / "streams"
            # Try a conversation_id with chars that shouldn't make it
            # into a path. Should sanitize, not raise.
            p = turn_buffer_path(streams, "weird/../id", 7)
            self.assertTrue(str(p).startswith(str(streams)))
            self.assertNotIn("..", p.parts)
            self.assertEqual(p.name, "turn_000007.jsonl")


if __name__ == "__main__":
    unittest.main()
