// Daily views as a bar chart. chart.js loads lazily, as in MessageChart.

import { useEffect, useRef } from 'react';

// Canvas cannot resolve var(). Theme tokens are defined on body, not :root,
// so they are read from the canvas itself, which inherits them.
function themeColor(element, name, fallback) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value || fallback;
}

// Stable default: the chart rebuilds whenever `daily` changes identity.
const NO_DAYS = [];

export function StatsChart({ daily = NO_DAYS }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let chart = null;
    (async () => {
      const { Chart, registerables } = await import('chart.js');
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      Chart.register(...registerables);
      const bar = themeColor(canvas, '--accent', '#1F9CB0');
      const ink = themeColor(canvas, '--ink-4', '#9B9FA3');
      const grid = themeColor(canvas, '--line', '#E4E4E1');
      chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: daily.map((day) => day.date.slice(5)),
          datasets: [{
            data: daily.map((day) => day.views),
            backgroundColor: bar,
            borderRadius: 2,
            maxBarThickness: 10,
          }],
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: { title: (items) => daily[items[0]?.dataIndex]?.date || '' },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: ink, maxTicksLimit: 6, maxRotation: 0 } },
            y: { beginAtZero: true, grid: { color: grid }, ticks: { color: ink, precision: 0 } },
          },
        },
      });
    })().catch((e) => console.error('[StatsChart] render error', e));
    return () => {
      cancelled = true;
      if (chart) {
        try { chart.destroy(); } catch { /* already torn down */ }
        chart = null;
      }
    };
  }, [daily]);

  // Chart.js responsive mode sizes the canvas from a positioned parent.
  return (
    <div className="relative h-[120px]">
      <canvas ref={canvasRef} role="img" aria-label="Views per day" />
    </div>
  );
}

export default StatsChart;
