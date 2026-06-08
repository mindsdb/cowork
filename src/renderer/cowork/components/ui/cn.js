import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge class names with Tailwind conflict resolution. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
