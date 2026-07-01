// Title screen — the first thing a brand-new user sees (plays only
// until terms are accepted, then never again).
//
//   1. CRT power-on flash (700ms)
//   2. "MINDSDB PRESENTS" typewriter
//   3. COWORK logo + tagline + the cast walks on
//   4. blinking PRESS ⏎ TO START
//
// Any click or Enter skips straight to the end state; a second
// Enter/click advances. No forced sit-through.

import { useEffect, useState } from 'react';
import { ArcadeShell, PressPrompt, Typewriter } from './components';
import { PixelSprite } from './sprites';

type Stage = 'on' | 'presents' | 'title';

// Rotating "hand it off" demos — one per category of work (inbox,
// reports, calendar, CRM, automation) so consecutive examples never
// repeat a theme. Format borrowed from the CLI: a YOU> ask, then a
// terse past-tense receipt. Keep receipts to `✓ metric · dry aside`.
const DEMOS: { ask: string; receipt: string }[] = [
  { ask: 'clear my inbox',                  receipt: '✓ 1,000 emails triaged · noise unsubscribed' },
  { ask: 'send the weekly sales report',    receipt: '✓ numbers pulled · sent · every Friday now' },
  { ask: 'prep me for tomorrow’s meetings',  receipt: '✓ 3 briefs written · awkward question predicted' },
  { ask: 'update the CRM from my emails',   receipt: '✓ 12 deals updated · 2 going cold — flagged' },
  { ask: 'do this again every Monday at 9', receipt: '✓ scheduled · done before your coffee' },
];

const RECEIPT_HOLD_MS = 3400;

/** Types the YOU> ask, pops the ✓ receipt, holds, then rotates.
    (Typewriter itself honors prefers-reduced-motion — full text, no
    crawl — so rotation still works for reduced-motion users.) */
function DemoTicker() {
  const [idx, setIdx] = useState(0);
  const [showReceipt, setShowReceipt] = useState(false);
  const demo = DEMOS[idx % DEMOS.length];

  useEffect(() => {
    if (!showReceipt) return;
    const t = setTimeout(() => {
      setShowReceipt(false);
      setIdx((i) => (i + 1) % DEMOS.length);
    }, RECEIPT_HOLD_MS);
    return () => clearTimeout(t);
  }, [showReceipt]);

  // Each line is centered individually — like the tagline above — so every
  // frame is balanced no matter how short the ask. A hidden sizer reserves
  // the finished ask's width (caret included) up front, so the line types
  // left-to-right inside an already-centered slot with zero wobble.
  return (
    <div
      aria-label={`${demo.ask} — ${demo.receipt}`}
      style={{ width: '100%', textAlign: 'center', fontSize: 13, letterSpacing: '0.04em' }}
    >
      <div style={{ whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-grid', textAlign: 'left' }}>
          <span aria-hidden style={{ gridArea: '1 / 1', visibility: 'hidden' }}>
            <span style={{ fontWeight: 700 }}>YOU&gt;&nbsp;</span>
            {demo.ask}
            <span className="arc-caret" />
          </span>
          <span style={{ gridArea: '1 / 1' }}>
            <span style={{ color: 'var(--arc-cyan)', fontWeight: 700 }}>YOU&gt;&nbsp;</span>
            <Typewriter
              key={idx}
              text={demo.ask}
              speed={34}
              onDone={() => setShowReceipt(true)}
              style={{ color: 'var(--arc-ink)' }}
            />
          </span>
        </span>
      </div>
      <div style={{ marginTop: 7, fontSize: 11.5, whiteSpace: 'nowrap', minHeight: 16 }}>
        {showReceipt && (
          <span className="arc-fade-in" style={{ color: 'var(--arc-green)' }}>{demo.receipt}</span>
        )}
      </div>
    </div>
  );
}

export default function TitleScreen({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState<Stage>('on');

  useEffect(() => {
    if (stage === 'on') {
      const t = setTimeout(() => setStage('presents'), 750);
      return () => clearTimeout(t);
    }
  }, [stage]);

  // Click anywhere fast-forwards the intro beats to the title.
  const skipToTitle = () => setStage((s) => (s === 'title' ? s : 'title'));

  // Enter (or Space/Esc) during the intro beats also fast-forwards.
  useEffect(() => {
    if (stage === 'title') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') skipToTitle();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stage]);

  return (
    <div onClick={stage !== 'title' ? skipToTitle : undefined}>
      <ArcadeShell>
        <div className={stage === 'on' ? 'arc-crt-on' : undefined} style={{ width: '100%' }}>
          {stage === 'presents' && (
            <div className="arc-stack" style={{ gap: 8, minHeight: 320, justifyContent: 'center' }}>
              <Typewriter
                text="MINDSDB PRESENTS"
                speed={55}
                onDone={() => setTimeout(() => setStage('title'), 600)}
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: '0.3em',
                  color: 'var(--arc-muted)',
                }}
              />
            </div>
          )}

          {(stage === 'on' || stage === 'title') && (
            <div className="arc-stack" style={{ gap: 0 }}>
              <div className={stage === 'title' ? 'arc-fade-in' : undefined}>
                <div className="arc-title-logo">COWORK</div>
                <div className="arc-title-rule" />
              </div>

              <div className="arc-tagline arc-fade-in" style={{ marginTop: 30, animationDelay: '120ms' }}>
                PUT AI AGENTS TO WORK.
              </div>

              {/* Rotating "hand it off" work demos (CLI-style ask → receipt) */}
              <div className="arc-fade-in" style={{ marginTop: 26, animationDelay: '200ms', display: 'flex', justifyContent: 'center' }}>
                <DemoTicker />
              </div>

              <div
                className="arc-fade-in"
                style={{ display: 'flex', gap: 26, marginTop: 26, alignItems: 'flex-end', animationDelay: '240ms' }}
              >
                <PixelSprite name="anton" size={52} bob title="Anton" />
                <PixelSprite name="hermes" size={52} bob title="Hermes" style={{ animationDelay: '0.4s' }} />
                <PixelSprite name="openclaw" size={52} bob title="OpenClaw" style={{ animationDelay: '0.8s' }} />
                <PixelSprite name="mystery" size={52} bob title="???" style={{ animationDelay: '1.2s' }} />
              </div>

              <div
                className="arc-fade-in"
                style={{
                  marginTop: 30,
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  color: 'var(--arc-dim)',
                  animationDelay: '360ms',
                }}
              >
                your tools &nbsp;&middot;&nbsp; your data &nbsp;&middot;&nbsp; your model &nbsp;&middot;&nbsp; open source
              </div>

              <div style={{ marginTop: 36 }}>
                <PressPrompt label="PRESS ⏎ TO START" onPress={onComplete} />
              </div>
            </div>
          )}
        </div>
      </ArcadeShell>
    </div>
  );
}
