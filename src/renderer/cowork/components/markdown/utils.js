// Shared markdown helpers. Currently just chart-intent parsing.
// Ported from mdb-ai/src/components/Message/utils.js.

import i18n from '../../../lib/i18n';

export const CHART_TYPES = ['bar', 'line', 'pie', 'scatter'];

/**
 * Parse a chart intent JSON from a code block body.
 * Returns the parsed intent, or { error } if parsing fails.
 */
export function parseChartIntent(text) {
  try {
    const intent = JSON.parse(text);
    if (!intent.type) return { error: i18n.t('markdown.chart.missingType', { ns: 'chat' }) };
    if (!CHART_TYPES.includes(intent.type)) {
      return { error: i18n.t('markdown.chart.unsupportedType', { ns: 'chat', type: intent.type, supported: CHART_TYPES.join(', ') }) };
    }
    return intent;
  } catch (e) {
    return { error: i18n.t('markdown.chart.invalidJson', { ns: 'chat' }) };
  }
}

// ── Inline chart / diagram fences ──────────────────────────────────────
// ```chartjs and ```mermaid blocks are model output, so they are parsed as
// data and capped before anything draws. Over a cap, or invalid → the
// caller shows the error state instead of drawing.

export const CHART_LIMITS = Object.freeze({
  maxBytes: 50_000,
  maxPoints: 500,
  maxDatasets: 5,
});

export const MERMAID_LIMITS = Object.freeze({
  maxBytes: 20_000,
  maxNodes: 100,
});

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * Remove `//` and `/* *\/` comments outside string literals. A naive regex
 * would also eat the `//` in "https://…" inside a label.
 */
export function stripJsonComments(str) {
  const src = String(str ?? '');
  let out = '';
  let quote = null;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < src.length) {
        out += src[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

// A string that reads as JS source for a callback (`function (v) {…}`,
// `(v) => …`, `v => …`). JSON can't carry a function, but a model often
// writes one as a string; Chart.js would show it verbatim at best.
const FUNCTION_STRING_RE = /^\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function looksLikeFunctionSource(value) {
  return typeof value === 'string' && FUNCTION_STRING_RE.test(value);
}

/**
 * Deep copy of parsed JSON without function-looking strings or prototype
 * keys. In an array the string becomes null rather than being removed, so
 * `labels` stays aligned with each dataset's `data`.
 */
export function dropFunctionStrings(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (looksLikeFunctionSource(item) ? null : dropFunctionStrings(item)));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (UNSAFE_KEYS.has(key) || looksLikeFunctionSource(item)) continue;
      out[key] = dropFunctionStrings(item);
    }
    return out;
  }
  return value;
}

function chartError(key, values) {
  return { error: i18n.t(`markdown.chart.${key}`, { ns: 'chat', ...values }) };
}

/**
 * Parse a ```chartjs fence body into a Chart.js config. Never evaluates it:
 * comments are stripped and the rest must be JSON. Returns `{ config }` or
 * `{ error }`.
 */
export function parseChartConfig(text) {
  const raw = String(text ?? '');
  if (byteLength(raw) > CHART_LIMITS.maxBytes) {
    return chartError('tooLarge', { limit: Math.round(CHART_LIMITS.maxBytes / 1000) });
  }
  let parsed;
  try {
    const clean = stripJsonComments(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    return chartError('invalidJson');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return chartError('invalidSpec');
  if (typeof parsed.type !== 'string' || !parsed.type) return chartError('missingType');
  const datasets = parsed.data?.datasets;
  if (!Array.isArray(datasets) || datasets.length === 0) return chartError('invalidSpec');
  if (datasets.length > CHART_LIMITS.maxDatasets) {
    return chartError('tooManyDatasets', { count: datasets.length, limit: CHART_LIMITS.maxDatasets });
  }
  let points = 0;
  for (const dataset of datasets) {
    if (!dataset || typeof dataset !== 'object' || !Array.isArray(dataset.data)) return chartError('invalidSpec');
    points += dataset.data.length;
  }
  if (points > CHART_LIMITS.maxPoints) {
    return chartError('tooManyPoints', { count: points, limit: CHART_LIMITS.maxPoints });
  }
  const config = dropFunctionStrings(parsed);
  // Inline plugins are objects of hook functions; JSON can only carry
  // their husks. `options.plugins` (legend, title, tooltip) is kept.
  delete config.plugins;
  return { config };
}

const MERMAID_KEYWORDS = new Set([
  'graph', 'flowchart', 'subgraph', 'end', 'direction', 'style', 'classdef', 'class', 'click',
  'linkstyle', 'participant', 'actor', 'note', 'loop', 'alt', 'else', 'opt', 'par', 'and',
  'rect', 'activate', 'deactivate', 'title', 'section', 'autonumber', 'critical', 'break',
  'td', 'tb', 'bt', 'lr', 'rl',
]);

// Arrows across flowchart, sequence, class and state diagrams. Only counts
// nodes for the size cap (never sanitizes): `!?` also takes `--!>`, which
// keeps CodeQL's HTML-comment-filter check (js/bad-tag-filter) quiet.
const MERMAID_ARROW_RE = /\s*(?:<?[-=.]{2,}!?[>xo)]*|<?-+!?>>?|-[x)])(?:\|[^|]*\|)?\s*/g;
// Node shapes / labels: [..], (..), {..}, ".."; stripped before tokenizing.
const MERMAID_LABEL_RE = /"[^"]*"|\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g;
// A link's inline text: `A -- text --> B`, `A == text ==> B`.
const MERMAID_LINK_TEXT_RE = /(--|==)\s+[^-=]+?\s*(-->|==>|---|===)/g;

/** Rough count of distinct nodes / participants in a Mermaid source. */
export function estimateMermaidNodes(text) {
  const nodes = new Set();
  const lines = String(text ?? '').split('\n').slice(1);
  for (const rawLine of lines) {
    const line = rawLine.replace(/%%.*$/, '').split(':')[0].replace(MERMAID_LABEL_RE, ' ')
      .replace(MERMAID_LINK_TEXT_RE, ' $2 ').trim();
    if (!line) continue;
    for (const part of line.split(MERMAID_ARROW_RE)) {
      for (const piece of part.split('&')) {
        const match = /^[A-Za-z0-9_][\w-]*/.exec(piece.trim());
        if (match && !MERMAID_KEYWORDS.has(match[0].toLowerCase())) nodes.add(match[0]);
      }
    }
  }
  return nodes.size;
}

/** Cap a ```mermaid fence body. Returns `{ source }` or `{ error }`. */
export function validateMermaidSource(text) {
  const source = String(text ?? '').replace(/\n$/, '');
  if (!source.trim()) return chartError('emptyDiagram');
  if (byteLength(source) > MERMAID_LIMITS.maxBytes) {
    return chartError('tooLarge', { limit: Math.round(MERMAID_LIMITS.maxBytes / 1000) });
  }
  const nodes = estimateMermaidNodes(source);
  if (nodes > MERMAID_LIMITS.maxNodes) {
    return chartError('tooManyNodes', { count: nodes, limit: MERMAID_LIMITS.maxNodes });
  }
  return { source };
}

// ── Theme ─────────────────────────────────────────────────────────────
// Charts draw on a canvas (Chart.js) or in an SVG with its own palette
// (Mermaid), so neither follows CSS tokens on its own. These read the app's
// tokens, resolved to concrete colours (a token can be a color-mix()).

const SERIES_TOKENS = ['--accent', '--sage-500', '--warn', '--frost-500', '--danger'];

function resolveToken(probe, name, fallback) {
  probe.style.color = '';
  probe.style.color = `var(${name}, ${fallback})`;
  return getComputedStyle(probe).color || fallback;
}

/** The app's current chart palette, read from its CSS tokens. */
export function readChartTheme(root = typeof document === 'undefined' ? null : document.body) {
  const fallback = {
    ink: '#0E0F10', ink2: '#3A3D40', ink3: '#6B6F73', line: '#E4E4E1', surface: '#FFFFFF',
    surface2: '#F4F4F4', accent: '#1F9CB0', fontBody: 'sans-serif', fontMono: 'monospace',
    series: ['#1F9CB0', '#5D9287', '#B45309', '#7D95A1', '#B91C1C'],
    dark: false,
  };
  if (!root) return fallback;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  root.appendChild(probe);
  try {
    const styles = getComputedStyle(root);
    const font = (name, fb) => styles.getPropertyValue(name).trim() || fb;
    return {
      ink: resolveToken(probe, '--ink', fallback.ink),
      ink2: resolveToken(probe, '--ink-2', fallback.ink2),
      ink3: resolveToken(probe, '--ink-3', fallback.ink3),
      line: resolveToken(probe, '--line', fallback.line),
      surface: resolveToken(probe, '--surface', fallback.surface),
      surface2: resolveToken(probe, '--surface-2', fallback.surface2),
      accent: resolveToken(probe, '--accent', fallback.accent),
      fontBody: font('--font-body', fallback.fontBody),
      fontMono: font('--font-mono', fallback.fontMono),
      series: SERIES_TOKENS.map((name, i) => resolveToken(probe, name, fallback.series[i])),
      dark: root.dataset?.theme === 'dark',
    };
  } finally {
    probe.remove();
  }
}

const PER_POINT_COLOR_TYPES = new Set(['pie', 'doughnut', 'polarArea']);

/**
 * Fill colours a config leaves unset from the theme: dataset colours from
 * the series palette (explicit ones are kept), text, grid and font from the
 * tokens. Pure; returns a new config.
 */
export function applyChartTheme(config, theme) {
  const type = config.type;
  const datasets = (config.data?.datasets || []).map((dataset, i) => {
    const colour = theme.series[i % theme.series.length];
    if (PER_POINT_COLOR_TYPES.has(dataset.type || type)) {
      const colours = (dataset.data || []).map((_, j) => theme.series[j % theme.series.length]);
      return {
        backgroundColor: colours,
        borderColor: theme.surface,
        ...dataset,
      };
    }
    return {
      backgroundColor: colour,
      borderColor: colour,
      ...dataset,
    };
  });
  // devicePixelRatio scales the canvas backing store: a large value from
  // the fence would allocate a huge canvas. The screen's ratio is used.
  const { devicePixelRatio: _ignoredRatio, ...options } = config.options || {};
  const scales = Object.fromEntries(Object.entries(options.scales || {}).map(([id, scale]) => [id, {
    ...scale,
    grid: { color: theme.line, ...scale?.grid },
    ticks: { color: theme.ink3, ...scale?.ticks },
    title: { color: theme.ink3, ...scale?.title },
  }]));
  return {
    ...config,
    data: { ...config.data, datasets },
    options: {
      color: theme.ink2,
      borderColor: theme.line,
      ...options,
      // The sized container owns the height; the chart fills it.
      responsive: true,
      maintainAspectRatio: false,
      font: { family: theme.fontBody, ...options.font },
      ...(Object.keys(scales).length ? { scales } : {}),
    },
  };
}

/** Mermaid `base` theme variables from the same tokens. */
export function mermaidThemeVariables(theme) {
  return {
    darkMode: theme.dark,
    background: theme.surface2,
    fontFamily: theme.fontBody,
    primaryColor: theme.surface,
    primaryTextColor: theme.ink,
    primaryBorderColor: theme.accent,
    secondaryColor: theme.surface2,
    tertiaryColor: theme.surface2,
    lineColor: theme.ink3,
    textColor: theme.ink2,
    mainBkg: theme.surface,
    nodeBorder: theme.accent,
    clusterBkg: theme.surface2,
    clusterBorder: theme.line,
    edgeLabelBackground: theme.surface2,
    actorBkg: theme.surface,
    actorBorder: theme.accent,
    actorTextColor: theme.ink,
    signalColor: theme.ink3,
    signalTextColor: theme.ink2,
    noteBkgColor: theme.surface2,
    noteTextColor: theme.ink2,
    noteBorderColor: theme.line,
  };
}

// ── Chart / diagram export ────────────────────────────────────────────

const EXPORT_PADDING = 16;

function loadSvgImage(svgEl) {
  const rect = svgEl.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.style.maxWidth = 'none';
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.width = width;
  img.height = height;
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  return img.decode().then(() => ({ image: img, width, height }));
}

/**
 * A PNG of the chart or diagram drawn in a chart block, on the block's own
 * background so it reads the same once pasted elsewhere. A Chart.js canvas
 * is copied as-is (what Chart's toBase64Image() reads); a Mermaid SVG is
 * rasterised at the screen's pixel ratio. Resolves null when nothing has
 * drawn yet.
 */
export async function chartBlockToPngBlob(block) {
  const canvasEl = block?.querySelector?.('.anton-chart-canvas canvas');
  const svgEl = block?.querySelector?.('.anton-mermaid-svg svg');
  let drawn;
  let scale = 1;
  if (canvasEl) {
    drawn = { image: canvasEl, width: canvasEl.width, height: canvasEl.height };
    scale = canvasEl.width / Math.max(1, canvasEl.clientWidth || canvasEl.width);
  } else if (svgEl) {
    scale = Math.max(1, window.devicePixelRatio || 1) * 2;
    const svg = await loadSvgImage(svgEl);
    drawn = { image: svg.image, width: svg.width * scale, height: svg.height * scale };
  } else {
    return null;
  }
  const pad = Math.round(EXPORT_PADDING * scale);
  const out = document.createElement('canvas');
  out.width = drawn.width + pad * 2;
  out.height = drawn.height + pad * 2;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = readChartTheme().surface2;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(drawn.image, pad, pad, drawn.width, drawn.height);
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
}
