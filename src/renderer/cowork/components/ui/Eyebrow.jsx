// Eyebrow — small uppercase mono label that sits above headings or
// as a section delimiter, per the design guideline.
//
//   <Eyebrow>Models</Eyebrow>
//   <Eyebrow as="h3">Settings</Eyebrow>

export default function Eyebrow({
  as: Tag = 'span',
  className = '',
  children,
  ...rest
}) {
  const classes = ['eyebrow', className].filter(Boolean).join(' ');
  return <Tag className={classes} {...rest}>{children}</Tag>;
}
