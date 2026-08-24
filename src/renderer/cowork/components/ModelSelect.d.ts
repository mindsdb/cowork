import type { CSSProperties, ReactNode } from 'react';

export interface ModelSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
  tag?: string;
  maker?: string;
  provider?: string;
  pin?: 'top' | 'bottom';
  action?: ReactNode;
}

export interface ModelSelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  options?: ModelSelectOption[];
  placeholder?: string;
  emptyText?: string;
  menuLabel?: ReactNode;
  variant?: 'field' | 'pill' | 'unstyled';
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  ariaLabel?: string;
  title?: string;
  id?: string;
  width?: number | string;
  minWidth?: number | string;
  className?: string;
  style?: CSSProperties;
  zIndex?: number;
}

export function ModelSelect(props: ModelSelectProps): ReactNode;
export default ModelSelect;
