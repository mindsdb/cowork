// Token-driven text input + textarea wrappers.
//
//   <Input value={...} onChange={(v) => ...} placeholder="..." />
//   <Input variant="mono" size="sm" />
//   <Textarea value={...} onChange={(v) => ...} rows={4} />

export function Input({
  value,
  onChange,
  variant,
  size,
  className = '',
  ...rest
}) {
  const classes = [
    'field-input',
    variant === 'mono' ? 'mono' : '',
    size === 'sm' ? 'sm' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <input
      className={classes}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value, e)}
      {...rest}
    />
  );
}

export function Textarea({
  value,
  onChange,
  variant,
  className = '',
  ...rest
}) {
  const classes = [
    'field-textarea',
    variant === 'mono' ? 'mono' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <textarea
      className={classes}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value, e)}
      {...rest}
    />
  );
}

export default Input;
