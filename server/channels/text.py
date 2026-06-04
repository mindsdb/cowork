"""Outbound text splitting honoring per-platform character limits.

Slack messages have a soft 3,000-char readability ceiling and a 40,000-char hard
cap; WhatsApp text is capped at 4,096; Telegram at 4,096; Discord at 2,000.
Without splitting, adapters silently truncate mid-response — splitting on
paragraph boundaries preserves Markdown structure when possible.

The algorithm matches nanoclaw's ``splitForLimit`` for cross-tool consistency.
"""
from __future__ import annotations


def _utf16_len(s: str) -> int:
    """Length of ``s`` in UTF-16 code units — what Telegram/WhatsApp count."""
    return len(s.encode("utf-16-le")) // 2


def split_for_limit(text: str, limit: int) -> list[str]:
    """Split ``text`` into chunks no larger than ``limit`` chars.

    Preference order: blank-line break, then newline, then space, then a hard
    char cut as a last resort. Each chunk has whitespace trimmed at the seam.

    A fenced code block that straddles a chunk boundary will render as two
    independent blocks on the receiver — same behavior as manually re-opening
    the fence; we don't try to balance fences here.

    The primary split measures Python characters (code points), but Telegram
    and WhatsApp count UTF-16 code units — emoji and other astral-plane chars
    count as 2 there, so a ``len()``-sized chunk can still exceed the wire
    limit. Any such chunk is re-split with a halved limit (worst case every
    char is astral, i.e. exactly 2 units each), so emoji-dense agent replies
    never get rejected by the platform.
    """
    if limit <= 0:
        raise ValueError("limit must be positive")
    chunks = _split_by_codepoints(text, limit)

    # UTF-16 safety pass — re-split only the (rare) chunks that are over
    # the limit in code units; everything else passes through untouched.
    safe: list[str] = []
    for chunk in chunks:
        if _utf16_len(chunk) <= limit:
            safe.append(chunk)
        else:
            safe.extend(_split_by_codepoints(chunk, max(limit // 2, 1)))
    return safe


def _split_by_codepoints(text: str, limit: int) -> list[str]:
    """The core splitter, measuring in Python characters."""
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining.rfind("\n\n", 0, limit)
        if cut <= 0:
            cut = remaining.rfind("\n", 0, limit)
        if cut <= 0:
            cut = remaining.rfind(" ", 0, limit)
        if cut <= 0:
            cut = limit
        chunk = remaining[:cut].rstrip()
        if chunk:
            chunks.append(chunk)
        remaining = remaining[cut:].lstrip()

    if remaining:
        chunks.append(remaining)
    return chunks
