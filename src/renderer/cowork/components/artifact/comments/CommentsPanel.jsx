// Comments inbox panel — 1:1 with the published-viewer inbox (Figma 515-2287):
// a docked 342px review surface on desktop (full-width on compact screens),
// holding the header, the Open/Resolved/All segmented tabs (with counts),
// card list, and a pinned composer for whole-artifact comments.
// Anchored comments are created on the artifact via comment mode; the full
// thread opens in the on-artifact popover when a card is clicked.
//
// State (initial load + realtime SSE + mutations) lives in the shared
// `useArtifactComments` hook, instantiated once in ArtifactViewer so the SAME
// set also backs the on-artifact marker layer; this panel receives that state
// and the layer's imperative controls as props. Tabs ride Base UI's
// ToggleGroup (radiogroup semantics, arrow-key navigation) with the
// reference's segmented-control skin.

import { useCallback, useMemo, useRef, useState } from 'react';
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle as BaseToggle } from '@base-ui/react/toggle';
import { isoToEpoch } from '../../../lib/commentsReducer';
import { ConfirmModal } from '../../ConfirmModal';
import { InboxCard } from './InboxCard';
import { UnanchoredComposer } from './UnanchoredComposer';
import { XIcon } from './icons';
import { Tooltip } from '../../ui';

// Slide-in entrance (mirrors the reference #act-panel: translateX(16px)→0 +
// fade, same easing as the toolbar) — the `cw-comments-panel-in` keyframe
// lives in globals.css alongside every other keyframe in the app.
// `motion-reduce:!animate-none` (Tailwind's built-in variant) honors
// reduced-motion; the `!` is required to beat the inline `animation` style.

const isClosed = (t) => t.status === 'resolved' || t.status === 'dismissed';

// Empty-state copy — exact reference strings.
const EMPTY_COPY = {
  open: 'No open comments',
  resolved: 'No resolved comments',
  all: 'No comments yet',
};

const TABS = [
  ['open', 'Open'],
  ['resolved', 'Resolved'],
  ['all', 'All'],
];

export function CommentsPanel({
  threads = [],
  anchorStates = {},
  error = '',
  expired = false,
  viewer = null,
  capabilities = null,
  onStatus,
  onAddressWithAgent,
  onDeleteThread,
  onCreate,
  onClose,
  onHoverThread,
  onLeaveThread,
  onFocusThread,
}) {
  const [tab, setTab] = useState('open');
  const listRef = useRef(null);
  // Pending delete confirmation, panel-level so there's ONE modal instance.
  // ConfirmModal instead of window.confirm — the native dialog steals
  // webContents focus in Electron and leaves inputs dead afterwards.
  const [pendingDelete, setPendingDelete] = useState(null);

  const groups = useMemo(() => {
    const notDismissed = threads.filter((t) => t.status !== 'dismissed');
    return {
      open: notDismissed.filter((t) => !isClosed(t)),
      resolved: notDismissed.filter((t) => t.status === 'resolved'),
      all: notDismissed,
    };
  }, [threads]);

  // Open first (only meaningful in All), newest-first within each group.
  const visible = useMemo(() => {
    const ts = (t) => isoToEpoch(t.created_at || t.updated_at);
    return groups[tab].slice().sort((a, b) =>
      (isClosed(a) ? 1 : 0) - (isClosed(b) ? 1 : 0) || ts(b) - ts(a));
  }, [groups, tab]);

  const runPendingDelete = useCallback(() => {
    if (!pendingDelete) return;
    onDeleteThread?.(pendingDelete.threadId);
    setPendingDelete(null);
  }, [pendingDelete, onDeleteThread]);

  return (
    <div
      className="artifact-comments-panel flex flex-col gap-[10px] bg-surface px-3 py-2
        font-[family-name:var(--font-body)] motion-reduce:!animate-none"
      style={{ animation: 'cw-comments-panel-in .3s cubic-bezier(.16,1,.3,1)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[18px] font-semibold leading-[28px] text-ink">Comments</span>
        <Tooltip content="Close comments panel">
          <button
            type="button"
            aria-label="Close comments panel"
            className="w-[24px] h-[24px] flex items-center justify-center bg-transparent border-0
              rounded-[6px] p-0 cursor-pointer text-ink-3 transition-colors
              hover:text-ink hover:bg-surface-2"
            onClick={onClose}
          >
            <XIcon />
          </button>
        </Tooltip>
      </div>

      {/* Notices */}
      {expired && (
        <div className="shrink-0 rounded-[6px] px-2 py-[6px] text-[12px] leading-[16px] bg-[#FEF3C7] text-[#B45309]">
          Session expired — reload to see new comments.
        </div>
      )}
      {error && (
        <div className="shrink-0 rounded-[6px] px-2 py-[6px] text-[12px] leading-[16px] bg-[#FEE2E2] text-[#8F321A]">
          {error}
        </div>
      )}

      {/* Segmented tabs: Open / Resolved / All, with counts. */}
      <BaseToggleGroup
        value={[tab]}
        onValueChange={(next) => {
          // Single-select: clicking the active tab returns []; keep it selected.
          const pick = next.find((v) => v !== tab);
          if (pick) setTab(pick);
        }}
        aria-label="Filter comments"
        className="flex gap-[2px] bg-surface-2 rounded-card-row p-[2px] shrink-0"
      >
        {TABS.map(([value, label]) => {
          const n = groups[value].length;
          return (
            <BaseToggle
              key={value}
              value={value}
              aria-label={label}
              className="flex-1 h-[24px] rounded-[6px] border-0 cursor-pointer
                text-[12px] font-medium leading-[16px] transition-[background,color]
                bg-transparent text-ink-3 hover:text-ink font-[inherit]
                data-[pressed]:bg-surface data-[pressed]:text-ink"
              style={{
                boxShadow: tab === value
                  ? '0 1px 2px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(39,39,42,0.08)'
                  : 'none',
              }}
            >
              {label}
              {n > 0 && <b className="font-normal text-ink-4 ml-1">{n}</b>}
            </BaseToggle>
          );
        })}
      </BaseToggleGroup>

      {/* Card list — scrollbar hugs the panel edge instead of stealing card width. */}
      <div ref={listRef}
        className="flex-1 overflow-y-auto flex flex-col gap-[10px] -mr-[10px] pr-1 overscroll-contain">
        {visible.length === 0 && (
          <div className="text-center text-[12px] leading-[16px] text-ink-4 py-6">
            {EMPTY_COPY[tab]}
          </div>
        )}
        {visible.map((t) => (
          <InboxCard
            key={t.id}
            thread={t}
            state={anchorStates[t.id]}
            viewer={viewer}
            canResolve={capabilities?.canResolve === true}
            canAddressWithAgent={capabilities?.canAddressWithAgent === true}
            onStatus={onStatus}
            onAddressWithAgent={onAddressWithAgent}
            onRequestDelete={setPendingDelete}
            onHover={onHoverThread}
            onLeave={onLeaveThread}
            onFocus={onFocusThread}
          />
        ))}
      </div>

      {/* Pinned composer — general (unanchored) comments, selector: null.
          New threads are open and sort newest-first, so scroll to top. */}
      <UnanchoredComposer
        onCreate={onCreate}
        kind={viewer?.role === 'reviewer' ? 'issue' : 'review'}
        placeholder={viewer?.role === 'reviewer' ? 'Report an issue…' : 'Add a comment…'}
        onPosted={() => listRef.current?.scrollTo({ top: 0 })}
      />

      <ConfirmModal
        open={!!pendingDelete}
        title="Delete this comment thread?"
        message="The entire comment thread will be permanently deleted."
        confirmLabel="Delete"
        destructive
        onConfirm={runPendingDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default CommentsPanel;
