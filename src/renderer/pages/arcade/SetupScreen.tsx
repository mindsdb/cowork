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

export default function SetupScreen({ onComplete }: { onComplete: (installedBackend: boolean) => void }) {
  const [phase, setPhase] = useState<'confirm' | 'installing' | 'done' | 'error'>('confirm');
  const [installBackend, setInstallBackend] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);
  const [logs, setLogs] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const failedStep = steps.find((s) => s.status === 'error');

  const handleContinue = () => {
    setPhase('installing');
    void host.startInstall(installBackend);
  };

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
    await host.startInstall(installBackend);
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    await host.cancelInstall();
    setLogs((prev) => `${prev}\nCancelling installation...\n`);
  };

  const doneCount = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const progress = phase === 'done' ? 1 : steps.length ? doneCount / steps.length : 0.05;

  if (phase === 'confirm') {
    return (
      <ArcadeShell title="LOADING WORLD" subtitle="ready when you are">
        <div className="arc-stack arc-fade-in" style={{ gap: 22, width: 'min(540px, 100%)' }}>
          <PixelSprite name="wrench" size={56} title="Installing" />

          <div className="arc-panel" style={{ width: '100%', boxSizing: 'border-box', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Not a <label>: matches TermsScreen's .arc-check pattern —
                the row toggles via onClick, the input stopPropagates. */}
            <div className="arc-check" onClick={() => setInstallBackend((v) => !v)}>
              <input
                type="checkbox"
                checked={installBackend}
                onChange={(e) => setInstallBackend(e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                aria-label="Install backend server"
              />
              <span className="arc-check-box" aria-hidden>{installBackend ? '✓' : ''}</span>
              <span className="arc-check-text">Install backend server</span>
            </div>
            <div style={{ fontSize: 10.5, letterSpacing: '0.05em', color: 'var(--arc-dim)', lineHeight: 1.6 }}>
              MindsHub Cowork can run without installing a local backend — uncheck
              this to point the app at a server running elsewhere instead. You'll
              be able to fill in its address as soon as setup finishes.
            </div>
          </div>

          <button className="arc-btn" style={{ width: '100%' }} onClick={handleContinue}>
            {installBackend ? 'INSTALL & CONTINUE ▶' : 'CONTINUE WITHOUT A BACKEND ▶'}
          </button>
        </div>
      </ArcadeShell>
    );
  }

  if (phase === 'done') {
    return (
      <ArcadeShell title="LOADING WORLD" subtitle="installing the engine">
        <DoneScreen onComplete={() => onComplete(installBackend)} />
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
