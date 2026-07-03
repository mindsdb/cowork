// Message — themed callout box with variants.
//
//   <Message>Something went wrong.</Message>
//   <Message variant="warning">Check your input.</Message>
//   <Message variant="info">Tip: you can also drag and drop.</Message>
//   <Message variant="success">Connected successfully.</Message>

const BASE = 'rounded-[10px] px-3 py-2.5 font-body text-[13.5px] leading-normal select-text border border-solid';

const VARIANT_CLASSES = {
  error:   'border-danger-border bg-danger-bg text-danger-text',
  warning: 'border-warning-border bg-warning-bg text-warning-text',
  info:    'border-info-border bg-info-bg text-info-text',
  success: 'border-success-border bg-success-bg text-success-text',
};

export default function Message({ variant = 'error', className = '', children, style, ...rest }) {
  const v = variant in VARIANT_CLASSES ? variant : 'error';
  const classes = [BASE, VARIANT_CLASSES[v], className].filter(Boolean).join(' ');
  return <div className={classes} style={style} {...rest}>{children}</div>;
}
