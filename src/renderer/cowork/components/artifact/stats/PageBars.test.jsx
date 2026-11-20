import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageBars, axisTicks, sumSections } from './PageBars';
import { formatClock } from './formatStats';

describe('formatClock', () => {
  it('reads as a clock, with a tenth of a second under a minute when asked', () => {
    expect(formatClock(240)).toBe('04:00');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(0.2, { fraction: true })).toBe('00:00.2');
    expect(formatClock(12.34, { fraction: true })).toBe('00:12.3');
    expect(formatClock(83, { fraction: true })).toBe('01:23');
    expect(formatClock(undefined)).toBe('—');
  });
});

describe('axisTicks', () => {
  it('rounds the top up to an even step', () => {
    expect(axisTicks(42)).toEqual({ top: 45, ticks: [0, 15, 30, 45], fraction: false });
    expect(axisTicks(0.5)).toEqual({ top: 0.6, ticks: [0, 0.2, 0.4, 0.6], fraction: true });
    expect(axisTicks(0)).toEqual({ top: 1, ticks: [0, 1], fraction: false });
  });
});

describe('sumSections', () => {
  it('sums each section over the visits, in page order, keeping sections no visit reached', () => {
    const outline = [
      { key: 'b', index: 1, label: 'B' },
      { key: 'a', index: 0, label: 'A' },
    ];
    const rows = sumSections(outline, [
      [{ key: 'a', index: 0, seconds: 2 }, { key: 'x', index: 5, label: 'Extra', seconds: 1 }],
      [{ key: 'a', index: 0, seconds: 3.5 }],
    ]);
    expect(rows.map(({ key, label, seconds }) => [key, label, seconds])).toEqual([
      ['a', 'A', 5.5],
      ['b', 'B', 0],
      ['x', 'Extra', 1],
    ]);
  });
});

describe('PageBars', () => {
  it('numbers the x-axis and names an untitled page by its number', () => {
    render(<PageBars bars={[{ key: 'a', seconds: 5 }, { key: 'b', label: 'Two', seconds: 10 }]} label="Chart" />);

    const bars = screen.getAllByTestId('page-bar');
    expect(bars[0]).toHaveAccessibleName('Page 1 of 2, Page 1: 5s');
    expect(bars[1]).toHaveAccessibleName('Page 2 of 2, Two: 10s');
    expect(screen.getByRole('group', { name: 'Chart' })).toBeInTheDocument();
  });

  it('renders nothing without bars', () => {
    const { container } = render(<PageBars bars={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
