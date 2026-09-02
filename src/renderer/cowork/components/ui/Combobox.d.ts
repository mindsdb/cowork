import type { CSSProperties, ReactNode } from 'react';

export type ComboboxItem = {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
  icon?: ReactNode;
  tag?: string;
  action?: ReactNode;
  [key: string]: unknown;
};

export type ComboboxGroup = {
  key: string;
  name: string | null;
  items: ComboboxItem[];
  className?: string;
};

export type ComboboxProps = {
  value?: string | null;
  onValueChange?: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  groups?: ComboboxGroup[];
  filter?: (item: ComboboxItem, query: string, contains: (value: string, query: string) => boolean) => boolean;
  renderValue?: (selected: ComboboxItem | null) => ReactNode;
  placeholder?: string;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  menuLabel?: ReactNode;
  emptyText?: string;
  variant?: 'field' | 'unstyled';
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  title?: string;
  id?: string;
  width?: string | number;
  minWidth?: string | number;
  className?: string;
  style?: CSSProperties;
  zIndex?: number;
};

export function Combobox(props: ComboboxProps): ReactNode;
export default Combobox;
