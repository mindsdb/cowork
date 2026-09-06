// Try strict JSON before repairing common model-generated syntax. Return the original parse error
// if recovery fails.
// Markdown preprocessing separately repairs opening fences glued to prose.

export function parseFormSpec(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { spec: null, error: 'empty spec' };
  }

  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { spec: parsed, error: null };
    }
    return { spec: null, error: 'Spec must be a JSON object (got ' + (Array.isArray(parsed) ? 'array' : typeof parsed) + ')' };
  } catch (strictErr) {
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

// Extract the last full form fence for live onDone handling; MarkdownCode treats already-complete
// mounts
// as historical and suppresses dispatch. Ignore form patches, which update an existing panel.
// Returns { spec, error, found }; found is false when no full-form fence exists.
export function extractFormSpec(markdown) {
  if (typeof markdown !== 'string' || !markdown) {
    return { spec: null, error: null, found: false };
  }
  // `[ \t]*\r?\n` after the info string means `data-vault-form-patch`
  // won't match (its `-patch` suffix isn't whitespace/newline).
  const re = /```data-vault-form[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;
  let m;
  let lastBody = null;
  while ((m = re.exec(markdown)) !== null) lastBody = m[1];
  if (lastBody == null) return { spec: null, error: null, found: false };
  const { spec, error } = parseFormSpec(lastBody);
  return { spec, error, found: true };
}

// Fix common LLM JSON errors in order: strip comments before removing trailing commas.
function _looseClean(s) {
  let out = String(s);

  // Remove a nested code fence accidentally included in the block body.
  out = out.replace(/^\s*```(?:json|data-vault-form|js|javascript)?\s*\n/, '');
  out = out.replace(/\n\s*```\s*$/, '');

  out = out
    .replace(/[‘’‚‛′‵]/g, "'")
    .replace(/[“”„‟″‶]/g, '"');

  out = _stripCommentsOutsideStrings(out);

  // Normalize single-quoted JSON values only where recognized; leave embedded double quotes alone
  // to avoid invalid escaping.
  out = out.replace(/(:\s*|,\s*|\[\s*)'((?:[^'\\]|\\.)*)'/g, (_, prefix, val) => {
    if (val.includes('"')) return `${prefix}'${val}'`;
    return `${prefix}"${val}"`;
  });

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
      while (i < s.length && s[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
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
