import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { ButtonSize } from './ui/Button';
import type { MenuItem, MenuProps } from './ui/Menu';

export interface OverflowMenuProps extends Omit<MenuProps, 'trigger' | 'items'> {
  items?: MenuItem[];
  icon?: ReactNode;
  /** Trigger's accessible name; defaults to "More actions". */
  label?: string;
  title?: string;
  disabled?: boolean;
  /** Trigger Button size; defaults to `xxs`. */
  size?: ButtonSize;
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  stopPropagation?: boolean;
  onTriggerClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onTriggerKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export function OverflowMenu(props: OverflowMenuProps): JSX.Element;
export default OverflowMenu;
