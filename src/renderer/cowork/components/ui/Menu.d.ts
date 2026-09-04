import type { ComponentType, ReactElement, ReactNode } from 'react';

export interface MenuItem {
  id?: string;
  key?: string;
  icon?: ReactNode;
  label?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  title?: string;
  keepOpen?: boolean;
  divider?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
  heading?: ReactNode;
}

export interface MenuProps {
  trigger?: ReactElement;
  items?: MenuItem[];
  open?: boolean;
  anchor?: DOMRect | Element | null;
  onClose?: () => void;
  zIndex?: number;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  width?: number;
  ariaLabel?: string;
  onOpenChange?: (open: boolean, details?: unknown) => void;
}

declare const Menu: ComponentType<MenuProps>;
export default Menu;
