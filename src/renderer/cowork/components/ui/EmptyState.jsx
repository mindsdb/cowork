// Shared empty-state — the "nothing here yet" panel used by collection
// views (Projects, Scheduled, …). Composes `Card` for the `bordered`
// (dashed dropzone-style) look; plain views just center the content in
// a min-height box. Adoption of this in the existing per-view local
// EmptyState defs is a later PR — this is the primitive only.
//
//   <EmptyState icon={<Ico.folder(32)/>} title="No projects yet"
//     description="Create your first project to start grouping…"
//     action={<Button variant="primary" onClick={onNew}>New project</Button>} />
//   <EmptyState bordered icon={…} title="…" description="…" />
//
// `size="sm"` is the dense variant for side panels and tool surfaces (Code
// mode's Files, Preview and Review panels): the same layout with a muted
// icon, a 12px heading, an 11px description and no min-height.
//
//   <EmptyState size="sm" icon={Ico.search(20)} title="No matches"
//     description="Try a filename, symbol, or phrase from the code." />

import { Card } from './Card.tsx';

const FONT_BODY = 'var(--font-body)';

// Per-size values for the one layout below. `md` is the original look;
// `sm` tightens the spacing, drops the min-height and steps the type down.
// The icon/action gaps add to the column gap.
const SIZES = {
  md: {
    gap: 10, minHeight: 360, iconGap: undefined, actionGap: 6,
    titleClassName: 's-h3',
    title: { color: 'var(--ink)' },
    description: { fontSize: 13.5, color: 'var(--ink-3)', maxWidth: '44ch' },
  },
  sm: {
    gap: 5, minHeight: undefined, iconGap: 5, actionGap: 5,
    titleClassName: undefined,
    title: { color: 'var(--ink-3)', fontSize: 12, fontWeight: 600 },
    description: { fontSize: 11, color: 'var(--ink-4)', maxWidth: 240 },
    icon: { color: 'var(--ink-4)' },
  },
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  bordered = false,
  size = 'md',
  style,
  className,
  children,
}) {
  const s = SIZES[size] || SIZES.md;
  const content = (
    <>
      {icon && (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: s.iconGap, ...s.icon }}>
          {icon}
        </span>
      )}
      {title && (
        <div className={s.titleClassName} style={s.title}>
          {title}
        </div>
      )}
      {description && (
        <div style={{
          fontFamily: FONT_BODY, textAlign: 'center', lineHeight: 1.5, ...s.description,
        }}>
          {description}
        </div>
      )}
      {action && (
        <div style={{ marginTop: s.actionGap }}>
          {action}
        </div>
      )}
      {children}
    </>
  );

  const centering = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: s.gap, textAlign: 'center', minHeight: s.minHeight, padding: '48px 24px',
  };

  if (bordered) {
    return (
      <Card
        variant="dashed"
        flat
        className={className}
        style={{ ...centering, ...style }}
      >
        {content}
      </Card>
    );
  }

  return (
    <div className={className} style={{ ...centering, ...style }}>
      {content}
    </div>
  );
}

export default EmptyState;
