// ChatCardShell — the one frame for cards the agent drops into the transcript
// with something for the user to do: failure, billing and usage notices
// (ChatView's ActionCard) and ask_user questions (AskUserCard).
//
//   <ChatCardShell kind="Billing" title="Task stopped" actions={{ primary, secondary }}>
//     Your balance ran out before this task finished.
//   </ChatCardShell>
//
// "Quiet surface": a --surface-2 tint with no border, a small kind row, the
// title, the body, and the ActionBar on the trailing edge (one filled primary,
// one quiet secondary, the rest behind "…"). A settled card passes `footer`
// (a status line) instead of `actions`. `kind={false}` drops the kind row where
// the turn already names the card, as the "Question for you" step does.

import type { HTMLAttributes, ReactNode } from 'react';
import { CircleAlert, MessageCircleQuestion } from 'lucide-react';
import ActionBar, { type ActionBarProps, type ActionSpec } from './ui/ActionBar';
import { cn } from '../lib/cn';

type Tone = 'notice' | 'question';

const TONES: Record<Tone, { icon: typeof CircleAlert; label: string }> = {
  notice: { icon: CircleAlert, label: 'Notice' },
  question: { icon: MessageCircleQuestion, label: 'Question' },
};

export interface ChatCardShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: Tone;
  /** The kind row's label ("Billing", "Model", …); the tone's label when
      omitted, and no row at all when `false`. */
  kind?: ReactNode | false;
  title?: ReactNode;
  actions?: ActionBarProps | null;
  /** Below the actions: a resolved state's status line, an answer echo. */
  footer?: ReactNode;
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
  tone = 'notice', kind, title, actions, footer, className, children, ...rest
}: ChatCardShellProps) {
  const { icon: Icon, label } = TONES[tone];
  return (
    <div className={cn('chat-card-shell flex flex-col gap-2 rounded-xl bg-surface-2 px-4 py-3.5', className)} {...rest}>
      {kind !== false && (
        <div className="flex items-center gap-1.5 font-body text-xs font-medium text-ink-3">
          <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
          <span>{kind || label}</span>
        </div>
      )}
      {title && <div className="font-body text-base font-semibold leading-snug text-ink">{title}</div>}
      {children && <div className="font-body text-sm leading-relaxed text-ink-2">{children}</div>}
      {actions && <ActionBar className="mt-1 flex-wrap" size="sm" {...actions} />}
      {footer}
    </div>
  );
}
