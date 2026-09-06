import { Card } from './Card.tsx';

const FONT_BODY = 'var(--font-body)';

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
        style={{ ...centering, padding: '48px 24px', ...style }}
      >
        {content}
      </Card>
    );
  }

  return (
    <div style={{ ...centering, padding: '48px 24px', ...style }}>
      {content}
    </div>
  );
}

export default EmptyState;
