import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import './task-control.css';


function isEditable(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !['radio', 'checkbox', 'button', 'submit'].includes(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}


/**
 * The frame every pending decision shares: it sits on the composer, so a
 * request for the user reads as the composer asking, not as one more notice
 * in the transcript.
 *
 * Focus moves to the tray when it appears, so Enter and Escape answer it
 * rather than sending the draft, unless the user is typing somewhere; taking
 * focus mid-sentence would turn their next Enter into a decision.
 */
export function DecisionTray({ label, kind, icon, aside, children, onKeyDown }: {
  label: string;
  kind?: string;
  icon?: ReactNode;
  /** Quiet context on the kind row, such as where a command runs. */
  aside?: ReactNode;
  children: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!isEditable(document.activeElement)) ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      ref={ref}
      className="code-decision-tray"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        onKeyDown?.(event);
      }}
    >
      {kind && <div className="code-decision-tray__kind">{icon}<span>{kind}</span>{aside}</div>}
      {children}
    </section>
  );
}


/** Enter or Escape pressed on the tray itself or one of its buttons, never inside a field. */
export function isTrayShortcut(event: KeyboardEvent<HTMLElement>, key: 'Enter' | 'Escape'): boolean {
  if (event.key !== key || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
  return !isEditable(event.target as Element);
}
