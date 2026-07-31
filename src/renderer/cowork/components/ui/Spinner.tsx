import { useEffect, useState } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

// Braille-dot spinner — the same look as terminal CLIs (e.g. ora, npm).
// Frames cycle on a fixed interval; the component is purely presentational
// and unmounts cleanly so its timer doesn't leak.
//
// No variants, so the convention is plain cn() + Tailwind + TS (not cva).
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
