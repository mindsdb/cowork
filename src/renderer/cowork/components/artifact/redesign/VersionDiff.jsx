// VersionDiff.jsx — makes "Compare" actually SHOW the differences.
//
// The redesign's "Compare" action used to just preview the older version on the
// canvas; it never showed what changed. This component fetches the *content* of
// two versions (the picked version + the current/another version) via
// `previewArtifact(path, { versionId })`, computes a readable line-level diff in
// the browser, and renders it as a centered modal over the workspace.
//
//   red   (--diff-del)  → lines removed from the "from" version
//   green (--diff-add)  → lines added in the "to" version
//   dim                 → unchanged context (long runs collapse to a divider)
//
// WHY a client-side line diff and not the backend /diff endpoint:
//   The backend DOES expose GET /artifacts/{id}/diff (api.js → fetchArtifactChanges),
//   but it returns a *checkpoint manifest* diff: per-file status + a server-side
//   `unified_diff` keyed by snapshot paths. That contract is keyed off checkpoint
//   ids, can omit per-file text (only present for kind="text"), and doesn't line
//   up cleanly with the single rendered "current" content the workspace shows.
//   The data the workspace already trusts for a version is `previewArtifact`'s
//   raw content. Diffing those two payloads is exact, always-available, and needs
//   no extra endpoint round-trip or id-translation.
//
// House rules: React 19 hooks, no new deps, inline styles + CSS vars. Self-contained:
// if no `previewArtifact` prop is injected, a built-in mock resolves so it renders
// standalone in a gallery/storybook.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { previewArtifact as apiPreviewArtifact } from '../../../api';

// ── Limits ────────────────────────────────────────────────────────────────────
// Cap total rendered rows so a 200k-line file can't lock the main thread. The
// diff is still computed over the full text; only the *rendered* output is capped.
const MAX_RENDER_ROWS = 4000;
// Unchanged runs longer than this collapse into a "… N unchanged lines …" divider,
// keeping CONTEXT lines of breathing room on each side of a change.
const CONTEXT = 3;
const COLLAPSE_THRESHOLD = CONTEXT * 2 + 2;
// Per-side character cap before we refuse to diff (keeps the LCS table bounded).
const MAX_DIFF_CHARS = 1_500_000;

// ── Line-level diff (LCS over lines) ────────────────────────────────────────────
// Classic longest-common-subsequence row diff. We hash each line to an integer id
// first so the inner comparison is integer-equality (fast) rather than string
// compare, and the LCS table is Int32 to keep memory tight on large files.
function splitLines(str) {
  // Normalize newlines, then split. A trailing newline shouldn't create a phantom
  // empty final line in the diff.
  const text = String(str ?? '').replace(/\r\n?/g, '\n');
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Returns ops: array of { type:'eq'|'del'|'ins', text, aLine, bLine }.
// aLine/bLine are 1-based source line numbers (null on the side that lacks it).
function diffLines(oldStr, newStr) {
  const a = splitLines(oldStr);
  const b = splitLines(newStr);
  const n = a.length;
  const m = b.length;

  // Intern lines → integer ids so the LCS inner loop compares ints.
  const ids = new Map();
  const intern = (s) => {
    let id = ids.get(s);
    if (id === undefined) { id = ids.size; ids.set(s, id); }
    return id;
  };
  const ai = new Int32Array(n);
  const bi = new Int32Array(m);
  for (let i = 0; i < n; i++) ai[i] = intern(a[i]);
  for (let j = 0; j < m; j++) bi[j] = intern(b[j]);

  // LCS length table, filled bottom-up. dp has (n+1)*(m+1) cells.
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const rowBase = i * width;
    const nextBase = (i + 1) * width;
    for (let j = m - 1; j >= 0; j--) {
      dp[rowBase + j] = ai[i] === bi[j]
        ? dp[nextBase + (j + 1)] + 1
        : Math.max(dp[nextBase + j], dp[rowBase + (j + 1)]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ai[i] === bi[j]) {
      ops.push({ type: 'eq', text: a[i], aLine: i + 1, bLine: j + 1 });
      i++; j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      ops.push({ type: 'del', text: a[i], aLine: i + 1, bLine: null });
      i++;
    } else {
      ops.push({ type: 'ins', text: b[j], aLine: null, bLine: j + 1 });
      j++;
    }
  }
  while (i < n) { ops.push({ type: 'del', text: a[i], aLine: i + 1, bLine: null }); i++; }
  while (j < m) { ops.push({ type: 'ins', text: b[j], aLine: null, bLine: j + 1 }); j++; }
  return ops;
}

// Collapse long unchanged runs into a single { type:'gap', count } row, keeping
// CONTEXT lines on each side. Also returns added/removed tallies for the header.
function buildRows(ops) {
  const rows = [];
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'ins') added++;
    else if (op.type === 'del') removed++;
  }

  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type !== 'eq') { rows.push(op); i++; continue; }
    // Gather the full unchanged run [i, j).
    let j = i;
    while (j < ops.length && ops[j].type === 'eq') j++;
    const runLen = j - i;
    const atStart = i === 0;
    const atEnd = j === ops.length;
    if (runLen > COLLAPSE_THRESHOLD) {
      const head = atStart ? 0 : CONTEXT;
      const tail = atEnd ? 0 : CONTEXT;
      for (let k = 0; k < head; k++) rows.push(ops[i + k]);
      rows.push({ type: 'gap', count: runLen - head - tail });
      for (let k = tail; k > 0; k--) rows.push(ops[j - k]);
    } else {
      for (let k = i; k < j; k++) rows.push(ops[k]);
    }
    i = j;
  }
  return { rows, added, removed };
}

// ── Default (mock) content so the component renders standalone ──────────────────
const MOCK_BY_ID = {
  'mock-old': `# Quarterly Report
Revenue grew steadily this quarter.
We onboarded several new teams.
Costs were roughly flat.
Outlook: cautiously optimistic.
Thanks for reading.`,
  'mock-current': `# Quarterly Report
Revenue grew 24% this quarter — our best yet.
We onboarded twelve new teams across three regions.
Costs were roughly flat.
Margins improved on the back of automation.
Outlook: strongly optimistic heading into Q3.
Thanks for reading.`,
};

function mockPreview(_path, { versionId } = {}) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ content: MOCK_BY_ID[versionId] ?? MOCK_BY_ID['mock-current'] });
    }, 280);
  });
}

// Pull the raw text out of previewArtifact's response, tolerating a few shapes.
function contentOf(res) {
  if (res == null) return '';
  if (typeof res === 'string') return res;
  if (typeof res.content === 'string') return res.content;
  if (typeof res.text === 'string') return res.text;
  if (typeof res.html === 'string') return res.html;
  if (typeof res.body === 'string') return res.body;
  return '';
}

// ── Row palette (matches the redesign diff tokens) ──────────────────────────────
const ADD_BG = 'var(--diff-add, rgba(74,222,128,.16))';
const DEL_BG = 'var(--diff-del, rgba(248,113,113,.14))';
const ADD_FG = '#86efac';
const DEL_FG = '#fca5a5';
const GUTTER = 'var(--ink-4, #5b6066)';

function Row({ op }) {
  if (op.type === 'gap') {
    return (
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 12px', color: 'var(--ink-4, #5b6066)',
          fontSize: 11, letterSpacing: '0.02em', userSelect: 'none',
          background: 'var(--surface-2, rgba(255,255,255,.02))',
          borderTop: '1px solid var(--line, #23262b)',
          borderBottom: '1px solid var(--line, #23262b)',
        }}
      >
        <span style={{ flex: 1, height: 1, background: 'var(--line, #23262b)' }} />
        {`… ${op.count} unchanged line${op.count === 1 ? '' : 's'} …`}
        <span style={{ flex: 1, height: 1, background: 'var(--line, #23262b)' }} />
      </div>
    );
  }

  const isAdd = op.type === 'ins';
  const isDel = op.type === 'del';
  const sign = isAdd ? '+' : isDel ? '-' : ' ';
  const bg = isAdd ? ADD_BG : isDel ? DEL_BG : 'transparent';
  const fg = isAdd ? ADD_FG : isDel ? DEL_FG : 'var(--ink-2, #c7ccd1)';

  return (
    <div style={{ display: 'flex', background: bg, minWidth: 'max-content' }}>
      {/* line-number gutter: old | new */}
      <span style={gutterStyle}>{op.aLine ?? ''}</span>
      <span style={gutterStyle}>{op.bLine ?? ''}</span>
      <span
        aria-hidden="true"
        style={{
          width: 16, flexShrink: 0, textAlign: 'center', userSelect: 'none',
          color: isAdd ? ADD_FG : isDel ? DEL_FG : 'transparent', fontWeight: 600,
        }}
      >{sign}</span>
      <span
        style={{
          flex: 1, color: fg, whiteSpace: 'pre', paddingRight: 16,
          // Empty lines still need height so the diff doesn't visually skip rows.
          minHeight: '1.55em',
        }}
      >{op.text === '' ? ' ' : op.text}</span>
    </div>
  );
}

const gutterStyle = {
  width: 48, flexShrink: 0, textAlign: 'right', paddingRight: 10,
  color: GUTTER, userSelect: 'none', fontVariantNumeric: 'tabular-nums',
  borderRight: '1px solid var(--line, #23262b)',
};

/**
 * VersionDiff
 *
 * @param {object}   props
 * @param {boolean}  props.open                Whether the modal is shown.
 * @param {Function} props.onClose             Close handler.
 * @param {string}   [props.path]              Artifact path passed to previewArtifact.
 * @param {object}   [props.fromVersion]       { id, n, label } — the picked (usually older) version.
 * @param {object}   [props.toVersion]         { id, n, label } — usually the current version.
 * @param {Function} [props.previewArtifact]   Override the fetcher (tests / standalone). Defaults
 *                                              to api.js previewArtifact; falls back to a mock when
 *                                              no path/version is provided.
 */
export function VersionDiff({
  open,
  onClose,
  path,
  fromVersion,
  toVersion,
  previewArtifact,
}) {
  // Resolve a fetcher: explicit prop → real api → mock (standalone).
  const standalone = !path || !fromVersion?.id;
  const fetcher = previewArtifact || (standalone ? mockPreview : apiPreviewArtifact);

  // Fill in mock versions so the standalone render has a sensible header.
  const from = fromVersion || { id: 'mock-old', n: 3, label: 'AI edit' };
  const to = toVersion || { id: 'mock-current', n: 4, label: 'current' };

  const [state, setState] = useState({ status: 'idle', oldText: '', newText: '', error: '' });
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    const reqId = ++reqIdRef.current;
    setState({ status: 'loading', oldText: '', newText: '', error: '' });

    let cancelled = false;
    Promise.all([
      Promise.resolve(fetcher(path, { versionId: from.id })),
      Promise.resolve(fetcher(path, { versionId: to.id })),
    ])
      .then(([a, b]) => {
        if (cancelled || reqId !== reqIdRef.current) return;
        setState({ status: 'ready', oldText: contentOf(a), newText: contentOf(b), error: '' });
      })
      .catch((err) => {
        if (cancelled || reqId !== reqIdRef.current) return;
        setState({
          status: 'error', oldText: '', newText: '',
          error: err?.message || 'Could not load one of the versions to compare.',
        });
      });

    return () => { cancelled = true; };
    // from.id/to.id are the load-bearing identity; path keys the artifact.
  }, [open, path, from.id, to.id, fetcher]);

  // Esc-to-close + body scroll lock while open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Compute the diff only when content is ready. Guard giant inputs.
  const diff = useMemo(() => {
    if (state.status !== 'ready') return null;
    const tooBig = state.oldText.length > MAX_DIFF_CHARS || state.newText.length > MAX_DIFF_CHARS;
    if (tooBig) return { tooBig: true, rows: [], added: 0, removed: 0, total: 0, capped: false };
    const ops = diffLines(state.oldText, state.newText);
    const { rows, added, removed } = buildRows(ops);
    const capped = rows.length > MAX_RENDER_ROWS;
    return {
      tooBig: false,
      rows: capped ? rows.slice(0, MAX_RENDER_ROWS) : rows,
      added, removed,
      total: rows.length,
      capped,
    };
  }, [state.status, state.oldText, state.newText]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const fromLabel = `v${from.n}${from.label ? ` · ${from.label}` : ''}`;
  const toLabel = to.label === 'current' || to.id === 'mock-current'
    ? `v${to.n} · current`
    : `v${to.n}${to.label ? ` · ${to.label}` : ''}`;

  const onBackdrop = (e) => { if (e.target === e.currentTarget) onClose?.(); };

  const identical = diff && !diff.tooBig && diff.added === 0 && diff.removed === 0;

  return createPortal(
    <div
      role="presentation"
      onMouseDown={onBackdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        animation: 'modal-fade-in 160ms ease-out both, popIn .18s ease',
        fontFamily: 'var(--font-body, system-ui, sans-serif)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Comparing version ${from.n} to ${to.n}`}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(1080px, 94vw)',
          height: 'min(820px, 88vh)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--bg, #16181c)',
          border: '1px solid var(--line, #23262b)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid var(--line, #23262b)',
            background: 'var(--surface, #1b1e23)', flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-display, var(--font-body, system-ui))',
              fontSize: 16, fontWeight: 600, color: 'var(--ink, #e7eaee)',
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              <span>Comparing</span>
              <Pill tone="del">{fromLabel}</Pill>
              <Arrow />
              <Pill tone="add">{toLabel}</Pill>
            </div>
            {diff && !diff.tooBig && (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3, #8b9097)', display: 'flex', gap: 12 }}>
                <span style={{ color: ADD_FG }}>+{diff.added} added</span>
                <span style={{ color: DEL_FG }}>−{diff.removed} removed</span>
                {diff.capped && <span style={{ color: 'var(--ink-4, #5b6066)' }}>· showing first {MAX_RENDER_ROWS} rows</span>}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            style={{
              cursor: 'pointer', background: 'transparent', border: 0,
              color: 'var(--ink-3, #8b9097)', width: 30, height: 30, borderRadius: 7,
              fontSize: 18, lineHeight: 1, display: 'inline-grid', placeItems: 'center', flexShrink: 0,
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2, rgba(255,255,255,.05))'; e.currentTarget.style.color = 'var(--ink, #e7eaee)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3, #8b9097)'; }}
          >×</button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <div
          className="rd-scroll"
          style={{
            flex: 1, minHeight: 0, overflow: 'auto',
            background: 'var(--bg, #16181c)',
            fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
            fontSize: 12.5, lineHeight: 1.55,
          }}
        >
          {state.status === 'loading' && <CenteredNote>Loading both versions…</CenteredNote>}

          {state.status === 'error' && (
            <CenteredNote tone="error">
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Couldn’t compare these versions</div>
              <div style={{ color: 'var(--ink-3, #8b9097)', fontSize: 12 }}>{state.error}</div>
            </CenteredNote>
          )}

          {state.status === 'ready' && diff?.tooBig && (
            <CenteredNote tone="error">
              These versions are too large to diff in the browser.
            </CenteredNote>
          )}

          {state.status === 'ready' && identical && (
            <CenteredNote>No textual differences between these two versions.</CenteredNote>
          )}

          {state.status === 'ready' && diff && !diff.tooBig && !identical && (
            <div style={{ padding: '8px 0' }}>
              {diff.rows.map((op, idx) => <Row key={idx} op={op} />)}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Small presentational helpers ────────────────────────────────────────────────
function Pill({ tone, children }) {
  const add = tone === 'add';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 6,
      fontSize: 12.5, fontWeight: 600,
      fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)',
      color: add ? ADD_FG : DEL_FG,
      background: add ? ADD_BG : DEL_BG,
      border: `1px solid ${add ? 'rgba(74,222,128,.35)' : 'rgba(248,113,113,.3)'}`,
    }}>{children}</span>
  );
}

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3, #8b9097)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function CenteredNote({ children, tone }) {
  return (
    <div style={{
      height: '100%', minHeight: 220,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: 24, gap: 6,
      fontFamily: 'var(--font-body, system-ui, sans-serif)', fontSize: 13.5,
      color: tone === 'error' ? DEL_FG : 'var(--ink-2, #c7ccd1)',
    }}>
      {children}
    </div>
  );
}

export default VersionDiff;
