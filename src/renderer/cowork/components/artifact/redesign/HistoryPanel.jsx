/*
 * HistoryPanel — the dock "History" tab content (M2).
 *
 * A vertical list of version cards, newest at the top. Each card shows the author avatar
 * (AI authors get the purple→cyan identity gradient, humans get a solid initials chip),
 * the version label + a tag badge ("Agent update" / "Suggestion accepted" / "Manual"),
 * the "author · when" line, and a row of Preview / Compare / Restore actions. The card
 * matching `current` is flagged with a quiet "now" pill and has no Restore action.
 *
 * Restore here is forward-restore (consistent with VersionScrubber): bringing back an
 * older version stacks a new version on top — earlier versions are kept.
 *
 * Pure presentational component. No data fetching — versions/callbacks arrive as props.
 * Self-contained: reuses MOCK_VERSIONS from VersionScrubber so it renders standalone.
 *
 * Assumes the sibling redesign.css is loaded for the shared @keyframes (riseIn) and the
 * .rd-hov hover helper.
 *
 * Props:
 *   versions   array  — [{ n, label, author:{name,initials,color,isAI}, when, tag }].
 *                       Default MOCK_VERSIONS. Rendered newest → oldest.
 *   current    number — the `n` of the live version (gets the "now" pill, no Restore).
 *                       Default: the newest version's n.
 *   onPreview  func   — (n) => void. "Preview" opens that version on the canvas read-only.
 *   onCompare  func   — (n) => void. "Compare" diffs that version against current.
 *   onRestore  func   — (n) => void. "Restore" forward-restores that version.
 */

import React from 'react';
import { MOCK_VERSIONS } from './VersionScrubber';

const AI_GRADIENT = 'linear-gradient(135deg,#A78BFA,#22D3EE)';
const MONO = "'JetBrains Mono',ui-monospace,monospace";

// Map a tag to its badge tint. Agent updates lean accent (AI), the rest stay neutral.
function tagStyle(tag) {
  if (tag === 'Agent update') {
    return { color: 'var(--accent)', background: 'var(--accent-bg)', boxShadow: 'inset 0 0 0 1px rgba(34,211,238,.3)' };
  }
  if (tag === 'Suggestion accepted') {
    return { color: '#86efac', background: 'var(--diff-add,rgba(74,222,128,.16))', boxShadow: 'inset 0 0 0 1px rgba(74,222,128,.3)' };
  }
  // 'Manual' and anything else.
  return { color: 'var(--ink-3)', background: 'var(--surface-3)', boxShadow: 'inset 0 0 0 1px var(--line)' };
}

function Avatar({ author }) {
  const isAI = !!author?.isAI;
  return (
    <div
      title={author?.name}
      style={{
        width: 30,
        height: 30,
        borderRadius: '50%',
        flexShrink: 0,
        background: isAI ? AI_GRADIENT : author?.color || '#2a3957',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        color: isAI ? '#04121a' : 'var(--ink)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)',
      }}
    >
      {author?.initials ?? '??'}
    </div>
  );
}

function ActionButton({ label, onClick, accent = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rd-hov"
      style={{
        height: 26,
        padding: '0 10px',
        borderRadius: 7,
        border: accent ? '1px solid var(--accent)' : '1px solid var(--line)',
        background: accent ? 'var(--accent-bg)' : 'transparent',
        color: accent ? 'var(--accent)' : 'var(--ink-2)',
        fontSize: 11.5,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

export function HistoryPanel({
  versions = MOCK_VERSIONS,
  current,
  onPreview,
  onCompare,
  onRestore,
} = {}) {
  const list = versions && versions.length ? versions : MOCK_VERSIONS;
  const currentN = current == null ? list[list.length - 1].n : current;
  // Newest first for the reading order of a history feed.
  const ordered = [...list].reverse();

  return (
    <div
      className="rd-scroll"
      style={{
        '--font-mono': MONO,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        overflowY: 'auto',
        overflowX: 'hidden',
        height: '100%',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
      }}
    >
      {ordered.map((v, i) => {
        const isCurrent = v.n === currentN;
        const badge = tagStyle(v.tag);
        return (
          <div
            key={v.n}
            style={{
              background: 'var(--surface-2)',
              border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--line)'}`,
              borderRadius: 12,
              padding: 12,
              boxShadow: isCurrent ? '0 0 0 3px rgba(34,211,238,.08)' : 'var(--sh-1, 0 1px 0 rgba(0,0,0,.4),0 1px 2px rgba(0,0,0,.4))',
              animation: `riseIn .3s ease ${Math.min(i * 0.03, 0.18)}s both`,
            }}
          >
            {/* Header: avatar + version label + tag badge (+ now pill). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar author={v.author} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>
                    {v.label ?? `v${v.n}`}
                  </span>
                  {v.tag && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        borderRadius: 5,
                        padding: '2px 7px',
                        whiteSpace: 'nowrap',
                        ...badge,
                      }}
                    >
                      {v.tag}
                    </span>
                  )}
                  {isCurrent && (
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 9.5,
                        color: 'var(--accent)',
                        background: 'var(--accent-bg)',
                        borderRadius: 4,
                        padding: '1px 6px',
                        marginLeft: 'auto',
                      }}
                    >
                      now
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--ink-3)',
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {v.author?.name ?? 'Unknown'}
                  {v.when ? ` · ${v.when}` : ''}
                </div>
              </div>
            </div>

            {/* Actions. Current version has nothing to restore to. */}
            <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
              <ActionButton label="Preview" onClick={() => onPreview?.(v.n)} />
              <ActionButton label="Compare" onClick={() => onCompare?.(v.n)} />
              {!isCurrent && <ActionButton label="Restore" accent onClick={() => onRestore?.(v.n)} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default HistoryPanel;
