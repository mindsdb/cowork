/*
 * VersionScrubber — "time travel you can see" (M2).
 *
 * A horizontal, pointer-draggable version timeline that lives in the WorkspaceShell
 * bottomStrip. The track is a thin rail with a purple→cyan gradient fill running up to
 * the *viewing* position and a glowing accent handle you can drag. Dragging snaps to the
 * nearest version and reports it via onScrub. When you're viewing an older version
 * (viewing < current) a banner rises above the track:
 *
 *     Viewing v5 · <tag>            [ Restore this version ]
 *
 * Restore uses forward-restore semantics: restoring an older version creates a *new*
 * current version from it — the in-between versions are kept, never destroyed. The copy
 * says so explicitly ("earlier versions kept") so the action never feels destructive.
 *
 * Pure presentational component. No data fetching — versions/callbacks arrive as props.
 * Self-contained: ships 5 mock versions and, if used uncontrolled (no `viewing` prop),
 * tracks the viewing position in internal state so it can be eyeballed in isolation.
 *
 * Assumes the sibling redesign.css is loaded for the shared @keyframes (popIn).
 *
 * Props:
 *   versions   array   — [{ n, label, author:{name,initials,color,isAI}, when, tag }]
 *                        ordered oldest → newest. Default MOCK_VERSIONS (5 entries).
 *   current    number  — the `n` of the live/newest version (the "· now" right label).
 *                        Default: the last version's n.
 *   viewing    number  — the `n` currently being viewed. Controlled when provided;
 *                        otherwise the component manages it internally (starts = current).
 *   onScrub    func    — (n) => void. Fired while/after dragging when the nearest version
 *                        changes. The scrubbed version's `n` is passed.
 *   onRestore  func    — (n) => void. Fired by the banner's "Restore this version" button
 *                        with the `n` of the version being restored (forward-restore).
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';

const FILL_GRADIENT = 'linear-gradient(90deg,#A78BFA,#22D3EE)';
const MONO = "'JetBrains Mono',ui-monospace,monospace";
const AMBER = '#E8C58E';

export const MOCK_VERSIONS = [
  { n: 3, label: 'v3', author: { name: 'Maya Chen', initials: 'MC', color: '#A78BFA' }, when: '2d ago', tag: 'Manual' },
  { n: 4, label: 'v4', author: { name: 'Anton', initials: 'A', isAI: true }, when: 'yesterday', tag: 'Agent update' },
  { n: 5, label: 'v5', author: { name: 'Maya Chen', initials: 'MC', color: '#A78BFA' }, when: '4h ago', tag: 'Suggestion accepted' },
  { n: 6, label: 'v6', author: { name: 'Anton', initials: 'A', isAI: true }, when: '1h ago', tag: 'Agent update' },
  { n: 7, label: 'v7', author: { name: 'Maya Chen', initials: 'MC', color: '#A78BFA' }, when: 'just now', tag: 'Manual' },
];

export function VersionScrubber({
  versions = MOCK_VERSIONS,
  current,
  viewing,
  onScrub,
  onRestore,
} = {}) {
  const list = versions && versions.length ? versions : MOCK_VERSIONS;
  const lastN = list[list.length - 1].n;
  const firstN = list[0].n;
  const currentN = current == null ? lastN : current;

  // Uncontrolled fallback: track viewing position internally, defaulting to current.
  const [internalViewing, setInternalViewing] = useState(currentN);
  const isControlled = viewing != null;
  const viewingN = isControlled ? viewing : internalViewing;

  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const viewingIndex = useMemo(() => {
    const i = list.findIndex((v) => v.n === viewingN);
    return i === -1 ? list.length - 1 : i;
  }, [list, viewingN]);

  const viewingVersion = list[viewingIndex];
  const currentVersion = list.find((v) => v.n === currentN) || list[list.length - 1];
  const notCurrent = viewingN !== currentN;

  // Position of the handle/fill as a 0..100% of the track, evenly spaced by index.
  const scrubPct = list.length <= 1 ? 100 : (viewingIndex / (list.length - 1)) * 100;

  const commitFromClientX = useCallback(
    (clientX) => {
      const el = trackRef.current;
      if (!el || list.length <= 1) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const idx = Math.round(ratio * (list.length - 1));
      const next = list[idx];
      if (!next || next.n === viewingN) return;
      if (!isControlled) setInternalViewing(next.n);
      onScrub?.(next.n);
    },
    [list, viewingN, isControlled, onScrub],
  );

  const onPointerDown = useCallback(
    (e) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDragging(true);
      commitFromClientX(e.clientX);
    },
    [commitFromClientX],
  );

  const onPointerMove = useCallback(
    (e) => {
      if (!dragging) return;
      commitFromClientX(e.clientX);
    },
    [dragging, commitFromClientX],
  );

  const endDrag = useCallback((e) => {
    if (e?.pointerId != null) e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
  }, []);

  // Keyboard a11y: arrow keys step between adjacent versions.
  const stepBy = useCallback(
    (delta) => {
      const idx = Math.min(list.length - 1, Math.max(0, viewingIndex + delta));
      const next = list[idx];
      if (!next || next.n === viewingN) return;
      if (!isControlled) setInternalViewing(next.n);
      onScrub?.(next.n);
    },
    [list, viewingIndex, viewingN, isControlled, onScrub],
  );

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        stepBy(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        stepBy(1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        stepBy(-list.length);
      } else if (e.key === 'End') {
        e.preventDefault();
        stepBy(list.length);
      }
    },
    [stepBy, list.length],
  );

  return (
    <div style={{ flexShrink: 0, padding: '4px 48px 16px', fontFamily: 'inherit' }}>
      {/* Banner — only when viewing an older version. Forward-restore framing. */}
      {notCurrent && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 10,
            animation: 'popIn .25s ease',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
            <span style={{ color: AMBER, fontWeight: 600 }}>
              Viewing {viewingVersion?.label ?? `v${viewingN}`}
            </span>
            {viewingVersion?.tag ? ` · ${viewingVersion.tag}` : ''}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>earlier versions kept</span>
          <button
            type="button"
            onClick={() => onRestore?.(viewingN)}
            style={{
              height: 28,
              padding: '0 13px',
              borderRadius: 8,
              border: '1px solid var(--accent)',
              background: 'var(--accent-bg)',
              color: 'var(--accent)',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Restore this version
          </button>
        </div>
      )}

      {/* Track row: oldest label · rail+fill+handle · "vN · now" label. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 680, margin: '0 auto' }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-4)', flexShrink: 0 }}>
          {list[0]?.label ?? `v${firstN}`}
        </span>

        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Version timeline"
          aria-valuemin={firstN}
          aria-valuemax={lastN}
          aria-valuenow={viewingN}
          aria-valuetext={`${viewingVersion?.label ?? `v${viewingN}`}${viewingVersion?.tag ? `, ${viewingVersion.tag}` : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          style={{
            flex: 1,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            position: 'relative',
            touchAction: 'none',
            outline: 'none',
          }}
        >
          {/* base rail */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: 4,
              borderRadius: 2,
              background: 'var(--surface-3)',
            }}
          />
          {/* gradient fill to the viewing position */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              height: 4,
              width: `${scrubPct}%`,
              borderRadius: 2,
              background: FILL_GRADIENT,
              transition: dragging ? 'none' : 'width .18s cubic-bezier(.22,1,.36,1)',
            }}
          />
          {/* glowing accent handle */}
          <div
            style={{
              position: 'absolute',
              left: `${scrubPct}%`,
              transform: 'translateX(-50%)',
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 0 4px rgba(34,211,238,.2),0 0 14px var(--accent-glow)',
              pointerEvents: 'none',
              transition: dragging ? 'none' : 'left .18s cubic-bezier(.22,1,.36,1)',
            }}
          />
        </div>

        <span
          style={{ fontFamily: MONO, fontSize: 10, color: 'var(--accent)', flexShrink: 0 }}
          title={currentVersion?.author?.name ? `${currentVersion.author.name} · ${currentVersion.when ?? ''}` : undefined}
        >
          {currentVersion?.label ?? `v${currentN}`} · now
        </span>
      </div>
    </div>
  );
}

export default VersionScrubber;
