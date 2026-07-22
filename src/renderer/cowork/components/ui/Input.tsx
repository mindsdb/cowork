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

import { Input as BaseInput } from '@base-ui/react/input';
import type { ChangeEvent, ComponentPropsWithoutRef } from 'react';

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

export function Input({ value, onChange, variant, size, className = '', ...rest }: InputProps) {
  const classes = [
    'field-input',
    variant === 'mono' ? 'mono' : '',
    size === 'sm' ? 'sm' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <BaseInput
      className={classes}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value, e)}
      {...rest}
    />
  );
}

export interface TextareaProps
  extends Omit<ComponentPropsWithoutRef<'textarea'>, 'onChange' | 'value'> {
  value?: string;
  onChange?: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  variant?: InputVariant;
  className?: string;
}

export function Textarea({ value, onChange, variant, className = '', ...rest }: TextareaProps) {
  const classes = [
    'field-textarea',
    variant === 'mono' ? 'mono' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <textarea
      className={classes}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value, e)}
      {...rest}
    />
  );
}

export default Input;
