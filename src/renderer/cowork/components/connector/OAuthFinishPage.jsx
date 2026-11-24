// The page a built-in connector's web sign-in pop-up lands on, shown instead of
// the app once Keycloak has signed the member in. It finishes the sign-in for
// that member, says how it went, and closes the pop-up when it worked. auth
// refuses a sign-in started by someone else, so a forwarded link connects nothing.

import { useEffect, useState } from 'react';
import { Alert, Button } from '../ui';
import Spinner from '../ui/Spinner';
import { useTranslation } from '../../../lib/i18n';
import { finishConnectorOAuth } from '../../api';
import { takeOAuthCompletion } from '../../lib/oauthFinish';

const EXPIRED = { ok: false, code: 'expired', message: '' };

// Once per page load: the id is used once, and a remount must not post again.
let finishing = null;

function finishOnce() {
  if (!finishing) {
    const completion = takeOAuthCompletion();
    finishing = completion
      ? finishConnectorOAuth(completion).then(
        () => ({ ok: true }),
        (err) => ({ ok: false, code: err?.code || '', message: err?.message || '' }),
      )
      : Promise.resolve(EXPIRED);
  }
  return finishing;
}

/** For tests: forget this page load's finish. */
export function resetOAuthFinishForTests() {
  finishing = null;
}

function refusal(t, result) {
  if (result.code === 'login_not_yours') return { variant: 'warning', text: t('connectorSignIn.finish.notYours') };
  if (result.code === 'expired') return { variant: 'danger', text: t('connectorSignIn.finish.expired') };
  if (result.code === 'wrong_organization') {
    return { variant: 'danger', text: t('connectorSignIn.finish.wrongOrganization') };
  }
  // A provider's own refusal (e.g. Notion's admin approval) is auth's message.
  if (result.code === 'failed' && result.message) return { variant: 'danger', text: result.message };
  return { variant: 'danger', text: t('connectorSignIn.finish.failed') };
}

export default function OAuthFinishPage() {
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

  const refused = result && !result.ok ? refusal(t, result) : null;
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <h1 className="m-0 text-lg font-medium text-ink">{t('connectorSignIn.finish.title')}</h1>
        {!result && (
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <Spinner className="text-ink-3" />
            {t('connectorSignIn.finish.working')}
          </div>
        )}
        {result?.ok && <Alert variant="success">{t('connectorSignIn.finish.done')}</Alert>}
        {refused && <Alert variant={refused.variant}>{refused.text}</Alert>}
        {result && (
          <div>
            <Button type="button" onClick={() => window.close()}>{t('connectorSignIn.finish.close')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
