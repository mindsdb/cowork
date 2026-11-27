// The page a custom MCP sign-in pop-up lands on, shown instead of the app once
// Keycloak has signed the member in. It finishes the sign-in for that member,
// says how it went, and closes the pop-up when it worked. auth refuses a
// completion started by someone else, so a forwarded link connects nothing.

import { useEffect, useState } from 'react';
import { Alert, Button } from '../ui';
import Spinner from '../ui/Spinner';
import { host } from '../../../platform/host';
import { useTranslation } from '../../../lib/i18n';
import { takeCustomMcpCompletion } from '../../lib/customMcpFinish';
import { nudgeCustomMcpSignIns } from '../../lib/customMcpWebConnect';
import { connectErrorMessage } from './CustomMcpConnectModal';

const EXPIRED = { ok: false, code: 'expired', reason: '' };

// Once per page load: the id is used once, and a remount must not post again.
let finishing = null;

function finishOnce() {
  if (!finishing) {
    const completion = takeCustomMcpCompletion();
    // Whatever this page heard, the waiting tab reads its own sign-in's status.
    finishing = completion
      ? host.customMcpFinish(completion).then((finished) => {
        nudgeCustomMcpSignIns();
        return finished;
      })
      : Promise.resolve(EXPIRED);
  }
  return finishing;
}

/** For tests: forget this page load's finish. */
export function resetCustomMcpFinishForTests() {
  finishing = null;
}

export default function CustomMcpFinishPage() {
  const { t } = useTranslation('library');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let live = true;
    void finishOnce().then((finished) => {
      if (!live) return;
      setResult(finished);
      if (finished.ok) window.close();
    });
    return () => { live = false; };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <h1 className="m-0 text-lg font-medium text-ink">{t('customMcp.finish.title')}</h1>
        {!result && (
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <Spinner className="text-ink-3" />
            {t('customMcp.finish.working')}
          </div>
        )}
        {result?.ok && <Alert variant="success">{t('customMcp.finish.done')}</Alert>}
        {result && !result.ok && <Alert variant="danger">{connectErrorMessage(t, result)}</Alert>}
        {result && (
          <div>
            <Button type="button" onClick={() => window.close()}>{t('customMcp.finish.close')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
