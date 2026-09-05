import { useEffect, useState } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface SpinnerProps extends ComponentPropsWithoutRef<'span'> {
  intervalMs?: number;
}

export default function Spinner({ intervalMs = 80, className, ...rest }: SpinnerProps) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % FRAMES.length), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return (
    <span
      className={cn('inline-block w-[1ch] text-center font-mono', className)}
      aria-hidden="true"
      {...rest}
    >
      {FRAMES[i]}
    </span>
  );
}
