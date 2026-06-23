// ErrorBubble — themed error/warning callout box.
//
//   <ErrorBubble>Something went wrong.</ErrorBubble>
//   <ErrorBubble className="my-extra">Details here.</ErrorBubble>

export default function ErrorBubble({ className = '', children, style, ...rest }) {
  const classes = ['error-bubble', className].filter(Boolean).join(' ');
  return <div className={classes} style={style} {...rest}>{children}</div>;
}
