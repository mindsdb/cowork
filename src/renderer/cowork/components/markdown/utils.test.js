import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CHART_LIMITS,
  MERMAID_LIMITS,
  applyChartTheme,
  chartBlockToPngBlob,
  dropFunctionStrings,
  estimateMermaidNodes,
  looksLikeFunctionSource,
  mermaidThemeVariables,
  parseChartConfig,
  parseChartIntent,
  readChartTheme,
  stripJsonComments,
  validateMermaidSource,
} from './utils';

const bar = (datasets = [{ label: 'Sales', data: [1, 2, 3] }]) => ({
  type: 'bar',
  data: { labels: ['a', 'b', 'c'], datasets },
});

describe('stripJsonComments', () => {
  it('removes line and block comments', () => {
    expect(stripJsonComments('{ // note\n "a": 1 /* x */ }')).toBe('{ \n "a": 1  }');
  });

  it('keeps comment-like text inside strings', () => {
    const src = '{"url": "https://example.com/a", "s": \'/* no */\', "e": "q\\"//x"}';
    expect(stripJsonComments(src)).toBe(src);
  });

  it('drops an unterminated block comment to the end', () => {
    expect(stripJsonComments('{"a":1} /* open')).toBe('{"a":1} ');
  });

  it('treats nullish input as empty', () => {
    expect(stripJsonComments(undefined)).toBe('');
  });
});

describe('looksLikeFunctionSource / dropFunctionStrings', () => {
  it.each([
    'function (v) { return v; }',
    '  function named(v) {}',
    'async function () {}',
    '(v) => v + "%"',
    '(ctx, i) => ctx.dataset.data[i]',
    'v => v * 2',
    'async (v) => v',
  ])('flags %j', (value) => {
    expect(looksLikeFunctionSource(value)).toBe(true);
  });

  it.each(['Sales vs. costs => margin', 'functional areas', 'A -> B', '50%', 3, null])('keeps %j', (value) => {
    expect(looksLikeFunctionSource(value)).toBe(false);
  });

  it('strips callbacks deep in the config and prototype keys', () => {
    const cleaned = dropFunctionStrings({
      options: {
        scales: { y: { ticks: { callback: 'function (v) { return v + "%"; }', color: 'red' } } },
        plugins: { tooltip: { callbacks: { label: '(ctx) => ctx.raw' } } },
      },
      list: ['ok', 'v => v'],
      ['__proto__']: { polluted: true },
      constructor: 'x',
    });
    expect(cleaned).toEqual({
      options: {
        scales: { y: { ticks: { color: 'red' } } },
        plugins: { tooltip: { callbacks: {} } },
      },
      list: ['ok'],
    });
    expect({}.polluted).toBeUndefined();
  });
});

describe('parseChartConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a JSON config with comments', () => {
    const text = `// a chart\n${JSON.stringify(bar())}\n/* end */`;
    expect(parseChartConfig(text)).toEqual({ config: bar() });
  });

  it('accepts a body that still carries its fence markers', () => {
    expect(parseChartConfig('```json\n' + JSON.stringify(bar()) + '\n```').config).toEqual(bar());
  });

  // Regression: MessageChart used to eval() the fence body, so model output
  // ran as code in the renderer.
  it('never evaluates the body: a JS literal with a call is an error', () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const hits = [];
    vi.stubGlobal('__chartHit', () => hits.push(1));
    expect(parseChartConfig('{a: alert(1)}')).toEqual({ error: 'Invalid JSON in chart specification' });
    expect(parseChartConfig('({type: "bar", data: (__chartHit(), {datasets: [{data: [1]}]})})').error)
      .toBe('Invalid JSON in chart specification');
    expect(parseChartConfig("{type: 'bar', data: {datasets: [{data: [1]}]}, options: {onClick: function () { alert(1) }}}").error)
      .toBe('Invalid JSON in chart specification');
    expect(alert).not.toHaveBeenCalled();
    expect(hits).toEqual([]);
  });

  it('drops function strings and inline plugins from a valid config', () => {
    const text = JSON.stringify({
      ...bar(),
      options: { scales: { y: { ticks: { callback: 'function (v) { return alert(v); }' } } } },
      plugins: [{ id: 'x', beforeDraw: 'function () {}' }],
    });
    const { config } = parseChartConfig(text);
    expect(config.options.scales.y.ticks).toEqual({});
    expect(config.plugins).toBeUndefined();
  });

  it.each([
    ['[]', 'Invalid chart specification'],
    ['null', 'Invalid chart specification'],
    ['{"data": {"datasets": [{"data": [1]}]}}', 'Missing chart type'],
    ['{"type": "bar"}', 'Invalid chart specification'],
    ['{"type": "bar", "data": {"datasets": []}}', 'Invalid chart specification'],
    ['{"type": "bar", "data": {"datasets": [{"data": 5}]}}', 'Invalid chart specification'],
    ['{"type": "bar", "data": {"datasets": [null]}}', 'Invalid chart specification'],
  ])('rejects %s', (text, error) => {
    expect(parseChartConfig(text)).toEqual({ error });
  });

  it('caps the text size', () => {
    const big = JSON.stringify({ ...bar(), pad: 'x'.repeat(CHART_LIMITS.maxBytes) });
    expect(parseChartConfig(big).error).toBe('The specification is larger than 50 KB');
  });

  it('caps the dataset count', () => {
    const at = Array.from({ length: CHART_LIMITS.maxDatasets }, () => ({ data: [1] }));
    expect(parseChartConfig(JSON.stringify(bar(at))).config).toBeDefined();
    const over = [...at, { data: [1] }];
    expect(parseChartConfig(JSON.stringify(bar(over))).error).toBe('Too many datasets (6); the limit is 5');
  });

  it('caps the total data points across datasets', () => {
    const half = Array.from({ length: CHART_LIMITS.maxPoints / 2 }, (_, i) => i);
    expect(parseChartConfig(JSON.stringify(bar([{ data: half }, { data: half }]))).config).toBeDefined();
    expect(parseChartConfig(JSON.stringify(bar([{ data: half }, { data: [...half, 1] }]))).error)
      .toBe('Too many data points (501); the limit is 500');
  });
});

describe('parseChartIntent', () => {
  it('keeps the intent format unsupported-but-parsed', () => {
    expect(parseChartIntent('{"type":"bar"}')).toEqual({ type: 'bar' });
    expect(parseChartIntent('{}').error).toBe('Missing chart type');
    expect(parseChartIntent('{"type":"radar"}').error).toMatch(/Unsupported chart type/);
    expect(parseChartIntent('nope').error).toBe('Invalid JSON in chart specification');
  });
});

describe('estimateMermaidNodes / validateMermaidSource', () => {
  it('counts distinct flowchart nodes, not labels or keywords', () => {
    const src = [
      'flowchart TD',
      '  A[Start here] --> B{Is it ok?}',
      '  B -- yes --> C(Done)',
      '  B -->|no| D["Retry -> again"]',
      '  D -.-> A & C',
      '  subgraph group',
      '    E',
      '  end',
      '  style A fill:#fff',
      '  %% comment X --> Y',
    ].join('\n');
    expect(estimateMermaidNodes(src)).toBe(5);
  });

  it('counts sequence participants once', () => {
    const src = 'sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello\n  Alice-)Carol: ping';
    expect(estimateMermaidNodes(src)).toBe(3);
  });

  it('accepts a diagram within the caps and trims the trailing newline', () => {
    expect(validateMermaidSource('graph LR\n  A --> B\n')).toEqual({ source: 'graph LR\n  A --> B' });
  });

  it('rejects an empty diagram', () => {
    expect(validateMermaidSource('  \n').error).toBe('The diagram is empty');
  });

  it('caps the node count', () => {
    const lines = Array.from({ length: MERMAID_LIMITS.maxNodes }, (_, i) => `  n${i} --> n${i + 1}`);
    expect(validateMermaidSource(`graph TD\n${lines.join('\n')}`).error)
      .toBe('Too many nodes (101); the limit is 100');
    expect(validateMermaidSource(`graph TD\n${lines.slice(1).join('\n')}`).source).toBeDefined();
  });

  it('caps the text size', () => {
    expect(validateMermaidSource(`graph TD\n  A["${'x'.repeat(MERMAID_LIMITS.maxBytes)}"]`).error)
      .toBe('The specification is larger than 20 KB');
  });
});

describe('theme', () => {
  afterEach(() => {
    document.body.removeAttribute('style');
    delete document.body.dataset.theme;
  });

  const theme = {
    ink: 'rgb(1, 1, 1)', ink2: 'rgb(2, 2, 2)', ink3: 'rgb(3, 3, 3)', line: 'rgb(4, 4, 4)',
    surface: 'rgb(5, 5, 5)', surface2: 'rgb(6, 6, 6)', accent: 'rgb(7, 7, 7)',
    fontBody: 'Inter', fontMono: 'Mono', series: ['s0', 's1', 's2'], dark: true,
  };

  it('reads the tokens from body and falls back without a document', () => {
    document.body.style.setProperty('--ink', '#ff0000');
    document.body.style.setProperty('--font-body', 'Inter');
    document.body.dataset.theme = 'dark';
    // happy-dom neither keeps nor resolves var() in an inline colour; the
    // browser does. Stand in for it on the probe: --ink is read first.
    const real = globalThis.getComputedStyle;
    let probeReads = 0;
    vi.stubGlobal('getComputedStyle', (el) => {
      if (el.tagName !== 'SPAN') return real(el);
      probeReads += 1;
      return { color: probeReads === 1 ? 'rgb(255, 0, 0)' : '' };
    });
    const read = readChartTheme();
    vi.unstubAllGlobals();
    expect(read.ink).toBe('rgb(255, 0, 0)');
    expect(read.line).toBe('#E4E4E1');
    expect(read.fontBody).toBe('Inter');
    expect(read.series).toHaveLength(5);
    expect(read.dark).toBe(true);
    expect(document.body.querySelector('span[style*="display: none"]')).toBeNull();
    expect(readChartTheme(null).accent).toBe('#1F9CB0');
  });

  it('fills unset colours from the theme and keeps explicit ones', () => {
    const themed = applyChartTheme({
      type: 'line',
      data: { datasets: [{ data: [1] }, { data: [2], borderColor: 'hotpink' }] },
      options: { maintainAspectRatio: true, color: 'navy', scales: { x: { grid: { color: 'green' } }, y: {} } },
    }, theme);
    expect(themed.data.datasets[0]).toMatchObject({ backgroundColor: 's0', borderColor: 's0' });
    expect(themed.data.datasets[1]).toMatchObject({ backgroundColor: 's1', borderColor: 'hotpink' });
    expect(themed.options).toMatchObject({
      color: 'navy', borderColor: theme.line, responsive: true, maintainAspectRatio: false,
      font: { family: 'Inter' },
    });
    expect(themed.options.scales.x.grid.color).toBe('green');
    expect(themed.options.scales.y).toMatchObject({ grid: { color: theme.line }, ticks: { color: theme.ink3 } });
  });

  it('colours each slice of a pie and leaves scales out when none were declared', () => {
    const themed = applyChartTheme({ type: 'pie', data: { datasets: [{ data: [1, 2, 3, 4] }] } }, theme);
    expect(themed.data.datasets[0].backgroundColor).toEqual(['s0', 's1', 's2', 's0']);
    expect(themed.data.datasets[0].borderColor).toBe(theme.surface);
    expect(themed.options.scales).toBeUndefined();
  });

  it('maps the tokens onto Mermaid theme variables', () => {
    expect(mermaidThemeVariables(theme)).toMatchObject({
      darkMode: true, primaryTextColor: theme.ink, lineColor: theme.ink3, fontFamily: 'Inter',
    });
  });
});

describe('chartBlockToPngBlob', () => {
  it('resolves null when nothing has drawn', async () => {
    const block = document.createElement('div');
    expect(await chartBlockToPngBlob(block)).toBeNull();
    expect(await chartBlockToPngBlob(null)).toBeNull();
  });
});
