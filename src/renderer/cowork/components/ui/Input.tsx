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

import { forwardRef } from 'react';
import { Input as BaseInput } from '@base-ui/react/input';
import type { ChangeEvent, ComponentPropsWithoutRef, ComponentRef } from 'react';

export type InputVariant = 'mono';
export type InputSize = 'sm';

export interface InputProps
  // Omit native `size` (a number attr) so our token `size` ('sm') can reuse the name.
  extends Omit<ComponentPropsWithoutRef<typeof BaseInput>, 'onChange' | 'className' | 'value' | 'size'> {
  value?: string;
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
  variant?: InputVariant;
  size?: InputSize;
  className?: string;
}

export const Input = forwardRef<ComponentRef<typeof BaseInput>, InputProps>(function Input(
  { value, onChange, variant, size, className = '', ...rest }, ref,
) {
  const classes = [
    'field-input',
    variant === 'mono' ? 'mono' : '',
    size === 'sm' ? 'sm' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <BaseInput
      ref={ref}
      className={classes}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value, e)}
      {...rest}
    />
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
