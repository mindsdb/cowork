import type { ReactNode } from 'react';
import type { MenuItem } from '../ui/Menu';
import type { StatusTone } from '../collection';

export interface TaskRowProps {
  title?: string;
  subtitle?: string;
  /** Omit inside a project, where every row's project is the page's own. */
  project?: { label: string; onOpen?: () => void } | null;
  /** Only states worth seeing: in progress, needs attention, failed. */
  status?: { label: string; tone: StatusTone } | null;
  updatedAt?: string | number | null;
  onOpen?: () => void;
  menuItems?: MenuItem[];
  leading?: ReactNode;
  badges?: ReactNode;
  /** Replaces the menu built from `menuItems`. */
  actions?: ReactNode;
  className?: string;
}

export function TaskRow(props: TaskRowProps): JSX.Element;
