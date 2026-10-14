import type { CSSProperties, ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  bordered?: boolean;
  size?: 'sm' | 'md';
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
}

export function EmptyState(props: EmptyStateProps): ReactNode;
export default EmptyState;
