// Input and Textarea use onChange(value, event), rather than the native event-only signature.

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
  // className always applies to the input, including inside a group.
  className?: string;
  // Truthy adornments enable the input-group wrapper.
  leading?: ReactNode;
  trailing?: ReactNode;
  // Layout-only class for the wrapper; ignored without leading/trailing adornments.
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

  // Falsy adornments (e.g. leading={condition && <Icon/>}) must not create an empty input group.
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
