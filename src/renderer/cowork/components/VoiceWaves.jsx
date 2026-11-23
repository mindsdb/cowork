import { useEffect, useRef } from 'react';

/* The voice call's sound waves (VoiceCallWindow). Each voice's frequencies,
   mirrored out from the middle, lowest in the centre: Anton's in the accent,
   the person's in ink behind it. With nobody talking the line breathes, and
   while Anton works a pulse runs out from the middle. In the dark theme the
   accent glows. The 8-bit skin draws them as stacked pixel blocks.

   `meters` is useVoiceCall's ref of AnalyserNodes ({agent, user}); either can
   be missing (no Web Audio, or the voice hasn't arrived yet). */

const BARS = 21; // each side of the middle
const HEIGHT = 44;

function readLevels(analyser, buffer, out) {
  if (!analyser) { out.fill(0); return; }
  analyser.getByteFrequencyData(buffer);
  // Speech lives in the lower bins: spread BARS bands over them, log-spaced.
  const top = Math.min(buffer.length, 72);
  for (let i = 0; i < BARS; i += 1) {
    const from = Math.floor(2 + (top - 2) * ((i / BARS) ** 1.6));
    const to = Math.max(from + 1, Math.floor(2 + (top - 2) * (((i + 1) / BARS) ** 1.6)));
    let sum = 0;
    for (let b = from; b < to; b += 1) sum += buffer[b];
    out[i] = (sum / (to - from)) / 255;
  }
}

function colorOf(el, name, fallback) {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

export default function VoiceWaves({ meters, active = true, working = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return undefined;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const buffer = new Uint8Array(128);
    const agentNow = new Float32Array(BARS);
    const userNow = new Float32Array(BARS);
    const agentShown = new Float32Array(BARS);
    const userShown = new Float32Array(BARS);
    let frame = 0;

    const draw = (time) => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 260;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(HEIGHT * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, HEIGHT);

      readLevels(active ? meters?.current?.agent : null, buffer, agentNow);
      readLevels(active ? meters?.current?.user : null, buffer, userNow);
      for (let i = 0; i < BARS; i += 1) {
        agentShown[i] += (agentNow[i] - agentShown[i]) * 0.35;
        userShown[i] += (userNow[i] - userShown[i]) * 0.35;
      }

      const pixel = document.body?.dataset?.skin === '8bit';
      const accent = colorOf(canvas, '--accent', '#53aeca');
      const ink = colorOf(canvas, '--ink-2', '#5b6170');
      const dark = document.body?.dataset?.theme === 'dark';
      const gap = pixel ? 2 : 3;
      const step = (width / 2) / BARS;
      const barWidth = Math.max(2, step - gap);
      const mid = width / 2;
      const t = time / 1000;

      const layer = (levels, color, alpha, breathe) => {
        ctx.fillStyle = color;
        for (let i = 0; i < BARS; i += 1) {
          // The breath: a slow ripple out from the middle, under any voice.
          let idle = breathe && !still ? 0.06 + 0.04 * Math.sin(t * 2.2 - i * 0.45) : 0.06;
          // Working: a pulse that runs out from the middle, every 1.6 s.
          if (breathe && working && !still) {
            const front = ((t % 1.6) / 1.6) * (BARS + 6);
            idle += 0.42 * Math.exp(-((i - front) ** 2) / 6);
          }
          const level = Math.min(1, Math.max(idle, levels[i] * (1.15 - i * 0.012)));
          let h = Math.max(2, level * (HEIGHT - 4));
          if (pixel) h = Math.max(4, Math.round(h / 4) * 4);
          const y = (HEIGHT - h) / 2;
          ctx.globalAlpha = alpha * (pixel ? 1 : 0.55 + 0.45 * (1 - i / BARS));
          for (const side of [-1, 1]) {
            const x = side < 0 ? mid - (i + 1) * step + gap / 2 : mid + i * step + gap / 2;
            if (pixel) {
              for (let block = 0; block < h; block += 4) ctx.fillRect(Math.round(x), Math.round(y + block), Math.round(barWidth), 3);
            } else {
              const r = Math.min(barWidth / 2, h / 2);
              ctx.beginPath();
              ctx.roundRect ? ctx.roundRect(x, y, barWidth, h, r) : ctx.rect(x, y, barWidth, h);
              ctx.fill();
            }
          }
        }
        ctx.globalAlpha = 1;
      };
      layer(userShown, ink, 0.45, false);
      if (dark && !pixel) { ctx.shadowColor = accent; ctx.shadowBlur = 8; }
      layer(agentShown, accent, 1, true);
      ctx.shadowBlur = 0;

      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [meters, active, working]);

  return <canvas ref={canvasRef} className="voice-waves" height={HEIGHT} aria-hidden="true" />;
}
