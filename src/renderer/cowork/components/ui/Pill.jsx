// Pill — compact rounded label.
//
//   <Pill>Beta</Pill>
//   <Pill variant="muted">Optional</Pill>
//   <Pill variant="danger">Failed</Pill>

const VARIANTS = new Set(['default', 'muted', 'danger']);

export default function Pill({
  variant = 'default',
  className = '',
  children,
  ...rest
}) {
  const v = VARIANTS.has(variant) ? variant : 'default';
  const classes = [
    'pill',
    v !== 'default' ? v : '',
    className,
  ].filter(Boolean).join(' ');
  return <span className={classes} {...rest}>{children}</span>;
}
