// "NOW LOADING" — the beat between onboarding and the cowork shell.
// Shows the COWORK wordmark with "now playing: <coworker>" while the
// progress bar fills, then hands off to the terminal.

import { useEffect, useState } from 'react';
import { ArcadeShell, PixelProgress } from './components';

export default function LaunchScreen({
  coworkerLabel,
  durationMs = 2200,
  onDone,
}: {
  coworkerLabel: string;
  durationMs?: number;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / durationMs);
      // chunky steps, not a smooth tween
      setProgress(Math.round(t * 12) / 12);
      if (t >= 1) clearInterval(id);
    }, 80);
    return () => clearInterval(id);
  }, [durationMs]);

  useEffect(() => {
    const t = setTimeout(onDone, durationMs + 350);
    return () => clearTimeout(t);
  }, [durationMs, onDone]);

  return (
    <ArcadeShell>
      <div className="arc-stack arc-fade-in" style={{ gap: 0 }}>
        <div className="arc-title-logo" style={{ fontSize: 'clamp(44px, 8vw, 72px)' }}>COWORK</div>
        <div className="arc-title-rule" />
        <div className="arc-tagline" style={{ marginTop: 26, fontSize: 14 }}>ONE APP. ANY AGENT.</div>
        <div style={{ marginTop: 18, fontSize: 12.5, letterSpacing: '0.1em', color: 'var(--arc-muted)' }}>
          now playing:{' '}
          <span style={{ color: 'var(--arc-green)', fontWeight: 700 }}>{coworkerLabel.toUpperCase()}</span>
        </div>
        <PixelProgress value={progress} cells={20} style={{ width: 300, marginTop: 30 }} />
        <div className="arc-blink" style={{ marginTop: 16, fontSize: 10.5, letterSpacing: '0.16em', color: 'var(--arc-dim)' }}>
          NOW LOADING…
        </div>
      </div>
    </ArcadeShell>
  );
}
