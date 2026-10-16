// ChatCardShell — the one frame for cards the agent drops into the transcript
// with something for the user to do: failure, billing and usage notices
// (ChatView's ActionCard), ask_user questions (AskUserCard), and the pointer
// to a connection form (MarkdownCode's data-vault-form card).
//
//   <ChatCardShell kind="Billing" title="Task stopped" actions={{ primary, secondary }}>
//     Your balance ran out before this task finished.
//   </ChatCardShell>
//
// "Quiet surface": a --surface-2 tint with no border, a small kind row, the
// title, the body, and the ActionBar on the trailing edge (one filled primary,
// one quiet secondary, the rest behind "…"). `kind={false}` drops the kind row where
// the turn already names the card, as the "Question for you" step does.
//
// `state` is the one vocabulary every card speaks: pending, answered, denied,
// failed, expired. A settled card (answered, denied, expired) drops its
// actions and ends in a receipt line, an icon plus `receipt` or the state's
// own words. A failed card keeps its actions, since a retry is still a way
// forward, and its kind row turns the danger colour so it never reads as a
// finished answer. A pending card looks like a card with no state.

import { isValidElement, type HTMLAttributes, type ReactNode } from 'react';
import { Ban, Check, CircleAlert, Clock, MessageCircleQuestion, Plug } from 'lucide-react';
import { Icon } from './ui/Icon';
import ActionBar, { type ActionBarProps, type ActionSpec } from './ui/ActionBar';
import { cn } from '../lib/cn';

type Tone = 'notice' | 'question' | 'connection';

const TONES: Record<Tone, { icon: typeof CircleAlert; label: string }> = {
  notice: { icon: CircleAlert, label: 'Notice' },
  question: { icon: MessageCircleQuestion, label: 'Question' },
  connection: { icon: Plug, label: 'Connection' },
};

export type CardState = 'pending' | 'answered' | 'denied' | 'failed' | 'expired';

export const CARD_STATES: Record<CardState, { icon: typeof CircleAlert | null; label: string }> = {
  pending: { icon: null, label: 'Waiting for you' },
  answered: { icon: Check, label: 'Answered' },
  denied: { icon: Ban, label: 'Declined' },
  failed: { icon: CircleAlert, label: 'Failed' },
  expired: { icon: Clock, label: 'No longer active' },
};

/** A settled card is done: no actions, and a receipt says how it ended. */
export function isSettledCardState(state?: CardState | null): boolean {
  return state === 'answered' || state === 'denied' || state === 'expired';
}

export interface ChatCardShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: Tone;
  /** The kind row's label ("Billing", "Model", …); the tone's label when
      omitted, and no row at all when `false`. */
  kind?: ReactNode | false;
  title?: ReactNode;
  actions?: ActionBarProps | null;
  /** Below the actions and the receipt: anything else the card ends with. */
  footer?: ReactNode;
  /** Where the card is in its life. Omitted, the card has no state at all. */
  state?: CardState;
  /** The receipt line's words, in place of the state's own label. */
  receipt?: ReactNode;
}

export interface CardButton extends ActionSpec {
  primary?: boolean;
}

/*
 * A caller's flat button list in ActionBar's hierarchy: the button marked
 * `primary` is the filled action, the next is the quiet secondary, and any
 * further ones go behind "…". A lone button is the primary whether marked or
 * not: as a borderless secondary on the tint it would read as plain text.
 * An empty list gives no bar.
 */
export function cardActions(buttons: CardButton[] = []): ActionBarProps | null {
  if (!buttons.length) return null;
  const primary = buttons.length === 1 ? buttons[0] : buttons.find((b) => b.primary) || null;
  const [secondary = null, ...rest] = buttons.filter((b) => b !== primary);
  return {
    primary,
    secondary,
    overflow: rest.map((b) => ({ label: b.label, onClick: b.onClick, disabled: b.disabled || b.busy })),
  };
}

export default function ChatCardShell({
  tone = 'notice', kind, title, actions, footer, state, receipt, className, children, ...rest
}: ChatCardShellProps) {
  const { label } = TONES[tone];
  // A failed card's kind row carries the alert glyph, whatever the tone.
  const icon = state === 'failed' ? CircleAlert : TONES[tone].icon;
  const settled = isSettledCardState(state);
  const stateIcon = settled ? CARD_STATES[state!].icon : null;
  return (
    <div
      className={cn('chat-card-shell flex flex-col gap-2 rounded-xl bg-surface-2 px-4 py-3.5', className)}
      data-state={state}
      {...rest}
    >
      {kind !== false && (
        <div className={cn('flex items-center gap-1.5 font-body text-xs font-medium', state === 'failed' ? 'text-danger' : 'text-ink-3')}>
          <Icon of={icon} size={14} />
          <span>{kind || label}</span>
        </div>
      )}
      {title && <div className="font-body text-base font-semibold leading-snug text-ink">{title}</div>}
      {children && <div className="font-body text-sm leading-relaxed text-ink-2">{children}</div>}
      {actions && !settled && <ActionBar className="mt-1 flex-wrap" size="sm" {...actions} />}
      {(settled || (state === 'failed' && receipt)) && (
        // A worded receipt is one short caption line, so the icon centres on
        // it. A caller's node (AskUserCard's answer, in body text) can wrap,
        // so the icon sits on its first line instead.
        <div className={cn('chat-card-shell__receipt flex gap-1.5 font-body text-xs text-ink-4', isValidElement(receipt) ? 'items-start' : 'items-center')}>
          {stateIcon && <Icon of={stateIcon} size={14} className={cn('shrink-0', isValidElement(receipt) && 'mt-1')} aria-hidden />}
          <div className="min-w-0">{receipt ?? CARD_STATES[state!].label}</div>
        </div>
      )}
      {footer}
    </div>
  );
}
