import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chartMock = vi.hoisted(() => ({ configs: [], destroyed: 0 }));
vi.mock('chart.js', () => {
  function Chart(canvas, config) {
    chartMock.configs.push({ canvas, config });
    this.destroy = () => { chartMock.destroyed += 1; };
  }
  Chart.register = () => {};
  return { Chart, registerables: [] };
});

import { StatsChart } from './StatsChart';

const DAILY = [
  { date: '2026-10-17', views: 1 },
  { date: '2026-10-18', views: 0 },
  { date: '2026-10-19', views: 4 },
];
// happy-dom answers '' for CSS custom properties, so the theme is stubbed.
const THEME = { '--accent': ' rgb(1, 2, 3) ', '--ink-4': 'rgb(4, 5, 6)', '--line': 'rgb(7, 8, 9)' };

beforeEach(() => {
  chartMock.configs = [];
  chartMock.destroyed = 0;
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name) => THEME[name] || '' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StatsChart', () => {
  it('draws one bar per day in the theme colors read from the page', async () => {
    const { unmount } = render(<StatsChart daily={DAILY} />);

    await waitFor(() => expect(chartMock.configs).toHaveLength(1));
    const { canvas, config } = chartMock.configs[0];
    expect(canvas.tagName).toBe('CANVAS');
    expect(config.type).toBe('bar');
    expect(config.data.labels).toEqual(['10-17', '10-18', '10-19']);
    expect(config.data.datasets[0].data).toEqual([1, 0, 4]);
    expect(config.data.datasets[0].backgroundColor).toBe('rgb(1, 2, 3)');
    expect(config.options.scales.x.ticks.color).toBe('rgb(4, 5, 6)');
    expect(config.options.scales.y.grid.color).toBe('rgb(7, 8, 9)');

    unmount();
    expect(chartMock.destroyed).toBe(1);
  });

  it('rebuilds the chart for new daily data', async () => {
    const { rerender } = render(<StatsChart daily={DAILY} />);
    await waitFor(() => expect(chartMock.configs).toHaveLength(1));

    rerender(<StatsChart daily={[...DAILY, { date: '2026-10-20', views: 2 }]} />);

    await waitFor(() => expect(chartMock.configs).toHaveLength(2));
    expect(chartMock.destroyed).toBe(1);
    expect(chartMock.configs[1].config.data.datasets[0].data).toEqual([1, 0, 4, 2]);
  });
});
