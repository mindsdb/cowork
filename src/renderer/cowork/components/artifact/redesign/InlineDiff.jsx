// InlineDiff.jsx — renders a proposed edit as inline track-changes (red del +
// green ins) with a Keep / Undo control row and an "Anton · proposed change"
// byline. This is the payoff frame of the M1 flow.
//
// Diff styling (matches the Document design source):
//   .del → color #fca5a5 on rgba(248,113,113,.14), line-through
//   .ins → color #86efac on rgba(74,222,128,.16), underline, + a one-shot diffGlow
//
// For prose we compute a word-level diff so unchanged text stays as plain runs
// and only the changed span is wrapped — e.g.
//   "Invite your teammates from <del>Settings so everyone…</del><ins>Settings —
//    everyone shares one workspace.</ins>"
// If the change is tiny relative to the text (essentially a full rewrite) we fall
// back to the stacked "old / new" presentation the design uses for headlines.

import { useMemo } from 'react';

const DEL_STYLE = {
  color: '#fca5a5',
  background: 'var(--diff-del, rgba(248,113,113,.14))',
  borderRadius: 4,
  padding: '0 3px',
  textDecoration: 'line-through',
  textDecorationColor: 'rgba(248,113,113,.7)',
  boxDecorationBreak: 'clone',
  WebkitBoxDecorationBreak: 'clone',
};

const INS_STYLE = {
  color: '#86efac',
  background: 'var(--diff-add, rgba(74,222,128,.16))',
  borderRadius: 4,
  padding: '0 3px',
  textDecoration: 'underline',
  textDecorationColor: 'rgba(74,222,128,.55)',
  textUnderlineOffset: 3,
  boxDecorationBreak: 'clone',
  WebkitBoxDecorationBreak: 'clone',
};

const STACKED_DEL_STYLE = {
  ...DEL_STYLE,
  display: 'inline-block',
  borderRadius: 5,
  padding: '1px 8px',
  maxWidth: '100%',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

const STACKED_INS_STYLE = {
  ...INS_STYLE,
  display: 'inline-block',
  borderRadius: 5,
  padding: '1px 8px',
  maxWidth: '100%',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  animation: 'diffGlow 1.2s ease',
};

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5 10 17.5 19.5 7" />
  </svg>
);

// ── Word-level diff (LCS over whitespace-preserving tokens) ───────────────────
// Tokenize keeping whitespace so we can rejoin without mangling spacing.
function tokenize(str) {
  return String(str ?? '').match(/\s+|\S+/g) || [];
}

// Returns an array of ops: { type: 'eq'|'del'|'ins', text }.
function diffWords(oldStr, newStr) {
  const a = tokenize(oldStr);
  const b = tokenize(newStr);
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  const push = (type, text) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('eq', a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i++; }
    else { push('ins', b[j]); j++; }
  }
  while (i < n) { push('del', a[i]); i++; }
  while (j < m) { push('ins', b[j]); j++; }
  return ops;
}

// Heuristic: is an inline word-diff readable, or is this basically a full
// rewrite (almost nothing in common)? If common run is tiny, stack instead.
function shouldStack(ops, oldText, newText) {
  const eqLen = ops.filter((o) => o.type === 'eq').reduce((s, o) => s + o.text.trim().length, 0);
  const baseLen = Math.max(String(oldText).trim().length, 1);
  // Stack when fewer than ~20% of chars are shared (e.g. a headline reword).
  return eqLen / baseLen < 0.2;
}

/**
 * InlineDiff
 *
 * @param {object}   props
 * @param {string}   props.oldText        original text
 * @param {string}   props.newText        proposed text
 * @param {Function} props.onKeep         commit the change
 * @param {Function} props.onUndo         discard the proposal
 * @param {object}   [props.conflict]     { message } when a compare-and-swap conflict occurred
 * @param {string}   [props.error]        transient commit error message
 * @param {string}   [props.byline]       defaults to "Anton · proposed change"
 * @param {'auto'|'inline'|'stacked'} [props.layout]  force a presentation
 * @param {object}   [props.textStyle]    typography to inherit (fontSize/lineHeight/fontFamily)
 */
export function InlineDiff({
  oldText = '',
  newText = '',
  onKeep,
  onUndo,
  conflict,
  error,
  byline = 'Anton · proposed change',
  layout = 'auto',
  textStyle,
}) {
  const ops = useMemo(() => diffWords(oldText, newText), [oldText, newText]);
  const stacked = layout === 'stacked' || (layout === 'auto' && shouldStack(ops, oldText, newText));

  const proseStyle = {
    fontSize: 15,
    lineHeight: 1.85,
    fontFamily: 'var(--font-body, inherit)',
    color: 'var(--ink-2)',
    margin: '0 0 8px',
    overflowWrap: 'anywhere',
    ...textStyle,
  };

  return (
    <div style={{ animation: 'popIn .25s ease' }}>
      {stacked ? (
        // Full-rewrite presentation: old struck, new highlighted below.
        <div style={proseStyle}>
          {oldText ? (
            <div>
              <span style={STACKED_DEL_STYLE}>{oldText}</span>
            </div>
          ) : null}
          {newText ? (
            <div style={{ marginTop: oldText ? 6 : 0 }}>
              <span style={STACKED_INS_STYLE}>{newText}</span>
            </div>
          ) : null}
        </div>
      ) : (
        // Inline track-changes: unchanged runs stay plain; changed runs wrapped.
        <p style={proseStyle}>
          {ops.map((op, idx) => {
            if (op.type === 'eq') return <span key={idx}>{op.text}</span>;
            if (op.type === 'del') return <span key={idx} style={DEL_STYLE}>{op.text}</span>;
            return (
              <span key={idx} style={{ ...INS_STYLE, animation: 'diffGlow 1.2s ease' }}>
                {op.text}
              </span>
            );
          })}
        </p>
      )}

      {/* conflict / error notice — surfaced inline above the controls */}
      {conflict ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px',
            fontSize: 12, color: '#fca5a5', background: 'var(--diff-del, rgba(248,113,113,.14))',
            border: '1px solid rgba(248,113,113,.3)', borderRadius: 8, padding: '7px 10px',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger, #F87171)', flexShrink: 0 }} />
          {conflict.message || 'This changed since you started — Anton can merge your edit'}
        </div>
      ) : null}
      {error && !conflict ? (
        <div style={{ fontSize: 12, color: '#fca5a5', margin: '4px 0 8px' }}>{error}</div>
      ) : null}

      {/* control row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: stacked ? '12px 0 0' : '4px 0 0', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onKeep}
          className="rd-no-truncate"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 14px',
            borderRadius: 8, border: 'none', background: 'var(--success, #4ade80)', color: '#04150a',
            fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-body, inherit)', cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <CheckIcon />
          {conflict ? 'Merge & keep' : 'Keep'}
        </button>
        <button
          type="button"
          onClick={onUndo}
          className="rd-no-truncate"
          style={{
            height: 30, padding: '0 14px', borderRadius: 8, border: '1px solid var(--line-2)',
            background: 'transparent', color: 'var(--ink-3)', fontSize: 12.5, fontWeight: 500,
            fontFamily: 'var(--font-body, inherit)', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          Undo
        </button>
        <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 2, lineHeight: 1.3 }}>{byline}</span>
      </div>
    </div>
  );
}

export default InlineDiff;
