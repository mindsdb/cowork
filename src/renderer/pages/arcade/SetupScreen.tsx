// Install/setup, arcade edition — "LOADING WORLD". Identical host
// wiring to the old Setup page (startInstall + progress/log/done/error/
// cancelled events); the steps render as a quest log with a chunky
// progress bar and a green-phosphor console underneath.

import { useState, useEffect, useRef } from 'react';
import { host } from '../../platform/host';
import { ArcadeShell, PixelProgress, Typewriter } from './components';
import { PixelSprite } from './sprites';

interface Step {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'warning';
}

const STEP_GLYPHS: Record<Step['status'], string> = {
  pending: '·',
  running: '▶',
  done: '✓',
  error: '✗',
  skipped: '−',
  warning: '!',
};

export default function SetupScreen({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'installing' | 'done' | 'error'>('installing');
  const [steps, setSteps] = useState<Step[]>([]);
  const [logs, setLogs] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const failedStep = steps.find((s) => s.status === 'error');

  useEffect(() => {
    void host.startInstall();
  }, []);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    unsubs.push(host.onInstallProgress((s) => setSteps(s as Step[])));
    unsubs.push(host.onInstallLog((msg) => setLogs((prev) => prev + msg)));
    unsubs.push(host.onInstallDone(() => { setIsCancelling(false); setPhase('done'); }));
    unsubs.push(host.onInstallError((err) => { setIsCancelling(false); setPhase('error'); setErrorMsg(err); }));
    unsubs.push(host.onInstallCancelled(() => {
      setIsCancelling(false);
      setPhase('error');
      setErrorMsg('Installation cancelled.');
    }));
    return () => unsubs.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const handleRetry = async () => {
    setIsCancelling(false);
    setPhase('installing');
    setLogs('');
    setErrorMsg('');
    await host.startInstall();
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    await host.cancelInstall();
    setLogs((prev) => `${prev}\nCancelling installation...\n`);
  };

  const doneCount = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const progress = phase === 'done' ? 1 : steps.length ? doneCount / steps.length : 0.05;

  if (phase === 'done') {
    return (
      <ArcadeShell title="LOADING WORLD" subtitle="installing the engine">
        <DoneScreen onComplete={onComplete} />
      </ArcadeShell>
    );
  }

  return (
    <ArcadeShell title="LOADING WORLD" subtitle="installing the engine">
      <div className="arc-stack arc-fade-in" style={{ gap: 22, width: 'min(540px, 100%)' }}>
        <PixelSprite name="wrench" size={56} title="Installing" />

        <PixelProgress value={progress} style={{ width: '100%', boxSizing: 'border-box' }} />

        <div className="arc-panel" style={{ width: '100%', boxSizing: 'border-box', padding: '12px 18px' }}>
          {steps.length === 0 && (
            <div className="arc-quest-row" data-status="running">
              <span className="arc-quest-icon arc-blink">▶</span>
              <span>Preparing install…</span>
            </div>
          )}
          {steps.map((step) => (
            <div className="arc-quest-row" data-status={step.status} key={step.id}>
              <span className={`arc-quest-icon ${step.status === 'running' ? 'arc-blink' : ''}`}>
                {STEP_GLYPHS[step.status]}
              </span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>

        {phase === 'error' && (
          <>
            <div className="arc-error" role="alert">
              <span style={{ fontWeight: 700, flex: 'none' }}>✗</span>
              <span>
                {failedStep ? <>Failed at: <strong>{failedStep.label}</strong>. </> : null}
                {errorMsg}
              </span>
            </div>
            <button className="arc-btn" onClick={handleRetry}>↻ TRY AGAIN</button>
          </>
        )}

        <div className="arc-console" ref={logRef}>
          <pre>{logs || '> boot sequence started…'}</pre>
        </div>

        {phase === 'installing' && (
          <button className="arc-btn-ghost" onClick={handleCancel} disabled={isCancelling}>
            {isCancelling ? 'CANCELLING…' : 'CANCEL INSTALL'}
          </button>
        )}
      </div>
    </ArcadeShell>
  );
}

function DoneScreen({ onComplete }: { onComplete: () => void }) {
  // Linger long enough to read the payoff, then auto-advance — same
  // pacing contract as the old Setup DoneScreen.
  useEffect(() => {
    const t = setTimeout(onComplete, 3200);
    return () => clearTimeout(t);
  }, [onComplete]);

  return (
    <div className="arc-stack arc-pop" style={{ gap: 20 }}>
      <PixelSprite name="coin" size={64} title="Setup complete" />
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--arc-green)' }}>
        SETUP COMPLETE!
      </div>
      <div style={{ fontSize: 12, letterSpacing: '0.08em', color: 'var(--arc-muted)' }}>
        <Typewriter text="Now choose your coworker…" speed={35} />
      </div>
    </div>
  );
}
