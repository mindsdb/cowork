// Token-driven button. Wraps the .btn CSS class system.
//
// Examples:
//   <Button>Save draft</Button>                          // default neutral
//   <Button variant="primary">Continue</Button>          // accent + glow
//   <Button variant="subtle">Cancel</Button>             // borderless
//   <Button variant="tinted">Compose</Button>            // accent fill
//   <Button variant="danger" size="sm">Delete</Button>
//   <Button icon size="sm" aria-label="Search">{icon}</Button>
//   <Button block>Sign in</Button>

const VARIANTS = new Set(['default', 'primary', 'subtle', 'tinted', 'danger']);
const SIZES    = new Set(['xs', 'sm', 'md', 'lg', 'xl']);

export default function Button({
  variant = 'default',
  size = 'md',
  icon = false,
  block = false,
  className = '',
  type = 'button',
  children,
  ...rest
}) {
  const v = VARIANTS.has(variant) ? variant : 'default';
  const s = SIZES.has(size) ? size : 'md';
  const classes = [
    'btn',
    v !== 'default' ? v : '',
    s !== 'md' ? s : '',
    icon ? 'icon' : '',
    block ? 'block' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
