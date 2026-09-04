import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Minus } from 'lucide-react';

import { host, type InstallStep } from '../../platform/host';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';

type Phase = 'running' | 'done' | 'error' | 'cancelled';

const MAX_LOG_LINES = 300;


function StepGlyph({ status }: { status: InstallStep['status'] }) {
  if (status === 'running') return <Spinner className="text-xs" />;
  if (status === 'done') return <Check size={13} strokeWidth={2} aria-hidden="true" />;
  if (status === 'error') return <CircleAlert size={13} strokeWidth={2} aria-hidden="true" />;
  if (status === 'warning') return <CircleAlert size={13} strokeWidth={2} aria-hidden="true" />;
  return <Minus size={13} strokeWidth={2} aria-hidden="true" />;
}


/**
 * Installs what Code Mode needs the first time it is switched on: the coding
 * agent's components (over 100 MB, so not part of the first install) and,
 * where this computer lacks it, Git. Streams the steps and the installer's
 * output; on success the caller enables Code Mode.
 */
export function CodeSetupModal({ open, onClose, onComplete }: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [steps, setSteps] = useState<InstallStep[]>([]);
  const [log, setLog] = useState<string[]>([]);
  // Output arrives in chunks that end mid-line; keep the partial line so a
  // package name is never split across two lines of the log.
  const partialLine = useRef('');
  const [phase, setPhase] = useState<Phase>('running');
  const [error, setError] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    setSteps([]);
    setLog([]);
    partialLine.current = '';
    setPhase('running');
    setError('');
    const unsubscribe = [
      host.onCodeSetupProgress((next) => setSteps(next)),
      host.onCodeSetupLog((text) => {
        const pieces = (partialLine.current + text).split('\n');
        partialLine.current = pieces.pop() ?? '';
        const complete = pieces.map((line) => line.trimEnd()).filter(Boolean);
        if (complete.length) setLog((current) => [...current, ...complete].slice(-MAX_LOG_LINES));
      }),
      host.onCodeSetupDone(() => setPhase('done')),
      host.onCodeSetupError((message) => { setError(message); setPhase('error'); }),
      host.onCodeSetupCancelled(() => setPhase('cancelled')),
    ];
    // The outcome arrives through the events above; the returned boolean is
    // not trusted, since a start refused because a run is already active (as
    // React's development double-effect causes) is not a failure.
    void host.startCodeSetup().catch(() => {
      setError('Setup could not start. Restart the app, then try again.');
      setPhase('error');
    });
    return () => { for (const off of unsubscribe) off(); };
  }, [open, attempt]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const running = phase === 'running';
  const failedStep = steps.find((step) => step.status === 'error');

  return (
    <Modal
      open={open}
      onClose={running ? () => {} : onClose}
      size="sm"
      width="min(520px, 92vw)"
      labelledBy="code-setup-title"
      closeOnBackdrop={!running}
      closeOnEsc={!running}
    >
      <ModalHeader
        id="code-setup-title"
        title="Set up Code Mode"
        subtitle="Downloads the coding agent, about 110 MB, and Git if this computer has none. One time only."
        onClose={running ? undefined : onClose}
      />
      <ModalBody padding="18px">
        <ol className="code-setup-steps" aria-label="Setup steps">
          {steps.length === 0 && <li className="code-setup-step" data-status="running"><span className="code-setup-step__glyph"><Spinner className="text-xs" /></span><span>Preparing…</span></li>}
          {steps.map((step) => (
            <li key={step.id} className="code-setup-step" data-status={step.status}>
              <span className="code-setup-step__glyph" aria-hidden="true"><StepGlyph status={step.status} /></span>
              <span className="code-setup-step__text">
                <span>{step.label}</span>
                {step.hint && <span className="code-setup-step__hint">{step.hint}</span>}
              </span>
              <span className="code-setup-step__state">{step.status === 'running' ? 'In progress' : step.status === 'done' ? 'Done' : step.status === 'error' ? 'Failed' : step.status === 'warning' ? 'Check' : step.status === 'skipped' ? 'Skipped' : ''}</span>
            </li>
          ))}
        </ol>
        {phase === 'done' && <Alert variant="success">Code Mode is ready on this computer.</Alert>}
        {phase === 'error' && (
          <Alert variant="danger">{error || (failedStep ? `${failedStep.label} did not finish.` : 'Setup did not finish.')}</Alert>
        )}
        {phase === 'cancelled' && <Alert variant="info">Setup was cancelled. Nothing was changed on this computer.</Alert>}
        <button type="button" className="code-setup-log-toggle" onClick={() => setShowLog((current) => !current)} aria-expanded={showLog}>
          {showLog ? 'Hide details' : 'Show details'}
        </button>
        {showLog && (
          <pre ref={logRef} className="code-setup-log" aria-label="Setup output">{log.join('\n') || 'Waiting for output…'}</pre>
        )}
      </ModalBody>
      <ModalFooter>
        {running && <Button variant="subtle" onClick={() => void host.cancelCodeSetup()}>Cancel</Button>}
        {phase === 'done' && <Button variant="primary" onClick={onComplete}>Open Code Mode</Button>}
        {(phase === 'error' || phase === 'cancelled') && (
          <>
            <Button variant="subtle" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => setAttempt((current) => current + 1)}>Try again</Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
