// Tolerant JSON parser for `data-vault-form` blocks.
//
// (Note: the markdown layer also pre-normalises the fenced block so
// that an opening ```data-vault-form glued to the end of a sentence
// becomes a real fenced code block instead of inline code.)
//
// LLMs are loose with JSON — trailing commas, smart quotes, single
// quotes, JS-style comments, code-fence prefixes that bleed into
// the body. Strict `JSON.parse` rejects all of these even though
// the user's intent is unambiguous. We try strict first, then a
// series of best-effort cleanups, and finally give up with the
// original error message so the UI can surface it for retry.
//
// Returns { spec, error }:
//   spec  — parsed object on success, null on failure
//   error — null on success, error message string on failure

export function parseFormSpec(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { spec: null, error: 'empty spec' };
  }

  // Step 1 — strict.
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { spec: parsed, error: null };
    }
    return { spec: null, error: 'Spec must be a JSON object (got ' + (Array.isArray(parsed) ? 'array' : typeof parsed) + ')' };
  } catch (strictErr) {
    // Step 2 — tolerant pass.
    const cleaned = _looseClean(rawText);
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { spec: parsed, error: null };
      }
    } catch {
      // fall through to error reporting
    }
    return {
      spec: null,
      error: (strictErr && strictErr.message) || String(strictErr),
    };
  }
}

// Apply a series of cheap, deterministic fixups for common LLM
// mistakes. Order matters — stripping comments before fixing
// trailing commas, etc.
function _looseClean(s) {
  let out = String(s);

  // Strip a stray fenced-code preamble if the LLM included it inside
  // the block content (e.g. "```json\n{...}\n```").
  out = out.replace(/^\s*```(?:json|data-vault-form|js|javascript)?\s*\n/, '');
  out = out.replace(/\n\s*```\s*$/, '');

  // Normalise smart quotes → ASCII.
  out = out
    .replace(/[‘’‚‛′‵]/g, "'")
    .replace(/[“”„‟″‶]/g, '"');

  // Strip JS-style comments. Conservative — only outside strings.
  out = _stripCommentsOutsideStrings(out);

  // Single-quoted string values → double-quoted. Only when clearly
  // a JSON value (after `:` or inside an array). Conservative: skip
  // the swap if the content already contains a double quote (would
  // need escaping). Picks up the common cases without breaking JSON
  // strings that legitimately contain apostrophes.
  out = out.replace(/(:\s*|,\s*|\[\s*)'((?:[^'\\]|\\.)*)'/g, (_, prefix, val) => {
    if (val.includes('"')) return `${prefix}'${val}'`;
    return `${prefix}"${val}"`;
  });

  // Trailing commas before `}` or `]`.
  out = out.replace(/,(\s*[}\]])/g, '$1');

  return out;
}

// Tiny string-aware comment stripper. Tracks string boundaries so
// we don't accidentally strip URLs / regexes / arbitrary `//` runs
// inside a JSON string value.
function _stripCommentsOutsideStrings(s) {
  let out = '';
  let i = 0;
  let inString = false;
  let stringChar = '';
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < s.length) {
        out += s[i + 1];
        i += 2;
        continue;
      }
      if (c === stringChar) {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      // Line comment — skip to newline.
      while (i < s.length && s[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      // Block comment — skip to */.
      i += 2;
      while (i < s.length - 1 && !(s[i] === '*' && s[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
