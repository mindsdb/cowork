import { diagnostic } from '../../../../shared/diagnostics';
// Per-instance Chart.js canvas. Adapted from mdb-ai's MessageChart +
// ChartsService — kept as a self-contained component so we don't need a
// global singleton: each MessageChart owns its Chart instance and tears
// it down on unmount.
//
// It draws a config MarkdownCode already parsed and capped
// (parseChartConfig in ./utils): the fence is model output and is never
// evaluated.

import { useEffect, useRef, useState } from 'react';
import { CHART_HEIGHT, ChartErrorState } from './ChartStates';
import { applyChartTheme, readChartTheme } from './utils';
import { useTranslation } from '../../../lib/i18n';

/* Bumps whenever the app's theme, skin or custom accent changes (they live
   on body: data-theme, data-skin, and the inline accent style), so a
   drawing made from the tokens can redraw in the new palette. Same body
   observer the terminal and browser panel use. */
export function useThemeVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'data-skin', 'style'] });
    return () => observer.disconnect();
  }, []);
  return version;
}

export function MessageChart({ config }) {
  const { t } = useTranslation('chat');
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const themeVersion = useThemeVersion();
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Chart, registerables } = await import('chart.js');
      if (cancelled || !canvasRef.current) return;
      Chart.register(...registerables);
      const theme = readChartTheme();
      // Scales a config doesn't declare resolve their colours from the
      // global defaults, so those follow the theme too.
      Chart.defaults.color = theme.ink2;
      Chart.defaults.borderColor = theme.line;
      Chart.defaults.font.family = theme.fontBody;
      try {
        // responsive: Chart.js sizes the canvas to the container below
        // through its own ResizeObserver.
        chartRef.current = new Chart(canvasRef.current, applyChartTheme(config, theme));
      } catch (e) {
        diagnostic('renderer.cowork.components.markdown.MessageChart', 'ERROR', 'messagechart_render_error', '[MessageChart] render error', e);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (chartRef.current) {
        try { chartRef.current.destroy(); } catch {}
        chartRef.current = null;
      }
    };
  }, [config, themeVersion]);

  if (error) return <ChartErrorState error={error} />;
  const title = config?.options?.plugins?.title?.text;
  return (
    <div className="anton-chart-canvas" style={{ position: 'relative', height: CHART_HEIGHT }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={typeof title === 'string' && title ? title : t('markdown.chart.chartLabel')}
      />
    </div>
  );
}
