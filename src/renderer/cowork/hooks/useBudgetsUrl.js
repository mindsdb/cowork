import { MINDS_BUDGETS_DENIAL_URL, MINDS_BUDGETS_URL } from '../../lib/mindsUrls';
import { useConsoleLink } from './useConsoleLink';

/**
 * The console's Budgets tab for this session's organization. `fromDenial` marks
 * a link offered because a budget stopped the task.
 */
export function useBudgetsUrl({ fromDenial = false } = {}) {
  return useConsoleLink()(fromDenial ? MINDS_BUDGETS_DENIAL_URL : MINDS_BUDGETS_URL);
}
