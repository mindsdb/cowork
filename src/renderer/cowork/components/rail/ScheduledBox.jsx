// Scheduled card — list of scheduled tasks for the current scope.
// Caller filters items (e.g. by project name) before passing in.

import Ico from '../Icons';
import { RailCard } from './RailCard';

// Kept for the clickable row below, which stays inline (its `all: unset`,
// padding, cursor, transition are all clickable-conditional + it uses a
// JS hover handler). font-body resolves to this same Inter stack.
const FONT_BODY = "'Inter', system-ui, sans-serif";

function ScheduledList({ items, onSelect }) {
  if (!items.length) {
    return (
      <p className="font-body text-sm text-ink-4 pt-2 px-1 pb-1">
        Nothing scheduled here yet.
      </p>
    );
  }
  const clickable = typeof onSelect === 'function';
  return (
    <div className="flex flex-col gap-1 pt-1.5">
      {items.map((s) => {
        const label = s.title || s.prompt || s.id;
        // When `onSelect` is wired, render each row as a button that
        // routes the user to the schedule detail page. Otherwise a
        // plain non-interactive row keeps the card informational —
        // back-compat for any caller that didn't pass the handler.
        const Tag = clickable ? 'button' : 'div';
        return (
          <Tag
            key={s.id}
            type={clickable ? 'button' : undefined}
            title={s.prompt || s.title || s.id}
            onClick={clickable ? () => onSelect(s) : undefined}
            style={{
              all: clickable ? 'unset' : undefined,
              display: 'flex', alignItems: 'center', gap: 8,
              padding: clickable ? '6px 8px' : 0,
              borderRadius: 6,
              fontFamily: FONT_BODY,
              fontSize: 12.5, color: 'var(--ink-2)',
              cursor: clickable ? 'pointer' : 'default',
              transition: clickable
                ? 'background 120ms ease, color 120ms ease'
                : undefined,
            }}
            onMouseOver={clickable ? (e) => {
              e.currentTarget.style.background = 'var(--surface-2)';
              e.currentTarget.style.color = 'var(--ink)';
            } : undefined}
            onMouseOut={clickable ? (e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--ink-2)';
            } : undefined}
          >
            <span className="text-ink-3 inline-flex shrink-0">
              {Ico.clock(13)}
            </span>
            <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {label}
            </span>
            {s.cadence && (
              <span className="text-xs text-ink-4">{s.cadence}</span>
            )}
          </Tag>
        );
      })}
    </div>
  );
}

export function ScheduledBox({
  items = [],
  defaultOpen = true,
  maxBodyHeight = 320,
  onSelect,
}) {
  return (
    <RailCard title="Scheduled Tasks" defaultOpen={defaultOpen} maxBodyHeight={maxBodyHeight}>
      <ScheduledList items={items} onSelect={onSelect} />
    </RailCard>
  );
}
