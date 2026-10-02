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
// mode's Files, Preview and Review panels): a small muted icon, a 12px
// heading and an 11px description, with no min-height. The caller owns the
// outer padding through `style`.
//
//   <EmptyState size="sm" icon={Ico.search(18)} title="No matches"
//     description="Try a filename, symbol, or phrase from the code." />

import { Card } from './Card.tsx';

const FONT_BODY = 'var(--font-body)';

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
  if (size === 'sm') {
    return (
      <div
        className={className}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center', color: 'var(--ink-4)', fontFamily: FONT_BODY,
          padding: '32px 24px', ...style,
        }}
      >
        {icon && (
          <span style={{ display: 'inline-flex', marginBottom: 10 }}>
            {icon}
          </span>
        )}
        {title && (
          <div style={{ color: 'var(--ink-3)', fontSize: 12, fontWeight: 600 }}>
            {title}
          </div>
        )}
        {description && (
          <div style={{ maxWidth: 240, marginTop: 5, fontSize: 11, lineHeight: 1.5 }}>
            {description}
          </div>
        )}
        {action && (
          <div style={{ marginTop: 10 }}>
            {action}
          </div>
        )}
        {children}
      </div>
    );
  }

  const content = (
    <>
      {icon && (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </span>
      )}
      {title && (
        <div className="s-h3" style={{ color: 'var(--ink)' }}>
          {title}
        </div>
      )}
      {description && (
        <div style={{
          fontFamily: FONT_BODY, fontSize: 13.5, color: 'var(--ink-3)',
          maxWidth: '44ch', textAlign: 'center', lineHeight: 1.5,
        }}>
          {description}
        </div>
      )}
      {action && (
        <div style={{ marginTop: 6 }}>
          {action}
        </div>
      )}
      {children}
    </>
  );

  const centering = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 10, textAlign: 'center', minHeight: 360,
  };

  if (bordered) {
    return (
      <Card
        variant="dashed"
        flat
        className={className}
        style={{ ...centering, padding: '48px 24px', ...style }}
      >
        {content}
      </Card>
    );
  }

  return (
    <div className={className} style={{ ...centering, padding: '48px 24px', ...style }}>
      {content}
    </div>
  );
}

export default EmptyState;
