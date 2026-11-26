import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Chart.js and Mermaid draw into canvas / SVG, which happy-dom can't do;
// stand-ins record what they're handed.
const chartjs = vi.hoisted(() => {
  const destroy = vi.fn();
  const Chart = vi.fn(function Chart(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.destroy = destroy;
  });
  Chart.register = vi.fn();
  Chart.defaults = { font: {} };
  return { Chart, destroy };
});
vi.mock('chart.js', () => ({ Chart: chartjs.Chart, registerables: [] }));

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg data-testid="mermaid-svg"><text>drawn</text></svg>' })),
}));
vi.mock('mermaid', () => ({ default: mermaid }));

const downloads = vi.hoisted(() => ({ downloadBlob: vi.fn(() => true) }));
vi.mock('../../lib/browserDownload', () => downloads);

const png = vi.hoisted(() => ({ blob: null }));
vi.mock('./utils', async (importOriginal) => ({
  ...(await importOriginal()),
  chartBlockToPngBlob: vi.fn(async () => png.blob),
}));

vi.mock('../../lib/skillsStore', () => ({ useSkillNames: () => new Set() }));

import { MarkdownCode } from './MarkdownCode';
import { MarkdownContent } from './MarkdownContent';

const BAR = JSON.stringify({ type: 'bar', data: { labels: ['a'], datasets: [{ label: 'x', data: [1] }] } });
const fence = (lang, text, extra = {}) => (
  <MarkdownCode className={`language-${lang}`} complete {...extra}>{text}</MarkdownCode>
);

beforeEach(() => {
  chartjs.Chart.mockClear();
  chartjs.destroy.mockClear();
  mermaid.initialize.mockClear();
  mermaid.render.mockClear();
  downloads.downloadBlob.mockClear();
  png.blob = new Blob(['png'], { type: 'image/png' });
});

afterEach(() => {
  cleanup();
  delete document.body.dataset.theme;
});

describe('MarkdownCode — chartjs', () => {
  it('draws a valid config in the chart block, themed and sized', async () => {
    const { container } = render(fence('chartjs', BAR));
    await waitFor(() => expect(chartjs.Chart).toHaveBeenCalledTimes(1));
    const [canvas, config] = chartjs.Chart.mock.calls[0];
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.closest('.anton-chart-canvas').style.height).toBe('280px');
    expect(config.options).toMatchObject({ responsive: true, maintainAspectRatio: false });
    expect(config.data.datasets[0].backgroundColor).toEqual(expect.any(String));
    expect(container.querySelector('[data-chart-block="chartjs"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Copy as image' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeTruthy();
  });

  // Regression: the body used to be eval()'d.
  it('shows the error state for a JS payload and never draws or runs it', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    render(fence('chartjs', '{a: alert(1)}'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid JSON in chart specification');
    expect(chartjs.Chart).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shows the error state over a cap', () => {
    const datasets = Array.from({ length: 6 }, () => ({ data: [1] }));
    render(fence('chartjs', JSON.stringify({ type: 'bar', data: { datasets } })));
    expect(screen.getByRole('alert')).toHaveTextContent('Too many datasets (6); the limit is 5');
    expect(chartjs.Chart).not.toHaveBeenCalled();
  });

  it('shows the error state when Chart.js rejects the config', async () => {
    chartjs.Chart.mockImplementationOnce(function Broken() { throw new Error('"nope" is not a registered controller.'); });
    render(fence('chartjs', JSON.stringify({ type: 'nope', data: { datasets: [{ data: [1] }] } })));
    expect(await screen.findByRole('alert')).toHaveTextContent('"nope" is not a registered controller.');
  });

  it('draws a new config after the previous one was rejected', async () => {
    chartjs.Chart.mockImplementationOnce(function Broken() { throw new Error('"nope" is not a registered controller.'); });
    const { rerender } = render(fence('chartjs', JSON.stringify({ type: 'nope', data: { datasets: [{ data: [1] }] } })));
    await screen.findByRole('alert');
    rerender(fence('chartjs', BAR));
    await waitFor(() => expect(chartjs.Chart).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(chartjs.Chart.mock.calls[1][1].type).toBe('bar');
  });

  it('holds the loading state at the chart height while the fence streams', () => {
    render(fence('chartjs', '{"type": "bar", "da', { complete: false }));
    const loading = screen.getByTestId('chart-loading');
    expect(loading.style.height).toBe('280px');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(chartjs.Chart).not.toHaveBeenCalled();
  });

  it('redraws when the app theme changes and destroys on unmount', async () => {
    const { unmount } = render(fence('chartjs', BAR));
    await waitFor(() => expect(chartjs.Chart).toHaveBeenCalledTimes(1));
    await act(async () => { document.body.dataset.theme = 'dark'; });
    await waitFor(() => expect(chartjs.Chart).toHaveBeenCalledTimes(2));
    expect(chartjs.destroy).toHaveBeenCalledTimes(1);
    unmount();
    expect(chartjs.destroy).toHaveBeenCalledTimes(2);
  });

  it('reveals the fence source as the ordinary code block', () => {
    const { container } = render(fence('chartjs', `${BAR}\n`));
    expect(container.querySelector('pre > code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show source' }));
    const code = container.querySelector('.anton-chart-block-source .anton-code-block pre > code');
    expect(code.getAttribute('data-source')).toBe(BAR);
    expect(screen.getByRole('button', { name: 'Hide source' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('renders plain code when charts are off (user turns)', () => {
    const { container } = render(fence('chartjs', BAR, { enableCharts: false }));
    expect(container.querySelector('[data-chart-block]')).toBeNull();
    expect(container.querySelector('pre > code').getAttribute('data-source')).toBe(BAR);
  });
});

describe('MarkdownCode — mermaid', () => {
  const SRC = 'graph TD\n  A --> B';

  it('renders the diagram through mermaid at strict security', async () => {
    const { container } = render(fence('mermaid', SRC));
    expect(await screen.findByTestId('mermaid-svg')).toBeTruthy();
    expect(container.querySelector('[data-chart-block="mermaid"] .anton-mermaid-svg svg')).not.toBeNull();
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false, securityLevel: 'strict', theme: 'base', htmlLabels: false,
      themeVariables: expect.objectContaining({ primaryTextColor: expect.any(String) }),
    }));
    const [id, text] = mermaid.render.mock.calls[0];
    expect(id).toMatch(/^anton-mermaid-[\w-]+$/);
    expect(text).toBe(SRC);
  });

  it('renders plain code when charts are off (user turns)', () => {
    const { container } = render(fence('mermaid', SRC, { enableCharts: false }));
    expect(container.querySelector('[data-chart-block]')).toBeNull();
    expect(container.querySelector('pre > code').getAttribute('data-source')).toBe(SRC);
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('shows the loading state while the fence streams', () => {
    render(fence('mermaid', 'graph TD\n  A -->', { complete: false }));
    expect(screen.getByTestId('chart-loading')).toBeTruthy();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('shows the error state when mermaid cannot parse the diagram', async () => {
    mermaid.render.mockRejectedValueOnce(new Error('Parse error on line 2'));
    render(fence('mermaid', 'graph TD\n  A -->'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Parse error on line 2');
  });

  it('shows the error state over the node cap without rendering', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `  n${i} --> n${i + 1}`).join('\n');
    render(fence('mermaid', `graph TD\n${lines}`));
    expect(screen.getByRole('alert')).toHaveTextContent('Too many nodes');
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});

describe('MarkdownCode — chart intent', () => {
  it('stays unsupported', () => {
    render(fence('chart', '{"type":"bar"}'));
    expect(screen.getByRole('alert')).toHaveTextContent('`chart` intent format');
  });
});

describe('MarkdownContent — chart actions on the delegated listener', () => {
  const answer = `Here:\n\n\`\`\`chartjs\n${BAR}\n\`\`\`\n`;

  it('downloads the chart as a PNG', async () => {
    const { container } = render(<MarkdownContent text={answer} complete isAssistant />);
    await waitFor(() => expect(chartjs.Chart).toHaveBeenCalled());
    fireEvent.click(container.querySelector('[data-chart-action="download-png"]'));
    await waitFor(() => expect(downloads.downloadBlob).toHaveBeenCalledWith(png.blob, 'chart.png'));
  });

  it('copies the chart to the clipboard as an image', async () => {
    const write = vi.fn(async () => {});
    vi.stubGlobal('ClipboardItem', class { constructor(items) { this.items = items; } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    const { container } = render(<MarkdownContent text={answer} complete isAssistant />);
    await waitFor(() => expect(chartjs.Chart).toHaveBeenCalled());
    const btn = container.querySelector('[data-chart-action="copy-image"]');
    fireEvent.click(btn);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0][0][0].items).toEqual({ 'image/png': png.blob });
    await waitFor(() => expect(btn.classList.contains('is-copied')).toBe(true));
    vi.unstubAllGlobals();
    delete navigator.clipboard;
  });

  it('does nothing when nothing has drawn', async () => {
    png.blob = null;
    const { container } = render(<MarkdownContent text={answer} complete isAssistant />);
    fireEvent.click(container.querySelector('[data-chart-action="download-png"]'));
    await Promise.resolve();
    expect(downloads.downloadBlob).not.toHaveBeenCalled();
  });
});
