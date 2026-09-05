import type { ReactElement, ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  sideOffset?: number;
  // Use a short delay for frequently used controls.
  delay?: number;
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = 'bottom',
  sideOffset = 8,
  delay = 250,
  className,
}: TooltipProps) {
  if (content == null || content === '') return children;
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger delay={delay} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={sideOffset} style={{ zIndex: 2000 }}>
          <BaseTooltip.Popup
            className={className}
            style={{
              background: 'var(--ink)',
              color: 'var(--surface)',
              fontFamily: 'var(--font-body)',
              fontSize: 11.5,
              fontWeight: 500,
              lineHeight: 1.3,
              padding: '5px 9px',
              borderRadius: 7,
              boxShadow: 'var(--sh-2)',
              maxWidth: 240,
              userSelect: 'none',
            }}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export default Tooltip;
