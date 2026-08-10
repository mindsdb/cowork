// Token-driven text input + textarea.
//
// `Input` wraps Base UI's <Input> for native input semantics and future
// Field integration (label / validation / error a11y), styled with the
// existing `.field-input` class so the look is unchanged. Base UI ships no
// textarea primitive, so `Textarea` stays a native <textarea> with
// `.field-textarea`. Both keep the app's `(value, event)` onChange signature.
//
//   <Input value={v} onChange={(next) => ...} placeholder="..." />
//   <Input variant="mono" size="sm" />
//   <Textarea value={v} onChange={(next) => ...} rows={4} />
//
// Input-group (ENG-1035): pass `leading`/`trailing` to place an icon, shortcut
// hint, or reveal button inside the same box as the control. When present, a
// `.field-group` wrapper carries the chrome and the inner input goes
// borderless; with neither, the input renders exactly as before.
//
//   <Input leading={<SearchIcon/>} trailing={<Kbd>⌘K</Kbd>} value={q} onChange={setQ} />
//   <Input type="password" trailing={<RevealButton/>} value={pw} onChange={setPw} />

import { forwardRef } from 'react';
import { Input as BaseInput } from '@base-ui/react/input';
import type { ChangeEvent, ComponentPropsWithoutRef, ComponentRef, ReactNode } from 'react';

export type InputVariant = 'mono';
export type InputSize = 'sm';

export interface InputProps
  // Omit native `size` (a number attr) so our token `size` ('sm') can reuse the name.
  extends Omit<ComponentPropsWithoutRef<typeof BaseInput>, 'onChange' | 'className' | 'value' | 'size'> {
  value?: string;
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
  variant?: InputVariant;
  size?: InputSize;
  // Applies to the <input> in every case (unchanged with or without adornments).
  className?: string;
  // Optional in-field adornments. Any value renders the input-group wrapper.
  leading?: ReactNode;
  trailing?: ReactNode;
  // Layout-only class for the group wrapper (e.g. a flex-basis). Only used when
  // `leading`/`trailing` is set; ignored otherwise.
  wrapperClassName?: string;
}

export const Input = forwardRef<ComponentRef<typeof BaseInput>, InputProps>(function Input(
  { value, onChange, variant, size, className = '', leading, trailing, wrapperClassName = '', ...rest }, ref,
) {
  const classes = [
    'field-input',
    variant === 'mono' ? 'mono' : '',
    size === 'sm' ? 'sm' : '',
    className,
  ].filter(Boolean).join(' ');
  const control = (
    <BaseInput
      ref={ref}
      className={classes}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value, e)}
      {...rest}
    />
  );

  // No adornments → render exactly as before (backward compatible). Test for
  // truthiness, not `!= null`: the common `leading={cond && <Icon/>}` idiom
  // yields `false` when off, which must NOT open the group or render an empty
  // (gap-consuming) addon slot.
  const hasLeading = Boolean(leading);
  const hasTrailing = Boolean(trailing);
  if (!hasLeading && !hasTrailing) return control;

  const groupClasses = [
    'field-group',
    size === 'sm' ? 'sm' : '',
    wrapperClassName,
  ].filter(Boolean).join(' ');
  return (
    <span className={groupClasses}>
      {hasLeading && <span className="field-group__addon">{leading}</span>}
      {control}
      {hasTrailing && <span className="field-group__addon">{trailing}</span>}
    </span>
  );
});
Input.displayName = 'Input';

export interface TextareaProps
  extends Omit<ComponentPropsWithoutRef<'textarea'>, 'onChange' | 'value'> {
  value?: string;
  onChange?: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  variant?: InputVariant;
  className?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { value, onChange, variant, className = '', ...rest }, ref,
) {
  const classes = [
    'field-textarea',
    variant === 'mono' ? 'mono' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <textarea
      ref={ref}
      className={classes}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value, e)}
      {...rest}
    />
  );
});
Textarea.displayName = 'Textarea';

export default Input;
