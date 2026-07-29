import { Children, cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../../lib/cn';

// Form field wrapper — standardizes the label + control + help/error layout
// and the `htmlFor` / `aria-describedby` / `aria-invalid` wiring that ~10+
// forms currently hand-roll with inline `flexDirection:'column'` labels
// (ENG-1147). The label reuses the Eyebrow (uppercase mono) treatment the app
// already uses for field labels.
//
//   <Field label="Project name" help="Lowercase, no spaces.">
//     <Input value={name} onChange={setName} />
//   </Field>
//
//   <Field label="API key" error={err}>
//     <Input type="password" value={key} onChange={setKey} />
//   </Field>
//
// The single control child is cloned to receive `id` (linked to the label),
// `aria-describedby` (help/error text), and `aria-invalid` (when `error` is
// set) — so callers don't repeat that wiring. Pass an explicit `htmlFor`/`id`
// to opt out of the generated id.

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

  // Wire id + aria onto a single control child. Multiple/!element children are
  // left untouched (association then falls to an explicit htmlFor/id).
  const only = Children.count(children) === 1 ? Children.only(children) : null;
  const childEl = only && isValidElement(only) ? (only as ReactElement<Record<string, unknown>>) : null;
  const childProps = (childEl?.props ?? {}) as {
    id?: string;
    ['aria-describedby']?: string;
    ['aria-invalid']?: boolean;
  };

  // Label ↔ control association. Precedence: explicit htmlFor, then the
  // control's own id, then a generated one. The cloned control always adopts
  // controlId so the two can never drift apart.
  const controlId = htmlFor ?? childProps.id ?? generatedId;
  const messageId = error || help ? `${controlId}-message` : undefined;

  const control = childEl
    ? cloneElement(childEl, {
        id: controlId,
        'aria-describedby': cn(childProps['aria-describedby'], messageId) || undefined,
        'aria-invalid': error ? true : childProps['aria-invalid'],
      })
    : children;

  // No flex `gap`: `.eyebrow` carries its own `margin-bottom` for label→control
  // spacing (its designed behaviour), so a uniform gap would double-count it.
  // The message gets its own top margin instead.
  return (
    <div className={cn('flex flex-col', className)}>
      {label != null && (
        // The shared `.eyebrow` treatment (uppercase mono) the app already uses
        // for field labels — same class Eyebrow paints, on a real <label>.
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
