// ActionBar — the action row of a card, tray or notice, in one hierarchy:
// at most one filled primary, one quiet secondary to its left, and every
// other action behind a "More actions" menu.
//
//   [leading ……………………]  [secondary] [PRIMARY] [⋯]
//
// A decision with three answers of rising commitment (Deny · Always allow ·
// Allow once) adds a ghost `tertiary` on the left; the secondary then takes
// the outlined treatment, so emphasis steps ghost → outline → filled.
//
// The overflow trigger trails the primary, as ComposerLip already placed it,
// so the menu opens flush with the bar's trailing edge (`align="end"`). Bars
// docked to the composer pass `menuSide="top"` so the menu opens upward.
//
// Shortcuts are announced, not bound: `shortcut` sets `aria-keyshortcuts` and
// shows a key hint in the tooltip, and the owning surface handles the key
// (DecisionTray's `isTrayShortcut`), since only it knows when a key is free.
//
//   <ActionBar
//     leading={<p>Runs outside the sandbox</p>}
//     secondary={{ label: 'Deny', onClick: deny, shortcut: 'Escape' }}
//     primary={{ label: 'Allow once', onClick: allow, shortcut: 'Enter' }}
//     overflow={[{ label: 'Always allow', onClick: always }]}
//   />

import type { HTMLAttributes, ReactNode } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import Button, { type ButtonVariant } from './Button';
import Kbd from './Kbd';
import Menu, { type MenuItem } from './Menu';
import Tooltip from './Tooltip';

export interface ActionSpec {
  label: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Work in flight: the button holds and says so (`aria-busy`). */
  busy?: boolean;
  tone?: 'default' | 'danger';
  tooltip?: ReactNode;
  /** An `aria-keyshortcuts` value, e.g. "Enter" or "Meta+Enter". */
  shortcut?: string;
  icon?: ReactNode;
  /** For a disclosure toggle such as "Details": sets `aria-expanded`. */
  expanded?: boolean;
  /** `submit` when the bar sits inside a form the action submits. */
  type?: 'button' | 'submit';
}

export type ActionBarSize = 'xs' | 'sm' | 'md';

export interface ActionBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  primary?: ActionSpec | null;
  secondary?: ActionSpec | null;
  /** A ghost action left of the secondary; promotes the secondary to outlined. */
  tertiary?: ActionSpec | null;
  /** Menu items; falsy entries are skipped so callers can write `cond && item`. */
  overflow?: Array<MenuItem | false | null | undefined>;
  /** Context on the leading edge, such as a risk note or a status line. */
  leading?: ReactNode;
  size?: ActionBarSize;
  align?: 'start' | 'end';
  menuSide?: 'top' | 'bottom';
  /** Accessible name of the overflow trigger and its menu. */
  overflowLabel?: string;
}

const barVariants = cva('flex min-w-0 items-center', {
  variants: {
    size: { xs: 'gap-1', sm: 'gap-1.5', md: 'gap-2' },
    align: { start: 'justify-start', end: 'justify-end' },
  },
  defaultVariants: { size: 'sm', align: 'end' },
});

const ICON_SIZE: Record<ActionBarSize, number> = { xs: 12, sm: 13, md: 14 };

const KEY_GLYPHS: Record<string, string> = {
  Enter: '↵', Escape: 'Esc', Meta: '⌘', Control: 'Ctrl', Alt: '⌥', Shift: '⇧',
};

/** "Meta+Enter" → "⌘↵", the way the app writes key hints. */
export function shortcutHint(shortcut: string): string {
  return shortcut.split('+').map((key) => KEY_GLYPHS[key] ?? key).join('');
}

function ActionButton({ action, variant, size }: { action: ActionSpec; variant: ButtonVariant; size: ActionBarSize }) {
  const button = (
    <Button
      size={size}
      variant={variant}
      disabled={action.disabled || action.busy}
      aria-busy={action.busy || undefined}
      aria-keyshortcuts={action.shortcut}
      aria-expanded={action.expanded}
      type={action.type}
      className={action.busy ? 'is-busy' : undefined}
      onClick={action.onClick}
    >
      {action.icon}{action.label}
    </Button>
  );
  const hint = action.shortcut && <Kbd>{shortcutHint(action.shortcut)}</Kbd>;
  const content = action.tooltip && hint
    ? <span className="inline-flex items-center gap-1.5">{action.tooltip}{hint}</span>
    : action.tooltip || hint;
  return <Tooltip content={content} side="top">{button}</Tooltip>;
}

export function ActionBar({
  primary,
  secondary,
  tertiary,
  overflow = [],
  leading,
  size = 'sm',
  align = 'end',
  menuSide = 'bottom',
  overflowLabel = 'More actions',
  className,
  ...rest
}: ActionBarProps) {
  const items = overflow.filter((item): item is MenuItem => !!item);
  if (!primary && !secondary && !tertiary && !items.length && !leading) return null;
  return (
    <div className={cn(barVariants({ size, align }), className)} {...rest}>
      {leading && <div className="min-w-0 flex-1">{leading}</div>}
      {tertiary && <ActionButton action={tertiary} size={size} variant={tertiary.tone === 'danger' ? 'danger' : 'subtle'} />}
      {secondary && <ActionButton action={secondary} size={size} variant={secondary.tone === 'danger' ? 'danger' : tertiary ? 'default' : 'subtle'} />}
      {primary && <ActionButton action={primary} size={size} variant={primary.tone === 'danger' ? 'danger-solid' : 'primary'} />}
      {items.length > 0 && (
        <Menu
          trigger={(
            <Button icon size={size} variant="subtle" aria-label={overflowLabel}>
              <EllipsisVertical size={ICON_SIZE[size]} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          )}
          items={items}
          side={menuSide}
          align="end"
          ariaLabel={overflowLabel}
        />
      )}
    </div>
  );
}

export default ActionBar;
