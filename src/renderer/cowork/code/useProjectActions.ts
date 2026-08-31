import { useCallback, useEffect, useState } from 'react';
import {
  codingApi,
  type ProjectActionRunResponse,
  type ProjectActionSummary,
} from './api';
import { getTerminalShellPreference } from './terminalPreferences';


const PREVIEW_STATUS_REFRESH_MS = 1_500;


export function useProjectActions(sessionId: string | null | undefined) {
  const [actions, setActions] = useState<ProjectActionSummary[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!sessionId) {
      setActions([]);
      setPreviewUrl(null);
      return undefined;
    }
    codingApi.projectActions(sessionId).then((page) => {
      if (!active) return;
      setActions(page.items);
      setPreviewUrl(page.preview_url || null);
    }).catch(() => {
      if (!active) return;
      setActions([]);
      setPreviewUrl(null);
    });
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !previewUrl) return undefined;
    let active = true;
    const refresh = () => {
      void codingApi.projectActions(sessionId).then((page) => {
        if (!active) return;
        setActions(page.items);
        setPreviewUrl(page.preview_url || null);
      }).catch(() => {
        // A transient catalogue read must not close a preview that may still
        // be running. The next interval reconciles it with server state.
      });
    };
    const timer = window.setInterval(refresh, PREVIEW_STATUS_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [previewUrl, sessionId]);

  const run = useCallback(async (action: ProjectActionSummary): Promise<ProjectActionRunResponse> => {
    if (!sessionId) throw new Error('Open a coding task before running a project action.');
    setBusy(true);
    try {
      const result = await codingApi.runProjectAction(sessionId, {
        resource_id: action.resource_id,
        command_id: action.id,
        shell: getTerminalShellPreference(),
      });
      setPreviewUrl(result.preview_url || null);
      return result;
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  return { actions, busy, previewUrl, run };
}
