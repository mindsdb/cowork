// One inbox card — 1:1 with the published-viewer inbox (Figma 515-2287).
// A SUMMARY of the thread, not the conversation: avatar + name + relative
// time (+ edited), the text clamped to 4 lines, and a footer with the reply
// count and the "unanchored" chip. The full thread (replies, editing) lives
// in the on-artifact popover, reached by clicking the card (onFocus).
//
// Hover: highlights the anchored element in the iframe (onHover/onLeave) and
// reveals the action cluster — resolve/reopen + a "…" menu (Delete, own
// comments only; the server re-checks authorship anyway).

import Ico from '../../Icons';
import { threadAuthorEmail, threadReplies, threadText, viewerCanEdit, isoToEpoch }
  from '../../../lib/commentsReducer';
import { Tooltip } from '../../ui';
import OverflowMenu from '../../OverflowMenu';
import { CheckCircleIcon, DotsIcon, InfoIcon } from './icons';

// ── Reference-exact presentation helpers ───────────────────────────────────

function displayName(email) {
  const s = String(email || '');
  const i = s.indexOf('@');
  return i > 0 ? s.slice(0, i) : s || 'Anonymous';
}
function initials(email) {
  const parts = displayName(email).split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
}
const AVATAR_COLORS = ['#D99A1C', '#1A8596', '#5F8AD9', '#C46FB0', '#5FB87A', '#D97A5F', '#8F7FD9'];
function avatarColor(email) {
  const a = String(email || '');
  let h = 0;
  for (let i = 0; i < a.length; i += 1) h = (h * 31 + a.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** 16px initials avatar, color hashed from the email (matches the layer's). */
function Avatar({ email }) {
  return (
    <span
      className="w-[16px] h-[16px] rounded-full shrink-0 flex items-center justify-center
        text-white text-[8px] font-semibold"
      style={{ background: avatarColor(email), boxShadow: '0 0 0 0.5px rgba(39,39,42,0.1)' }}
    >
      {initials(email)}
    </span>
  );
}

/** Relative time with the inbox's exact copy ("3 days ago"). */
function inboxTimeAgo(epochSeconds) {
  const ts = isoToEpoch(epochSeconds);
  if (!ts) return '';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 45) return 'just now';
  if (diff < 3600) { const m = Math.round(diff / 60); return `${m}${m === 1 ? ' min ago' : ' mins ago'}`; }
  if (diff < 86400) { const h = Math.round(diff / 3600); return `${h}${h === 1 ? ' hour ago' : ' hours ago'}`; }
  if (diff < 2592000) { const d = Math.round(diff / 86400); return `${d}${d === 1 ? ' day ago' : ' days ago'}`; }
  try { return new Date(ts * 1000).toLocaleDateString(); } catch { return ''; }
}

// Exact chip tooltip copy from the reference.
const UNANCHORED_TIP =
  'This comment isn’t attached to a visible element — the page may have changed '
  + 'since it was left, or it renders differently on your device.';

const GENERAL_TIP =
  'General comment — not attached to any element on the page.';

const HIDDEN_TIP =
  'This comment is on a part of the page that isn’t shown right now (e.g. another '
  + 'slide or tab) — it’ll reappear when you navigate there.';

export function InboxCard({
  thread,
  state,      // layer anchor state: 'hidden' | 'orphan' | undefined
  viewer,
  onStatus,
  onRequestDelete, // ({ threadId }) → panel confirms + dispatches
  onHover,
  onLeave,
  onFocus,
}) {
  const resolved = thread.status === 'resolved';
  const done = resolved || thread.status === 'dismissed';
  // Selector-less threads are unanchored here; the injected layer detects
  // selectors that no longer resolve (version drift) and shows its own orphan
  // notice inside the on-artifact popover.
  // 'orphan' (selector no longer resolves) folds into the "unanchored" chip;
  // 'hidden' (resolves but off-screen — e.g. another slide) gets its own chip.
  const hidden = state === 'hidden';
  const unanchored = !thread.selector || state === 'orphan';
  // No selector at all = an INTENTIONAL general comment (composer path);
  // a selector that stopped resolving = version drift — different tooltips.
  const general = !thread.selector;
  const mine = viewerCanEdit(thread.payload, viewer);
  const nReplies = threadReplies(thread).length;
  const repliesTxt = nReplies ? `${nReplies}${nReplies === 1 ? ' reply' : ' replies'}` : '';
  const email = threadAuthorEmail(thread);

  return (
    <div
      className={[
        'group relative flex flex-col gap-[8px] p-[8px] rounded-card-row cursor-pointer shrink-0',
        'transition-colors hover:bg-surface-2 [&:has([data-popup-open])]:bg-surface-2',
        done ? 'opacity-55' : '',
      ].join(' ')}
      onMouseEnter={() => !unanchored && !hidden && onHover?.(thread.id)}
      onMouseLeave={() => !unanchored && !hidden && onLeave?.(thread.id)}
      onClick={() => onFocus?.(thread.id)}
    >
      {/* Head: avatar · name · time (+edited) */}
      <div className="flex items-center gap-[6px] min-w-0">
        <span className="flex items-center gap-[4px] min-w-0">
          <Avatar email={email} />
          <span className="text-[14px] font-medium leading-[20px] text-ink truncate">
            {displayName(email)}
          </span>
        </span>
        <span className="text-[14px] leading-[20px] text-ink-3 whitespace-nowrap">
          {inboxTimeAgo(thread.created_at || thread.updated_at)}
          {thread.payload?.edited_at && (
            <span className="text-[11px] text-ink-4"> (edited)</span>
          )}
        </span>
      </div>

      {/* Text — clamped to 4 lines; the full text lives in the thread popover. */}
      <div
        className="text-[14px] leading-[20px] text-ink whitespace-pre-wrap break-words"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {threadText(thread)}
      </div>

      {/* Foot: reply count · unanchored chip (only when there's something to say). */}
      {(repliesTxt || unanchored || hidden) && (
        <div className="flex items-center justify-between min-h-[16px]">
          <span className="text-[12px] leading-[16px] text-ink-4">{repliesTxt}</span>
          {hidden ? (
            <Tooltip content={HIDDEN_TIP}>
              <span className="inline-flex items-center gap-[4px] px-[2px] rounded-[4px]
                bg-surface-2 text-ink-3 text-[12px] leading-[16px] cursor-default">
                <InfoIcon />
                <span>hidden</span>
              </span>
            </Tooltip>
          ) : unanchored ? (
            <Tooltip content={general ? GENERAL_TIP : UNANCHORED_TIP}>
              <span className="inline-flex items-center gap-[4px] px-[2px] rounded-[4px]
                bg-surface-2 text-ink-3 text-[12px] leading-[16px] cursor-default">
                <InfoIcon />
                <span>unanchored</span>
              </span>
            </Tooltip>
          ) : null}
        </div>
      )}

      {/* Hover actions, top-right (kept while the "…" menu is open). */}
      <div
        className="absolute top-[8px] right-[8px] hidden items-center gap-[4px]
          group-hover:flex [&:has([data-popup-open])]:flex"
        onClick={(e) => e.stopPropagation()}
      >
        <Tooltip content={resolved ? 'Reopen' : 'Mark as resolved'}>
          <button
            type="button"
            aria-label={resolved ? 'Reopen' : 'Mark as resolved'}
            className={[
              'w-[20px] h-[20px] flex items-center justify-center bg-transparent border-0',
              'cursor-pointer p-0 transition-colors',
              resolved ? 'text-[#146573]' : 'text-ink-4 hover:text-ink',
            ].join(' ')}
            onClick={() => onStatus?.(thread.id, resolved ? 'open' : 'resolved')}
          >
            <CheckCircleIcon />
          </button>
        </Tooltip>
        {mine && (
          <OverflowMenu
            label="More"
            width={145}
            icon={<DotsIcon />}
            triggerClassName="w-[20px] h-[20px] justify-center rounded-[4px]
              bg-[rgba(32,32,33,0.06)] hover:bg-[rgba(32,32,33,0.14)] text-ink"
            items={[{
              label: 'Delete',
              icon: Ico.trash(13),
              danger: true,
              onClick: () => onRequestDelete?.({ threadId: thread.id }),
            }]}
          />
        )}
      </div>
    </div>
  );
}

export default InboxCard;
