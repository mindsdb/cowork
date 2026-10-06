// Trailing dashed "+ New …" tile at the end of a collection grid. Built on
// `<Card variant="dashed" interactive>`, whose hover turns the edge and label
// accent. `className` is for layout only (e.g. a page's mobile hide class).
//
//   <NewTile label="New project" onClick={openCreate} />

import type { ReactNode } from 'react';
import Ico from '../Icons';
import { Card } from '../ui/Card';
import { cn } from '../../lib/cn';

export interface NewTileProps {
  label: ReactNode;
  onClick: () => void;
  className?: string;
}

export function NewTile({ label, onClick, className }: NewTileProps) {
  return (
    <Card
      as="button"
      variant="dashed"
      interactive
      padding="none"
      onClick={onClick}
      className={cn('min-h-[120px] py-[14px] px-4 flex flex-col items-center justify-center gap-2', className)}
    >
      <span className="inline-flex">{Ico.plus(16)}</span>
      <span className="font-body text-[13px] font-medium">{label}</span>
    </Card>
  );
}

export default NewTile;
