// Composer fence-line parser. Pure functions, no React imports — so this
// module is unit-testable on its own once a renderer test runner lands.
//
// Strict mode: only column-0 backtick fences. Supported runs are 3+
// backticks; a closing fence must be at least as long as the opener it
// pairs with (so a 4-backtick block can embed plain ``` as content
// without prematurely closing).
//
// Deliberately NOT supported (yet — open issues if you need them):
//   - Tilde fences (~~~). CommonMark allows; we don't.
//   - Indented fences (1–3 leading spaces). CommonMark allows; we don't.
//   - Info-string parsing beyond a single language tag. We grab the rest
//     of the line as `lang` but `parseOpenerLine` (used by the auto-
//     expand trigger) only accepts a clean [a-zA-Z0-9_+-] tag so weird
//     inputs like "```python lots of stuff" don't trigger auto-expand.

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
      // Inside a fence — only a matching-or-longer closer is special.
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
      // else: content line. Skipped — we only track fence lines.
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
 * Caret-vs-fence context. Returns the matched opener/closer and the
 * content-region bounds when `pos` sits anywhere inside a paired
 * block's content region, or null otherwise.
 *
 * The content region is: from the char right after the opener line's
 * trailing newline through the char right before the closer line's
 * leading newline. Caret on a fence LINE itself is NOT inside.
 */
export function fenceCtxAt(text, pos) {
  return fenceCtxAtParsed(parseFences(text).fences, pos);
}

/**
 * Same as `fenceCtxAt` but accepts a pre-parsed fence list so callers
 * that have already invoked `parseFences(text)` once per value (e.g.
 * the composer's memoized fences) can reuse it instead of reparsing.
 */
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
 * True when the parser's stack would be empty immediately BEFORE the
 * line that starts at `lineStart`. This is the auto-expand precondition
 * we care about: the line about to be typed isn't sitting inside or
 * closing a prior unbalanced fence. Correctly handles the rare edge
 * case of inserting a new ``` line ABOVE existing unbalanced fences.
 */
export function stackEmptyBeforeLine(text, lineStart) {
  return parseFences(text.slice(0, lineStart)).unmatched.length === 0;
}

/**
 * Match a line that's eligible for auto-expansion as an opener.
 * Stricter than OPEN_RE — only a clean info-string of [a-zA-Z0-9_+-]
 * (no whitespace mid-string) so an arbitrary info string doesn't
 * trigger the trigger. Returns { len, lang } or null.
 */
export function parseOpenerLine(line) {
  const m = /^(`{3,})([a-zA-Z0-9_+-]*)\s*$/.exec(line);
  if (!m) return null;
  return { len: m[1].length, lang: m[2] };
}
