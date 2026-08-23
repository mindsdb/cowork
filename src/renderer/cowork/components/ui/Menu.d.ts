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
}

declare const Menu: ComponentType<MenuProps>;
export default Menu;
