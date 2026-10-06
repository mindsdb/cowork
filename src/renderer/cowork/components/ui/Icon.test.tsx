import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Folder } from 'lucide-react';
import { Icon, ICON_SIZES, iconSize } from './Icon';

describe('iconSize', () => {
  it('snaps to the nearest step and rounds up on a tie', () => {
    expect([9, 11, 13, 15, 17, 18, 22, 26, 30].map(iconSize)).toEqual([12, 12, 14, 16, 16, 20, 20, 32, 32]);
    for (const s of ICON_SIZES) expect(iconSize(s)).toBe(s);
  });
});

describe('Icon', () => {
  it('draws a 1.5px line at every size', () => {
    for (const size of ICON_SIZES) {
      const { container, unmount } = render(<Icon of={Folder} size={size} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('width')).toBe(String(size));
      expect(Number(svg.getAttribute('stroke-width')) * size / 24).toBeCloseTo(1.5);
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      unmount();
    }
  });

  it('draws a 1px line on request', () => {
    const { container } = render(<Icon of={Folder} size={16} stroke={1} />);
    expect(Number(container.querySelector('svg')!.getAttribute('stroke-width')) * 16 / 24).toBeCloseTo(1);
  });

  it('passes through classes and labels', () => {
    const { container } = render(<Icon of={Folder} size={14} className="x" aria-label="Local changes" />);
    const svg = container.querySelector('svg')!;
    expect(svg.classList.contains('x')).toBe(true);
    expect(svg.getAttribute('aria-label')).toBe('Local changes');
    expect(svg.hasAttribute('aria-hidden')).toBe(false);
  });
});

// Literal sizes in source stay on the scale; off-scale values only ever enter
// through the runtime snap for computed sizes.
describe('icon sizes in source', () => {
  const root = join(__dirname, '..', '..', '..');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : files(p);
    return /\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
  it('uses only the scale steps', () => {
    const steps = new Set<number>(ICON_SIZES);
    const bad: string[] = [];
    for (const file of files(root)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/Ico(?:\.\w+|\[[^\]]+\])\((\d+)\)|<Icon\b[^>]*\bsize=\{(\d+)\}/g)) {
        const n = Number(m[1] ?? m[2]);
        if (!steps.has(n)) bad.push(`${file.slice(root.length + 1)}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
