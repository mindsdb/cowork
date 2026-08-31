import { Laptop, RotateCcw } from 'lucide-react';

import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import type { RecoveryOption, RecoveryPlan } from './api';


function platformName(platform: RecoveryOption['computer']['capabilities']['platform']): string {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'windows') return 'Windows';
  return 'Linux';
}


export function RecoveryModal({
  plan,
  selectedComputerId,
  busy,
  error,
  onSelect,
  onClose,
  onConfirm,
}: {
  plan: RecoveryPlan | null;
  selectedComputerId: string;
  busy: boolean;
  error: string;
  onSelect: (computerId: string) => void;
  onClose: () => void;
  onConfirm: (option: RecoveryOption) => void;
}) {
  const selected = plan?.options.find((option) => option.computer.id === selectedComputerId) || null;
  return (
    <Modal
      open={!!plan}
      onClose={onClose}
      size="sm"
      width="min(520px, 92vw)"
      labelledBy="code-recovery-title"
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
      <ModalHeader
        id="code-recovery-title"
        title="Resume task"
        subtitle="Choose where this task should continue."
        onClose={busy ? undefined : onClose}
      />
      <ModalBody>
        <div className="code-recovery-options" role="radiogroup" aria-label="Computer for resumed task">
          {plan?.options.map((option) => {
            const active = option.computer.id === selectedComputerId;
            return (
              <button
                type="button"
                key={option.computer.id}
                role="radio"
                aria-checked={active}
                className={`code-recovery-option${active ? ' is-selected' : ''}`}
                onClick={() => onSelect(option.computer.id)}
                disabled={busy}
              >
                <span className="code-recovery-option__icon"><Laptop size={17} strokeWidth={1.6} /></span>
                <span className="code-recovery-option__copy">
                  <span className="code-recovery-option__title">
                    <strong>{option.computer.name}</strong>
                    {option.recommended && <span className="code-recovery-option__recommended">Recommended</span>}
                  </span>
                  <span className="code-recovery-option__meta">
                    {platformName(option.computer.capabilities.platform)}
                    <span aria-hidden="true">·</span>
                    {option.mode === 'restore' ? 'Resume workspace' : 'Fresh workspace'}
                  </span>
                  <span className="code-recovery-option__detail">{option.detail}</span>
                </span>
                <span className="code-recovery-option__radio" aria-hidden="true" />
              </button>
            );
          })}
          {!plan?.options.length && (
            <div className="code-recovery-empty">
              <RotateCcw size={18} strokeWidth={1.5} />
              <div><strong>No compatible computer is online</strong><span>Bring the original computer online or connect another compatible computer.</span></div>
            </div>
          )}
        </div>
        {selected?.mode === 'recreate' && (
          <Alert variant="warning">
            This starts from the saved repository revisions. Unpushed changes on the previous computer cannot move with the task.
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => selected && onConfirm(selected)} disabled={!selected || busy}>
          {busy ? 'Resuming…' : selected?.mode === 'recreate' ? 'Start fresh workspace' : 'Resume task'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
