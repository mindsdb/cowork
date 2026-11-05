// "Add files from SharePoint" for a project: the import modal, or the setup
// modal first when there is no SharePoint connection yet. Org mode has no
// SharePoint (the server refuses these routes there), so the entry point is
// absent rather than offered and refused.

import { useCallback, useState } from 'react';
import SharePointImportModal from './SharePointImportModal';
import SharePointSetupModal, { SHAREPOINT_ENGINE } from './SharePointSetupModal';

/**
 * @param {object} options
 * @param {{engine: string, name: string, user_label?: string|null}[]} options.connections every saved connection
 * @param {boolean} options.orgMode
 * @param {() => void} [options.onConnectionsChanged] after a connection is created here
 * @returns {{startSharePointImport: ((projectName: string) => void) | undefined, sharePointModals: JSX.Element}}
 */
export function useSharePointImport({ connections, orgMode, onConnectionsChanged }) {
  const [flow, setFlow] = useState(null);
  const sharePoint = (connections || []).filter((c) => c.engine === SHAREPOINT_ENGINE);

  const start = useCallback((projectName) => {
    if (!projectName) return;
    setFlow({ projectName, step: sharePoint.length ? 'import' : 'setup', created: null });
  }, [sharePoint.length]);

  const close = useCallback(() => setFlow(null), []);

  // The connections list refreshes on its own schedule, so a connection just
  // created here is offered by its saved name until the list catches up.
  const offered = sharePoint.length || !flow?.created ? sharePoint : [flow.created];

  const sharePointModals = (
    <>
      <SharePointSetupModal
        open={flow?.step === 'setup'}
        onClose={close}
        onSaved={(saved) => {
          onConnectionsChanged?.();
          setFlow((prev) => prev && { ...prev, step: 'import', created: { name: saved.name, user_label: saved.user_label } });
        }}
      />
      <SharePointImportModal
        open={flow?.step === 'import'}
        projectName={flow?.projectName || ''}
        connections={offered}
        onClose={close}
      />
    </>
  );

  return { startSharePointImport: orgMode ? undefined : start, sharePointModals };
}
