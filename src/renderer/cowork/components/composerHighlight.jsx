// Mirror a transparent textarea with styled segments while retaining its native editing and
// accessibility behavior.
// Character widths must stay identical so both layers wrap together: use color, background and
// box-shadow, never
// text padding, margins, borders, font-weight or font-style. Use a trailing zero-width space when
// text ends in a newline.

import { parseFences } from './composerFences';

/**
 * Segment order and total length must exactly match the textarea text to preserve overlay
 * alignment.
 */
export function highlightSegments(text, mentionNames) {
  if (!text) return [];
  const out = [];
  const { fences } = parseFences(text);
  let pos = 0;
  let i = 0;
  while (i < fences.length) {
    const f = fences[i];
    if (f.char > pos) {
      _pushPlain(out, text.slice(pos, f.char), mentionNames);
    }
    if (f.isOpening && f.pairedWith) {
      const close = f.pairedWith;
      out.push({ kind: 'fence-marker', text: text.slice(f.char, f.end) });
      // Include the newlines beside both fences so the body wash covers both gutters.
      out.push({ kind: 'fence-body', text: text.slice(f.end, close.char) });
      out.push({ kind: 'fence-marker', text: text.slice(close.char, close.end) });
      pos = close.end;
      const closeIdx = fences.indexOf(close);
      i = closeIdx + 1;
    } else {
      // Unpaired fence lines remain markers; following content stays plain.
      out.push({ kind: 'fence-marker', text: text.slice(f.char, f.end) });
      pos = f.end;
      i += 1;
    }
  }
  if (pos < text.length) {
    _pushPlain(out, text.slice(pos), mentionNames);
  }
  return out;
}

function _pushPlain(out, text, mentionNames) {
  if (!text) return;
  const re = /`([^`\n]+)`/g;
  let pos = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > pos) {
      _pushProse(out, text.slice(pos, m.index), mentionNames);
    }
    out.push({ kind: 'inline-code', text: m[0] });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) {
    _pushProse(out, text.slice(pos), mentionNames);
  }
}

/**
 * Highlight only known /skill names at word boundaries, avoiding paths and arbitrary slashes.
 * Preserve all segment text verbatim for alignment.
 */
function _pushProse(out, text, mentionNames) {
  if (!text) return;
  if (!mentionNames || mentionNames.size === 0) {
    out.push({ kind: 'plain', text });
    return;
  }
  const re = /(^|\s)\/([\w-]+)/g;
  let pos = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!mentionNames.has(m[2])) continue;
    const tokenStart = m.index + m[1].length; // index of "/"
    if (tokenStart > pos) {
      out.push({ kind: 'plain', text: text.slice(pos, tokenStart) });
    }
    out.push({ kind: 'slash-mention', text: `/${m[2]}` });
    pos = tokenStart + m[2].length + 1;
  }
  if (pos < text.length) {
    out.push({ kind: 'plain', text: text.slice(pos) });
  }
}

/** The wrapper owns matching textarea sizing and font; this component renders the segments. */
export function HighlightOverlay({ text, mentionNames }) {
  const segments = highlightSegments(text, mentionNames);
  return (
    <>
      {segments.map((seg, i) => (
        seg.kind === 'plain'
          ? <span key={i}>{seg.text}</span>
          : <span key={i} className={`overlay-${seg.kind}`}>{seg.text}</span>
      ))}
      {/* Keep trailing-line height aligned with the textarea. */}
      {text && text.endsWith('\n') ? '​' : null}
    </>
  );
}
