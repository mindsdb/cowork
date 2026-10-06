// The one way to draw a Lucide glyph. Every icon gets a 1.5px line whatever
// its box: Lucide's strokeWidth is in 24-unit viewBox units, so without
// `absoluteStrokeWidth` a 12px icon drew a 0.75px hairline and a 32px one a
// 2px slab. Sizes snap to the type scale so call sites cannot drift back to
// per-component guesses.
//
//   <Icon of={GitBranch} size={14} className="text-ink-3" />
//
// The product set in ../Icons.jsx renders through this; ui primitives that
// want a glyph outside that set use it directly.
import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';

export const ICON_SIZES = [12, 14, 16, 20, 32] as const;
export type IconSize = (typeof ICON_SIZES)[number];
// 1.5px is the app line. 1px is for glyphs set beside 13px text in a nav
// list, where a heavier line outweighs the font.
export type IconStroke = 1 | 1.5;

// Nearest step, rounding up on a tie, for sizes computed at runtime.
export function iconSize(n: number): IconSize {
  return ICON_SIZES.reduce((best, step) => (Math.abs(step - n) <= Math.abs(best - n) ? step : best));
}

export interface IconProps extends Omit<LucideProps, 'size' | 'stroke' | 'strokeWidth' | 'absoluteStrokeWidth'> {
  of: ComponentType<LucideProps>;
  size?: IconSize;
  stroke?: IconStroke;
}

export function Icon({ of: Glyph, size = 16, stroke = 1.5, ...rest }: IconProps) {
  return <Glyph size={iconSize(size)} strokeWidth={stroke} absoluteStrokeWidth {...rest} />;
}
