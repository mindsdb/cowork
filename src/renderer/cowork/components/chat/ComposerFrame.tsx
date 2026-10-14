import type { HTMLAttributes } from 'react';

import './chat.css';

/**
 * The card around a chat composer, shared by Cowork and Code Mode: border,
 * radius, the resting shadow, and the focus ring. Each composer keeps its own
 * controls and padding inside it.
 *
 * Focus follows the textarea inside (`:has(textarea:focus)`), not
 * :focus-within, so clicking a picker in the toolbar doesn't flash the ring
 * before its menu takes focus. `focused` forces the ring for composers that
 * track focus themselves.
 */
export function ComposerFrame({
  focused = false,
  dragging = false,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { focused?: boolean; dragging?: boolean }) {
  return (
    <div
      {...props}
      className={`composer-frame${focused ? ' is-focused' : ''}${dragging ? ' is-dragging' : ''} ${className}`}
    />
  );
}
