import { useState, useEffect, useRef } from 'react';

interface Step {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'warning';
}

const STEP_ICONS: Record<string, string> = {
  pending: '',
  running: '',
  done: '\u2713',
  error: '\u2717',
  skipped: '-',
  warning: '!',
};

export default function Setup({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<'ready' | 'installing' | 'done' | 'error'>('ready');
  const [steps, setSteps] = useState<Step[]>([]);
  const [logs, setLogs] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const failedStep = steps.find((step) => step.status === 'error');

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      window.antontron.onInstallProgress((newSteps) => {
        setSteps(newSteps);
      })
    );

    unsubs.push(
      window.antontron.onInstallLog((msg) => {
        setLogs((prev) => prev + msg);
      })
    );

    unsubs.push(
      window.antontron.onInstallDone(() => {
        setIsCancelling(false);
        setPhase('done');
      })
    );

    unsubs.push(
      window.antontron.onInstallError((err) => {
        setIsCancelling(false);
        setPhase('error');
        setErrorMsg(err);
      })
    );

    unsubs.push(
      window.antontron.onInstallCancelled(() => {
        setIsCancelling(false);
        setPhase('ready');
        setErrorMsg('');
      })
    );

    return () => unsubs.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const handleInstall = async () => {
    setIsCancelling(false);
    setPhase('installing');
    setLogs('');
    setErrorMsg('');
    await window.antontron.startInstall();
  };

  const handleCancel = async () => {
    setIsCancelling(true);
    await window.antontron.cancelInstall();
    setLogs((prev) => `${prev}\nCancelling installation...\n`);
  };

  return (
    <div className={`setup-content ${phase === 'installing' || phase === 'error' ? 'setup-content-compact' : ''}`}>
      {phase === 'ready' && (
        <div className="setup-actions">
          <button className="btn-primary" onClick={handleInstall}>
            SETUP ANTON
          </button>
        </div>
      )}

      {phase === 'ready' && (
        <div className="setup-note">
          To continue, we need to install and prepare all required system dependencies. This will take just a few minutes.
        </div>
      )}

      {(phase === 'installing' || phase === 'error') && (
        <>
          <div className="steps-panel">
            {steps.map((step) => (
              <div className="step-row" key={step.id} data-status={step.status}>
                <div className="step-icon">
                  {step.status === 'running' ? (
                    <div className="spinner" />
                  ) : (
                    STEP_ICONS[step.status]
                  )}
                </div>
                <div className="step-label">{step.label}</div>
              </div>
            ))}
          </div>
          {phase === 'error' && (
            <>
              {failedStep && (
                <div className="error-context">
                  Failed at step: <strong>{failedStep.label}</strong>
                </div>
              )}
              <div className="error-message">{errorMsg}</div>
              <div className="setup-actions">
                <button className="btn-secondary" onClick={handleInstall}>
                  Retry
                </button>
              </div>
            </>
          )}

          <div className="log-panel" ref={logRef}>
            <pre>{logs}</pre>
          </div>

          {phase === 'installing' && (
            <div className="setup-actions">
              <button className="btn-secondary" onClick={handleCancel} disabled={isCancelling}>
                {isCancelling ? 'Cancelling...' : 'Cancel install'}
              </button>
            </div>
          )}
        </>
      )}

      {phase === 'done' && <DoneScreen onComplete={onComplete} />}
    </div>

  );
}

function useTypewriter(text: string, speed: number = 40): string {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    setDisplayed('');
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(interval);
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);
  return displayed;
}

function DoneScreen({ onComplete }: { onComplete: () => void }) {
  const typed = useTypewriter("Now let's teach Anton who to talk to...", 35);
  const [showContinue, setShowContinue] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowContinue(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (showContinue) {
      const auto = setTimeout(onComplete, 1500);
      return () => clearTimeout(auto);
    }
  }, [showContinue, onComplete]);

  return (
    <>
      <div className="success-section">
        <div className="success-check">{'\u2713'}</div>
        <div className="success-text">Anton is installed</div>
        <div className="typewriter-line">
          {typed}
          <span className="typewriter-cursor">|</span>
        </div>
      </div>
    </>
  );
}
