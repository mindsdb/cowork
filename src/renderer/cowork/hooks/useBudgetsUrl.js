import { MINDS_BUDGETS_URL, consoleUrlFor } from '../../lib/mindsUrls';
import { useAccountUser } from './useAccountUser';

/**
 * The console's Budgets tab for the organization this session runs tasks in.
 * The token names it, so the console switches to it rather than showing
 * whichever organization the browser has active (ENG-3274). Read on render, not
 * on click, so the web's popup blocker sees the click open the tab.
 */
export function useBudgetsUrl() {
  const user = useAccountUser();
  return consoleUrlFor(MINDS_BUDGETS_URL, { organizationId: user?.orgId ?? null, subject: user?.sub ?? null });
}
