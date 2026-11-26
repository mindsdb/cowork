import { useCallback } from 'react';
import { consoleUrlFor } from '../../lib/mindsUrls';
import { useAccountUser } from './useAccountUser';

/**
 * Names this session's organization and account on a console link, so the
 * console opens that organization rather than the browser's last one (ENG-4333).
 * Call the result on render, not after an await, so web popup blockers allow it.
 */
export function useConsoleLink() {
  const user = useAccountUser();
  const organizationId = user?.orgId ?? null;
  const subject = user?.sub ?? null;
  return useCallback((url) => consoleUrlFor(url, { organizationId, subject }), [organizationId, subject]);
}
