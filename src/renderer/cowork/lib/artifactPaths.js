function textValue(value) {
  return value == null ? '' : String(value).trim();
}

export function isAbsoluteArtifactPath(value) {
  const text = textValue(value);
  return text.startsWith('/')
    || /^[a-zA-Z]:[\\/]/.test(text)
    || text.startsWith('\\\\');
}

function pathSeparator(basePath) {
  const text = textValue(basePath);
  return text.includes('\\') && !text.includes('/') ? '\\' : '/';
}

function trimTrailingSeparators(value) {
  return textValue(value).replace(/[\\/]+$/, '');
}

function joinProjectPath(basePath, parts) {
  const sep = pathSeparator(basePath);
  const base = trimTrailingSeparators(basePath);
  const cleaned = parts
    .flatMap((part) => textValue(part).replace(/\\/g, '/').split('/'))
    .filter(Boolean);
  return [base, ...cleaned].join(sep);
}

/*
 * What the user sees under the card title (ENG-2171). Stored paths carry
 * storage detail the user never chose and cannot act on, such as
 * `conversations/<uuid>/.anton/artifacts/deck/index.html`. Show the part below
 * the artifacts or output folder, or the file name for any other `.anton`
 * internal. Display only: `canonicalPath` stays the full path every action uses.
 */
const AGENT_OUTPUT_DIRS = new Set(['artifacts', 'output']);

export function friendlyArtifactDisplayPath(value) {
  const text = textValue(value);
  const parts = text.replace(/\\/g, '/').split('/').filter(Boolean);
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const segment = parts[i];
    if (segment !== '.anton' && !(segment === 'anton' && i === 0)) continue;
    const below = parts.slice(i + 1);
    if (below.length > 1 && AGENT_OUTPUT_DIRS.has(below[0])) return below.slice(1).join('/');
    return parts[parts.length - 1];
  }
  return text;
}

function relativeToProject(canonicalPath, projectPath) {
  const canonical = textValue(canonicalPath);
  const base = trimTrailingSeparators(projectPath);
  if (!canonical || !base) return '';
  const canonicalCmp = canonical.replace(/\\/g, '/');
  const baseCmp = base.replace(/\\/g, '/');
  if (canonicalCmp === baseCmp) return '';
  if (!canonicalCmp.startsWith(`${baseCmp}/`)) return '';
  return canonicalCmp.slice(baseCmp.length + 1);
}

export function normalizeArtifactPath(rawPath, projectPath) {
  const raw = textValue(rawPath);
  const base = textValue(projectPath);
  if (!raw) {
    return {
      rawPath: raw,
      canonicalPath: '',
      displayPath: '',
      actionDisabledReason: 'This artifact did not include a file path.',
    };
  }

  if (isAbsoluteArtifactPath(raw)) {
    return {
      rawPath: raw,
      canonicalPath: raw,
      displayPath: friendlyArtifactDisplayPath(relativeToProject(raw, base) || raw),
      actionDisabledReason: '',
    };
  }

  if (!base) {
    return {
      rawPath: raw,
      canonicalPath: '',
      displayPath: friendlyArtifactDisplayPath(raw),
      actionDisabledReason: 'This artifact path is relative, but the task has no project folder.',
    };
  }

  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.includes('.') || parts.includes('..')) {
    return {
      rawPath: raw,
      canonicalPath: '',
      displayPath: friendlyArtifactDisplayPath(raw),
      actionDisabledReason: 'This artifact path points outside the project folder.',
    };
  }

  let canonicalPath;
  if (normalized.startsWith('.anton/output/')) {
    canonicalPath = joinProjectPath(base, ['.anton', 'output', normalized.slice('.anton/output/'.length)]);
  } else if (normalized.startsWith('anton/output/')) {
    // Compatibility shim for streamed display paths that omit the
    // leading dot. Actions still target the real `.anton/output` dir.
    canonicalPath = joinProjectPath(base, ['.anton', 'output', normalized.slice('anton/output/'.length)]);
  } else {
    canonicalPath = joinProjectPath(base, [normalized]);
  }

  return {
    rawPath: raw,
    canonicalPath,
    displayPath: friendlyArtifactDisplayPath(raw),
    actionDisabledReason: '',
  };
}

export function normalizeArtifactRecord(artifact, projectPath) {
  const rawPath = artifact?.canonicalPath || artifact?.file_path || artifact?.path || '';
  const normalized = normalizeArtifactPath(rawPath, projectPath);
  return {
    ...artifact,
    ...normalized,
    path: normalized.canonicalPath || rawPath,
    file_path: normalized.canonicalPath || rawPath,
  };
}
