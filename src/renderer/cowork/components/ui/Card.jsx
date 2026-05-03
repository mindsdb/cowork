// Token-driven surface containers.
//
//   <Card>...</Card>                 // 24px padding, --r-lg, --sh-1
//   <Card padding="compact">...</Card>  // 16px
//   <Card padding="snug">...</Card>     // 12px
//   <Card flat>...</Card>               // no shadow
//   <Bubble>...</Bubble>                // glassy floating surface

export function Card({
  padding = 'default', // 'default' | 'compact' | 'snug'
  flat = false,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'card',
    padding === 'compact' ? 'compact' : '',
    padding === 'snug'    ? 'snug'    : '',
    flat ? 'flat' : '',
    className,
  ].filter(Boolean).join(' ');
  return <div className={classes} {...rest}>{children}</div>;
}

export function Bubble({ className = '', children, ...rest }) {
  const classes = ['bubble', className].filter(Boolean).join(' ');
  return <div className={classes} {...rest}>{children}</div>;
}

export default Card;
