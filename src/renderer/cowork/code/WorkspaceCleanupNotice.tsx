import { useEffect, useRef, useState } from 'react';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { useTranslation } from '../../lib/i18n';
import { codingApi, type WorkspaceCleanupStatus } from './api';

const POLL_MS = 5000;

/** Cleanup outlives the deleted task, so its warning belongs to Code Mode.
 *
 * Cleanup almost never fails, so the status is checked when Code Mode opens
 * and whenever the task list changes size (a delete starts a removal), and
 * polled only while a removal runs or a failure is showing. */
export function WorkspaceCleanupNotice({ active, taskCount }: { active: boolean; taskCount: number }) {
  const { t } = useTranslation('code');
  const [status, setStatus] = useState<WorkspaceCleanupStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState(false);
  const [round, setRound] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = generation.current;
      let next: WorkspaceCleanupStatus | null = null;
      try {
        next = await codingApi.workspaceCleanup();
        if (!disposed && generation.current === current) setStatus(next);
      } catch (reason) {
        // Older servers do not support cleanup status. Keep an existing
        // warning through transient disconnects rather than claiming success.
        if ((reason as { status?: number }).status === 404) return;
      }
      const settled = next !== null && !next.running && !next.failed;
      if (!disposed && !settled) timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [active, taskCount, round]);

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
      // Follow the retried removal until it settles.
      setRound((value) => value + 1);
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
