import { useEffect, useRef } from 'react';

function stripComments(str) {
  return String(str || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function parseConfig(str) {
  try {
    // Legacy chartjs accepts executable JavaScript object literals rather than strict JSON.
    // eslint-disable-next-line no-eval
    return eval('(' + stripComments(str) + ')');
  } catch (e) {
    console.error('[MessageChart] config parse error', e);
    return null;
  }
}

export function MessageChart({ id, text }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const config = parseConfig(text);
      if (!config || !canvasRef.current) return;
      const { Chart, registerables } = await import('chart.js');
      if (cancelled) return;
      Chart.register(...registerables);
      try {
        chartRef.current = new Chart(canvasRef.current.getContext('2d'), config);
        requestAnimationFrame(() => chartRef.current?.resize());
      } catch (e) {
        console.error('[MessageChart] render error', e);
      }
    })();
    return () => {
      cancelled = true;
      if (chartRef.current) {
        try { chartRef.current.destroy(); } catch {}
        chartRef.current = null;
      }
    };
  }, [text]);

  return (
    <div className="my-3 rounded-md border border-line bg-surface p-3" style={{ minHeight: 280 }}>
      <canvas id={id} ref={canvasRef} />
    </div>
  );
}
