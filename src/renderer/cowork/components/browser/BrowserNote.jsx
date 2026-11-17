/* What the pane's privacy note says, folded under one line so it stays out of
   the way: collapsed by default, opened on a click. */

import { useTranslation } from '../../../lib/i18n';

/**
 * @param {{ agentLabel?: string, children: import('react').ReactNode }} props
 */
export function BrowserNote({ agentLabel = 'Anton', children }) {
  const { t } = useTranslation('chat');
  return (
    <details className="browser-panel__note">
      <summary>{t('browser.learnWhat', { agent: agentLabel })}</summary>
      <p>{children}</p>
    </details>
  );
}
