import { cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../../lib/cn';

// A single control child receives label, help/error, and invalid-state associations.
// Pass matching htmlFor/id values to override the generated id.

export interface FieldProps {
  label?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  optional?: boolean;
  // Override the generated control id (must match the control's own `id`).
  htmlFor?: string;
  children: ReactNode;
  // Layout-only escape hatch (appended via cn) — never a style treatment.
  className?: string;
}

export function Field({ label, help, error, required, optional, htmlFor, children, className }: FieldProps) {
  const generatedId = useId();

  // Non-element or multiple children need explicit htmlFor/id wiring; Children.only would throw for
  // strings.
  const childEl = isValidElement(children)
    ? (children as ReactElement<Record<string, unknown>>)
    : null;
  const childProps = (childEl?.props ?? {}) as {
    id?: string;
    required?: boolean;
    ['aria-describedby']?: string;
    ['aria-invalid']?: boolean;
    ['aria-required']?: boolean;
  };

  const controlId = htmlFor ?? childProps.id ?? generatedId;
  const messageId = error || help ? `${controlId}-message` : undefined;

  // Join IDs without cn(): Tailwind merging could discard an ID that resembles a conflicting
  // utility.
  const describedBy =
    [childProps['aria-describedby'], messageId].filter(Boolean).join(' ') || undefined;

  const control = childEl
    ? cloneElement(childEl, {
        id: controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : childProps['aria-invalid'],
        required: required || childProps.required,
        'aria-required': required ? true : childProps['aria-required'],
      })
    : children;

  // Do not add flex gap: .eyebrow already supplies the label spacing.
  return (
    <div className={cn('flex flex-col', className)}>
      {label != null && (
        <label htmlFor={controlId} className="eyebrow">
          {label}
          {required && <span className="text-danger"> *</span>}
          {optional && <span className="normal-case tracking-normal font-normal text-ink-4"> (optional)</span>}
        </label>
      )}
      {control}
      {error ? (
        <p id={messageId} role="alert" className="mt-1.5 text-xs text-danger-text">
          {error}
        </p>
      ) : help ? (
        <p id={messageId} className="mt-1.5 text-xs text-ink-4">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export default Field;
