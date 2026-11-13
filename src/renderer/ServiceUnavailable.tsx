import OrbitMorph from './cowork/components/ui/OrbitMorph';
import { useTranslation } from './lib/i18n';

interface Props {
  unconfigured: boolean;
  retrying: boolean;
  onRetry: () => void;
}

export default function ServiceUnavailable({ unconfigured, retrying, onRetry }: Props) {
  const { t } = useTranslation('app');
  return (
    <div
      className="arc-root welcome-loading"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 18, padding: 24, textAlign: 'center' }}
    >
      <OrbitMorph state="thinking" size={72} />
      <div className="arc-welcome-title" role="status">
        {unconfigured ? t('shell.serviceUnconfiguredTitle') : t('shell.serviceUnavailableTitle')}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--arc-muted)', maxWidth: 380 }}>
        {unconfigured
          ? t('shell.serviceUnconfiguredBody')
          : t('shell.serviceUnavailableBody')}
      </div>
      <button className="arc-btn" disabled={retrying} onClick={onRetry}>
        {retrying ? t('shell.retrying') : t('shell.tryAgain')}
      </button>
    </div>
  );
}
