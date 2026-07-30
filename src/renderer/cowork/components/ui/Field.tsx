import { cloneElement, isValidElement, useId } from 'react';
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

  // Wire id + aria onto a single control child. Anything that isn't a single
  // React element (multiple children, a bare string/boolean) is left untouched
  // and association falls to an explicit htmlFor/id. `isValidElement` is the
  // safe test — `Children.only` throws for a lone string/boolean child.
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

  // Label ↔ control association. Precedence: explicit htmlFor, then the
  // control's own id, then a generated one. The cloned control always adopts
  // controlId so the two can never drift apart.
  const controlId = htmlFor ?? childProps.id ?? generatedId;
  const messageId = error || help ? `${controlId}-message` : undefined;

  // Plain string join, NOT cn(): aria-describedby is a space-separated list of
  // element IDs, and cn()'s tailwind-merge treats tokens as utility classes —
  // it can silently drop an ID that resembles a conflicting utility.
  const describedBy =
    [childProps['aria-describedby'], messageId].filter(Boolean).join(' ') || undefined;

  const control = childEl
    ? cloneElement(childEl, {
        id: controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : childProps['aria-invalid'],
        // Expose the required state to native validation AND assistive tech,
        // not just the visual asterisk on the label.
        required: required || childProps.required,
        'aria-required': required ? true : childProps['aria-required'],
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
