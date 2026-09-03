import type { ReactNode } from 'react';

import { safeCodeExternalUrl } from './developerTools';

type SafeCodeExternalLinkProps = {
  children: ReactNode;
  className?: string;
  value: string | null | undefined;
};

export function SafeCodeExternalLink({ children, className, value }: SafeCodeExternalLinkProps) {
  const href = safeCodeExternalUrl(value);
  if (!href) {
    return <span className={className} aria-disabled="true">{children}</span>;
  }
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
