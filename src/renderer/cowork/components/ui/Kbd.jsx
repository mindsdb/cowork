// Keyboard-shortcut chip. Styling lives in the `.kbd` class (globals.css).
export function Kbd({ className = '', children, ...rest }) {
  return <kbd className={['kbd', className].filter(Boolean).join(' ')} {...rest}>{children}</kbd>;
}

export default Kbd;
