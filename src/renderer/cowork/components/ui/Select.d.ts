import type { ComponentType, CSSProperties, ReactNode } from 'react';

export interface SelectOption {
  value?: string;
  label?: ReactNode;
  triggerLabel?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
  title?: string;
  icon?: ReactNode;
  separator?: boolean;
  group?: ReactNode;
  options?: SelectOption[];
}

export interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  options?: SelectOption[];
  placeholder?: string;
  variant?: 'field' | 'pill' | 'unstyled';
  size?: 'md' | 'sm';
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  label?: ReactNode;
  menuLabel?: ReactNode;
  ariaLabel?: string;
  title?: string;
  id?: string;
  name?: string;
  width?: number | string;
  minWidth?: number | string;
  className?: string;
  style?: CSSProperties;
  zIndex?: number;
}

declare const Select: ComponentType<SelectProps>;
export default Select;
