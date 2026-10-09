import type { CSSProperties, ReactNode } from 'react';

export interface EmptyStateAction {
  label: ReactNode;
  onClick?: () => void;
  /** Only where the empty state is the page's sole way forward. */
  primary?: boolean;
  disabled?: boolean;
  /** Layout-only, as for Button. */
  className?: string;
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: EmptyStateAction;
  size?: 'sm' | 'md';
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
}

export function EmptyState(props: EmptyStateProps): ReactNode;
export default EmptyState;
