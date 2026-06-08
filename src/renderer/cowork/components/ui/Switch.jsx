// Radix switch — accessible toggle with keyboard support.
//
// Usage:
//   <Switch checked={on} onCheckedChange={setOn} />
//   <Switch checked={on} onCheckedChange={setOn} size="sm" />
//
// With label:
//   <label className="flex items-center gap-2 text-sm text-ink-2">
//     <Switch checked={on} onCheckedChange={setOn} />
//     Enable notifications
//   </label>

import * as RadixSwitch from '@radix-ui/react-switch';
import { cn } from './cn.js';

const SIZES = {
  sm: { root: 'w-7 h-4',  thumb: 'size-3 data-[state=checked]:translate-x-3' },
  md: { root: 'w-9 h-5',  thumb: 'size-3.5 data-[state=checked]:translate-x-4' },
};

export function Switch({ size = 'md', className, ...props }) {
  const s = SIZES[size] || SIZES.md;

  return (
    <RadixSwitch.Root
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer rounded-full transition-colors',
        'bg-line-2 data-[state=checked]:bg-accent',
        'focus-visible:shadow-[var(--ring)] outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        s.root,
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb
        className={cn(
          'block rounded-full bg-white shadow-sm transition-transform',
          'translate-x-0.5 translate-y-0.5',
          s.thumb,
        )}
      />
    </RadixSwitch.Root>
  );
}

export default Switch;
