// Message — themed callout box with variants.
//
//   <Message>Something went wrong.</Message>
//   <Message variant="warning">Check your input.</Message>
//   <Message variant="info">Tip: you can also drag and drop.</Message>
//   <Message variant="success">Connected successfully.</Message>

const VARIANTS = new Set(['error', 'warning', 'info', 'success']);

export default function Message({ variant = 'error', className = '', children, style, ...rest }) {
  const v = VARIANTS.has(variant) ? variant : 'error';
  const classes = [
    'message',
    v !== 'error' ? v : '',
    className,
  ].filter(Boolean).join(' ');
  return <div className={classes} style={style} {...rest}>{children}</div>;
}
