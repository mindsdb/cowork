import { Laptop, RotateCcw } from 'lucide-react';
import { Icon } from '../components/ui/Icon';

import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { RadioGroup, Radio } from '../components/ui/RadioGroup';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import type { RecoveryOption, RecoveryPlan } from './api';
import { useTranslation } from '../../lib/i18n';


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
  const { t } = useTranslation('code');
  const selected = plan?.options.find((option) => option.computer.id === selectedComputerId) || null;
  return (
    <Modal
      open={!!plan}
      onClose={onClose}
      size="sm"
      width="min(520px, 92vw)"
      labelledBy="code-recovery-title"
      dismissible={!busy}
    >
      <ModalHeader
        id="code-recovery-title"
        title={t('recovery.title')}
        subtitle={t('recovery.subtitle')}
        onClose={onClose}
      />
      <ModalBody>
        <RadioGroup
          className="code-recovery-options"
          aria-label={t('recovery.computerAriaLabel')}
          value={selectedComputerId}
          onValueChange={onSelect}
          disabled={busy}
        >
          {plan?.options.map((option) => (
            <Radio
              key={option.computer.id}
              value={option.computer.id}
              variant="card"
              size="sm"
              indicator="end"
            >
              <span className="code-recovery-option__icon"><Icon of={Laptop} size={16} /></span>
              <span className="code-recovery-option__copy">
                <span className="code-recovery-option__title">
                  <strong>{option.computer.name}</strong>
                  {option.recommended && <Badge variant="muted" size="sm">{t('recovery.recommended')}</Badge>}
                </span>
                <span className="code-recovery-option__meta">
                  {platformName(option.computer.capabilities.platform)}
                  <span aria-hidden="true">·</span>
                  {option.mode === 'restore' ? t('recovery.savedCopy') : t('recovery.freshCopy')}
                </span>
                <span className="code-recovery-option__detail">{option.detail}</span>
              </span>
            </Radio>
          ))}
          {!plan?.options.length && (
            <div className="code-recovery-empty">
              <Icon of={RotateCcw} size={20} />
              <div><strong>{t('recovery.empty.title')}</strong><span>{t('recovery.empty.body')}</span></div>
            </div>
          )}
        </RadioGroup>
        {selected?.mode === 'recreate' && (
          <Alert variant="warning">
            {t('recovery.recreateWarning')}
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
      </ModalBody>
      <ModalFooter cancel={<Button variant="subtle" onClick={onClose} disabled={busy}>{t('recovery.cancel')}</Button>}>
        <Button variant="primary" onClick={() => selected && onConfirm(selected)} disabled={!selected || busy}>
          {busy ? t('recovery.reopening') : selected?.mode === 'recreate' ? t('recovery.startFresh') : t('recovery.title')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
