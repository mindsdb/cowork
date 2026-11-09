import OrbitMorph from './cowork/components/ui/OrbitMorph';

interface Props {
  unconfigured: boolean;
  retrying: boolean;
  onRetry: () => void;
}

export default function ServiceUnavailable({ unconfigured, retrying, onRetry }: Props) {
  return (
    <div
      className="arc-root welcome-loading"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 18, padding: 24, textAlign: 'center' }}
    >
      <OrbitMorph state="thinking" size={72} />
      <div className="arc-welcome-title" role="status">
        {unconfigured ? 'The service is not configured yet' : 'The service is unavailable'}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--arc-muted)', maxWidth: 380 }}>
        {unconfigured
          ? 'Ask your administrator to check the model settings, then try again.'
          : 'The server may be restarting. Wait a moment, then try again.'}
      </div>
      <button className="arc-btn" disabled={retrying} onClick={onRetry}>
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  );
}
