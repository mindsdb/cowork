// One inbox card — 1:1 with the published-viewer inbox (Figma 515-2287).
// A SUMMARY of the thread, not the conversation: avatar + name + relative
// time (+ edited), the text clamped to 4 lines, and a footer with the reply
// count and its location context. The full thread (replies, editing) lives
// in the on-artifact popover, reached by clicking the card (onFocus).
//
// Hover highlights the anchored element in the iframe (onHover/onLeave).
// Owner actions remain visible so they are usable from touch and keyboard.

import Ico from '../../Icons';
import { threadAuthorEmail, threadReplies, threadText, viewerCanEdit, isoToEpoch }
  from '../../../lib/commentsReducer';
import { Tooltip } from '../../ui';
import OverflowMenu from '../../OverflowMenu';
import { CheckCircleIcon, DotsIcon, InfoIcon } from './icons';
import i18n, { useTranslation } from '../../../../lib/i18n';

const tr = (key, vars) => i18n.t(key, { ns: 'artifacts', ...vars });

// ── Reference-exact presentation helpers ───────────────────────────────────

function displayName(email) {
  const s = String(email || '');
  const i = s.indexOf('@');
  return i > 0 ? s.slice(0, i) : s || tr('comments.card.anonymous');
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
  if (diff < 45) return tr('comments.card.justNow');
  if (diff < 3600) return tr('comments.card.minutesAgo', { count: Math.round(diff / 60) });
  if (diff < 86400) return tr('comments.card.hoursAgo', { count: Math.round(diff / 3600) });
  if (diff < 2592000) return tr('comments.card.daysAgo', { count: Math.round(diff / 86400) });
  try { return new Date(ts * 1000).toLocaleDateString(); } catch { return ''; }
}


export function InboxCard({
  thread,
  state,      // layer anchor state: 'hidden' | 'orphan' | undefined
  viewer,
  canResolve = false,
  canAddressWithAgent = false,
  // A repair request in flight anywhere on this artifact, and whether this
  // thread is the one an agent is currently working on.
  agentBusy = false,
  agentWorking = false,
  onStatus,
  onAddressWithAgent,
  onRequestDelete, // ({ threadId }) → panel confirms + dispatches
  onHover,
  onLeave,
  onFocus,
}) {
  const { t } = useTranslation('artifacts');
  const resolved = thread.status === 'resolved';
  const done = resolved || thread.status === 'dismissed';
  // The injected layer detects selectors that no longer resolve after edits.
  // Hidden selectors still resolve but point to another slide or tab.
  const hidden = state === 'hidden';
  const unanchored = !thread.selector || state === 'orphan';
  // No selector at all = an INTENTIONAL general comment (composer path);
  // a selector that stopped resolving = version drift — different tooltips.
  const general = !thread.selector;
  const mine = viewerCanEdit(thread.payload, viewer);
  const nReplies = threadReplies(thread).length;
  const repliesTxt = nReplies ? t('comments.card.replies', { count: nReplies }) : '';
  const email = threadAuthorEmail(thread);

  return (
    <div
      className={[
        'group relative flex flex-col gap-2 p-2 rounded-card-row cursor-pointer shrink-0',
        'transition-colors hover:bg-surface-2 [&:has([data-popup-open])]:bg-surface-2',
        done ? 'opacity-55' : '',
      ].join(' ')}
      onMouseEnter={() => !unanchored && !hidden && onHover?.(thread.id)}
      onMouseLeave={() => !unanchored && !hidden && onLeave?.(thread.id)}
      onClick={() => onFocus?.(thread.id)}
    >
      {/* Head: avatar · name · time (+edited) */}
      <div className="flex items-center gap-[6px] min-w-0">
        <span className="flex items-center gap-1 min-w-0">
          <Avatar email={email} />
          <span className="text-base font-medium leading-[20px] text-ink truncate">
            {displayName(email)}
          </span>
        </span>
        <span className="text-base leading-[20px] text-ink-3 whitespace-nowrap">
          {inboxTimeAgo(thread.created_at || thread.updated_at)}
          {thread.payload?.edited_at && (
            <span className="text-xs text-ink-4"> {t('comments.card.edited')}</span>
          )}
        </span>
      </div>

      {/* Text — clamped to 4 lines; the full text lives in the thread popover. */}
      <div className="text-base leading-[20px] text-ink whitespace-pre-wrap break-words line-clamp-4">
        {threadText(thread)}
      </div>

      {/* Foot: reply count and plain-language location context. */}
      {(repliesTxt || unanchored || hidden) && (
        <div className="flex items-center justify-between min-h-[16px]">
          <span className="text-[12px] leading-[16px] text-ink-4">{repliesTxt}</span>
          {hidden ? (
            <Tooltip content={t('comments.card.hiddenTip')}>
              <span className="inline-flex items-center gap-1 px-[2px] rounded-[4px]
                bg-surface-2 text-ink-3 text-[12px] leading-[16px] cursor-default">
                <InfoIcon />
                <span>{t('comments.card.notVisible')}</span>
              </span>
            </Tooltip>
          ) : unanchored ? (
            <Tooltip content={general ? t('comments.card.generalTip') : t('comments.card.unattachedTip')}>
              <span className="inline-flex items-center gap-1 px-[2px] rounded-[4px]
                bg-surface-2 text-ink-3 text-[12px] leading-[16px] cursor-default">
                <InfoIcon />
                <span>{general ? t('comments.card.general') : t('comments.card.notAttached')}</span>
              </span>
            </Tooltip>
          ) : null}
        </div>
      )}

      {/* Owner decisions stay visible: they are the point of this inbox, and
          must remain reachable without hover on touch and keyboard.

          Deleting your own comment is not an owner decision — the comments
          service authorizes it by authorship (403 "not author") — so `mine`
          keeps the cluster alive on its own. Gating the whole thing on
          `canResolve` also took Delete away from the owner whenever the service
          answers without `capabilities` at all (an inference deployment
          predating #465), and the client has no business being stricter. */}
      {(canResolve || mine) && <div
        className="artifact-comment-actions"
        onClick={(event) => event.stopPropagation()}
      >
        {!done && canAddressWithAgent && onAddressWithAgent && (
          <button
            type="button"
            className="artifact-comment-agent-action"
            disabled={agentBusy || agentWorking}
            aria-busy={agentBusy || agentWorking}
            onClick={() => onAddressWithAgent(thread)}
          >
            {Ico.sparkle(14)}
            {agentWorking ? t('comments.card.agentWorking') : agentBusy ? t('comments.card.starting') : t('comments.card.addressWithAgent')}
          </button>
        )}
        {canResolve && (
          <Tooltip content={resolved ? t('comments.card.reopenComment') : t('comments.card.resolveComment')}>
            <button
              type="button"
              aria-label={resolved ? t('comments.card.reopen') : t('comments.card.markResolved')}
              className="artifact-comment-secondary-action"
              onClick={() => onStatus?.(thread.id, resolved ? 'open' : 'resolved')}
            >
              <CheckCircleIcon /> <span>{resolved ? t('comments.card.reopen') : t('comments.card.resolve')}</span>
            </button>
          </Tooltip>
        )}
        {mine && (
          <OverflowMenu
            label={t('comments.card.more')}
            width={145}
            icon={<DotsIcon />}
            size="md"
            items={[{
              label: t('common.delete'),
              icon: Ico.trash(14),
              danger: true,
              onClick: () => onRequestDelete?.({ threadId: thread.id }),
            }]}
          />
        )}
      </div>}
    </div>
  );
}

export default InboxCard;
