// Shared empty-state — the "nothing here yet" panel used by collection
// views (Projects, Scheduled, …) and Code mode's side panels. One quiet
// treatment everywhere: no container, a muted 20px icon, a short heading,
// one line of description, and at most one action.
//
// The primitive owns the look so call sites can't drift: pass a bare icon
// (`Ico.folder(20)`), and the action as data. The action is a secondary
// button because the page header already carries the primary create action;
// set `primary` only where the empty state is the page's sole way forward
// (an error/retry screen).
//
//   <EmptyState icon={Ico.folder(20)} title="No projects yet"
//     description="Create a project to group conversations and outputs."
//     action={{ label: 'New project', onClick: onNew }} />
//
// `size="sm"` is the dense variant for side panels and tool surfaces (Code
// mode's Files, Preview and Review panels): the same layout with a 12px
// heading, an 11px description and no min-height.
//
//   <EmptyState size="sm" icon={Ico.search(20)} title="No matches"
//     description="Try a filename, symbol, or phrase from the code." />

import Button from './Button.tsx';

const FONT_BODY = 'var(--font-body)';

// Per-size values for the one layout below. The icon/action gaps add to the
// column gap.
const SIZES = {
  md: {
    gap: 6, minHeight: 360, iconGap: 6, actionGap: 6,
    title: { color: 'var(--ink)', fontSize: 'var(--text-base)', fontWeight: 600, lineHeight: 1.4 },
    description: { fontSize: 13.5, color: 'var(--ink-3)', maxWidth: '44ch' },
  },
  sm: {
    gap: 5, minHeight: undefined, iconGap: 5, actionGap: 5,
    title: { color: 'var(--ink-3)', fontSize: 12, fontWeight: 600 },
    description: { fontSize: 11, color: 'var(--ink-4)', maxWidth: 240 },
  },
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  style,
  className,
  children,
}) {
  const s = SIZES[size] || SIZES.md;
  return (
    <div
      className={className}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: s.gap, textAlign: 'center', minHeight: s.minHeight, padding: '48px 24px',
        ...style,
      }}
    >
      {icon && (
        <span
          data-empty-icon=""
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: s.iconGap, color: 'var(--ink-4)' }}
        >
          {icon}
        </span>
      )}
      {title && <div style={{ fontFamily: FONT_BODY, ...s.title }}>{title}</div>}
      {description && (
        <div style={{
          fontFamily: FONT_BODY, textAlign: 'center', lineHeight: 1.5, ...s.description,
        }}>
          {description}
        </div>
      )}
      {action && (
        <Button
          variant={action.primary ? 'primary' : 'default'}
          onClick={action.onClick}
          disabled={action.disabled}
          className={action.className}
          style={{ marginTop: s.actionGap }}
        >
          {action.label}
        </Button>
      )}
      {children}
    </div>
  );
}

export default EmptyState;
