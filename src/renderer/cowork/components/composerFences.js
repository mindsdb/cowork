// Column-0 backtick fences only: open with 3+ backticks and close with at least the opener’s count.
// Tilde and indented fences are unsupported.
// The parser retains the full info string as lang; auto-expansion requires a single [a-zA-Z0-9_+-]
// language tag.

const OPEN_RE = /^(`{3,})([^\n]*)$/;
const CLOSE_RE = /^(`{3,})\s*$/;

/**
 * Parse `text` into a list of fence-line descriptors plus the set of
 * still-unmatched openers. Walks left-to-right with a stack: an opener
 * pushes; a same-or-longer backtick run pops. Content lines inside an
 * open fence — including shorter ``` runs and info-string lines — are
 * ignored.
 *
 * Each fence descriptor:
 *   - char       : byte offset of the fence line in `text`
 *   - end        : char + line.length (position right after last char
 *                  of the fence line, BEFORE its trailing newline)
 *   - len        : number of backticks in the fence run
 *   - isOpening  : true for openers, false for closers
 *   - lang       : opener-only, info-string trimmed (may be '')
 *   - pairedWith : cross-reference set when paired (opener<->closer)
 */
export function parseFences(text) {
  const fences = [];
  const stack = [];
  const lines = text.split('\n');
  let charPos = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (stack.length) {
      const close = CLOSE_RE.exec(line);
      const opener = stack[stack.length - 1];
      if (close && close[1].length >= opener.len) {
        const closer = {
          char: charPos,
          end: charPos + line.length,
          len: close[1].length,
          isOpening: false,
        };
        opener.pairedWith = closer;
        closer.pairedWith = opener;
        fences.push(closer);
        stack.pop();
      }
    } else {
      const open = OPEN_RE.exec(line);
      if (open) {
        const opener = {
          char: charPos,
          end: charPos + line.length,
          len: open[1].length,
          lang: open[2].trim(),
          isOpening: true,
        };
        fences.push(opener);
        stack.push(opener);
      }
    }
    charPos += line.length + 1;
  }
  return { fences, unmatched: stack };
}

/**
 * Return a paired fence and content bounds for a caret inside its content, or null. Bounds exclude
 * both fence lines
 * and extend from after the opener’s newline to before the closer’s leading newline.
 */
export function fenceCtxAt(text, pos) {
  return fenceCtxAtParsed(parseFences(text).fences, pos);
}

/** Reuse a parsed fence list when the caller already has one. */
export function fenceCtxAtParsed(fences, pos) {
  for (const f of fences) {
    if (!f.isOpening || !f.pairedWith) continue;
    const open = f;
    const close = f.pairedWith;
    const contentStart = open.end + 1;
    const contentEnd = Math.max(close.char - 1, contentStart);
    if (pos >= contentStart && pos <= contentEnd) {
      return { open, close, contentStart, contentEnd };
    }
  }
  return null;
}

/**
 * Check only preceding lines: future unbalanced fences must not prevent auto-expanding a new block
 * above them.
 */
export function stackEmptyBeforeLine(text, lineStart) {
  return parseFences(text.slice(0, lineStart)).unmatched.length === 0;
}

/**
 * Auto-expand only a clean single language tag matching [a-zA-Z0-9_+-]; return { len, lang } or
 * null.
 */
export function parseOpenerLine(line) {
  const m = /^(`{3,})([a-zA-Z0-9_+-]*)\s*$/.exec(line);
  if (!m) return null;
  return { len: m[1].length, lang: m[2] };
}
