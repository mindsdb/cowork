// Source-mode highlight overlay for the composer textarea.
//
// The technique: a transparent `<textarea>` sits on top of a
// pixel-aligned styled div that mirrors the textarea content with
// inline-code chips, fence-body washes, and accent-coloured fence
// markers. Selection and caret stay on the textarea (the only thing
// you can see *through* the transparent text layer), so input, copy/
// paste, undo, IME, screen readers, and a11y all work like a normal
// textarea — we only add the visual chrome.
//
// CRITICAL constraint: nothing in this file (or its CSS hooks) is
// allowed to change character widths. The overlay must wrap at exactly
// the same points the textarea does. That means:
//   - background-color, color, box-shadow: fine
//   - padding, margin, border, font-weight, font-style: forbidden on
//     anything that holds text (use box-shadow for chip borders, keep
//     weight/style unchanged from the textarea).
//   - The trailing-newline phantom is a `​` so text + overlay end
//     at the same logical position when value ends with '\n'.

import { parseFences } from './composerFences';

/**
 * Walk `text` and split it into typed segments. Order and total length
 * exactly match `text` so the overlay aligns char-for-char with the
 * underlying textarea.
 */
export function highlightSegments(text) {
  if (!text) return [];
  const out = [];
  const { fences } = parseFences(text);
  let pos = 0;
  let i = 0;
  while (i < fences.length) {
    const f = fences[i];
    if (f.char > pos) {
      _pushPlain(out, text.slice(pos, f.char));
    }
    if (f.isOpening && f.pairedWith) {
      const close = f.pairedWith;
      out.push({ kind: 'fence-marker', text: text.slice(f.char, f.end) });
      // Body spans from end of opener line through the char right
      // before the closer line. Includes the trailing \n after the
      // opener and the \n before the closer so the visual wash covers
      // both gutters.
      out.push({ kind: 'fence-body', text: text.slice(f.end, close.char) });
      out.push({ kind: 'fence-marker', text: text.slice(close.char, close.end) });
      pos = close.end;
      // Advance past the closer in the fences array.
      const closeIdx = fences.indexOf(close);
      i = closeIdx + 1;
    } else {
      // Orphan opener with no matching close (or stray closer with no
      // opener). Render the line as a marker; content beyond it stays
      // plain.
      out.push({ kind: 'fence-marker', text: text.slice(f.char, f.end) });
      pos = f.end;
      i += 1;
    }
  }
  if (pos < text.length) {
    _pushPlain(out, text.slice(pos));
  }
  return out;
}

/**
 * Push a stretch of non-fenced text, breaking out single-backtick
 * inline spans into their own chip segments. Plain prose is pushed
 * as a single 'plain' segment.
 */
function _pushPlain(out, text) {
  if (!text) return;
  const re = /`([^`\n]+)`/g;
  let pos = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > pos) {
      out.push({ kind: 'plain', text: text.slice(pos, m.index) });
    }
    out.push({ kind: 'inline-code', text: m[0] });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) {
    out.push({ kind: 'plain', text: text.slice(pos) });
  }
}

/**
 * Render the styled overlay. Caller is responsible for sizing/font
 * via the wrapper class (see `.composer-textarea-overlay` in
 * globals.css) — this component only owns the segment tree.
 */
export function HighlightOverlay({ text }) {
  const segments = highlightSegments(text);
  return (
    <>
      {segments.map((seg, i) => (
        seg.kind === 'plain'
          ? <span key={i}>{seg.text}</span>
          : <span key={i} className={`overlay-${seg.kind}`}>{seg.text}</span>
      ))}
      {/* Phantom zero-width char ensures the overlay's last line matches
          the textarea's empty-trailing-line height when the value ends
          with a newline. */}
      {text && text.endsWith('\n') ? '​' : null}
    </>
  );
}
