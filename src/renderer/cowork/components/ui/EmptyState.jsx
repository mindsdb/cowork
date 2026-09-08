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

import { Card } from './Card.tsx';

// Shared centering layout for both the bordered (Card) and plain branches.
const CENTERING_CLASS = 'flex flex-col items-center justify-center gap-[10px] text-center min-h-[360px]';

export function EmptyState({
  icon,
  title,
  description,
  action,
  bordered = false,
  style,
  children,
}) {
  const content = (
    <>
      {icon && (
        <span className="inline-flex items-center justify-center">
          {icon}
        </span>
      )}
      {title && (
        <div className="s-h3">
          {title}
        </div>
      )}
      {description && (
        <div className="font-[family-name:var(--font-body)] text-[13.5px] text-ink-3 max-w-[44ch] text-center leading-[1.5]">
          {description}
        </div>
      )}
      {action && (
        <div className="mt-[6px]">
          {action}
        </div>
      )}
      {children}
    </>
  );

  if (bordered) {
    // `.card` sets padding:24px (unlayered → wins the tie), so padding stays
    // inline; the centering layout it doesn't declare converts to className.
    return (
      <Card
        variant="dashed"
        flat
        className={CENTERING_CLASS}
        style={{ padding: '48px 24px', ...style }}
      >
        {content}
      </Card>
    );
  }

  return (
    <div className={`${CENTERING_CLASS} py-12 px-6`} style={style}>
      {content}
    </div>
  );
}

export default EmptyState;
