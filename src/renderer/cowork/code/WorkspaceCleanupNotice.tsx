import { useEffect, useRef, useState } from 'react';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { useTranslation } from '../../lib/i18n';
import { codingApi, type WorkspaceCleanupStatus } from './api';

/** Cleanup outlives the deleted task, so its warning belongs to Code Mode. */
export function WorkspaceCleanupNotice({ active }: { active: boolean }) {
  const { t } = useTranslation('code');
  const [status, setStatus] = useState<WorkspaceCleanupStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = generation.current;
      try {
        const next = await codingApi.workspaceCleanup();
        if (!disposed && generation.current === current) setStatus(next);
      } catch (reason) {
        // Older servers do not support cleanup status. Keep an existing
        // warning through transient disconnects rather than claiming success.
        if ((reason as { status?: number }).status === 404) return;
      }
      if (!disposed) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [active]);

  async function retry() {
    generation.current += 1;
    setRetrying(true);
    setError(false);
    try {
      setStatus(await codingApi.retryWorkspaceCleanup());
    } catch {
      setError(true);
    } finally {
      generation.current += 1;
      setRetrying(false);
    }
  }

  if (!status?.failed) return null;
  return <Alert variant="warning" className="m-3 shrink-0" actions={
    <Button size="sm" disabled={retrying || status.running} onClick={() => void retry()}>
      {t(retrying || status.running ? 'workspaceCleanup.retrying' : 'workspaceCleanup.retry')}
    </Button>
  }>
    {t('workspaceCleanup.failed')}
    {error && <p>{t('workspaceCleanup.retryFailed')}</p>}
  </Alert>;
}
