import { useCallback, useEffect, useRef, useState } from 'react';
import {
  codingApi,
  type ProjectActionRunResponse,
  type ProjectActionSummary,
} from './api';
import { getTerminalShellPreference } from './terminalPreferences';
import { isAppVisible, subscribeAppVisibility } from './useAppVisible';


// Fast while a run action is coming up, so its preview appears promptly; a
// preview already up only needs to notice when its server dies.
const PREVIEW_PENDING_REFRESH_MS = 1_500;
const PREVIEW_OPEN_REFRESH_MS = 10_000;


export function useProjectActions(sessionId: string | null | undefined, active = true) {
  const [actions, setActions] = useState<ProjectActionSummary[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const activeSession = useRef(sessionId);
  const actionRequest = useRef(0);
  activeSession.current = sessionId;

  useEffect(() => {
    actionRequest.current += 1;
    setBusy(false);
    let active = true;
    if (!sessionId) {
      setActions([]);
      setPreviewUrl(null);
      setPreviewPending(false);
      return undefined;
    }
    codingApi.projectActions(sessionId).then((page) => {
      if (!active) return;
      setActions(page.items);
      setPreviewUrl(page.preview_url || null);
      setPreviewPending(!!page.preview_pending);
    }).catch(() => {
      if (!active) return;
      setActions([]);
      setPreviewUrl(null);
      setPreviewPending(false);
    });
    return () => { active = false; };
  }, [sessionId]);

  // Keep following the server while a preview is open or a run action is still
  // coming up: the URL appears once the command listens and disappears again
  // when it dies, even though its shell tab stays open.
  // Code Mode stays mounted behind Cowork mode, so poll only while it is the
  // visible surface.
  useEffect(() => {
    if (!active || !sessionId || (!previewUrl && !previewPending)) return undefined;
    let alive = true;
    const refresh = () => {
      if (!isAppVisible()) return;
      void codingApi.projectActions(sessionId).then((page) => {
        if (!alive) return;
        setActions(page.items);
        setPreviewUrl(page.preview_url || null);
        setPreviewPending(!!page.preview_pending);
      }).catch(() => {
        // A transient catalogue read must not close a preview that may still
        // be running. The next interval reconciles it with server state.
      });
    };
    const timer = window.setInterval(
      refresh,
      previewPending ? PREVIEW_PENDING_REFRESH_MS : PREVIEW_OPEN_REFRESH_MS,
    );
    const unsubscribeVisibility = subscribeAppVisibility(refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      unsubscribeVisibility();
    };
  }, [active, previewPending, previewUrl, sessionId]);

  const run = useCallback(async (action: ProjectActionSummary): Promise<ProjectActionRunResponse> => {
    if (!sessionId) throw new Error('Open a coding task before running a project action.');
    const request = actionRequest.current + 1;
    actionRequest.current = request;
    const requestedSession = sessionId;
    setBusy(true);
    try {
      const result = await codingApi.runProjectAction(requestedSession, {
        resource_id: action.resource_id,
        command_id: action.id,
        shell: getTerminalShellPreference(),
      });
      if (actionRequest.current === request && activeSession.current === requestedSession) {
        setPreviewUrl(result.preview_url || null);
        setPreviewPending(!!result.preview_pending);
      }
      return result;
    } finally {
      if (actionRequest.current === request && activeSession.current === requestedSession) {
        setBusy(false);
      }
    }
  }, [sessionId]);

  // Re-read the catalogue on demand, for when the task's commands change
  // underneath an open session (adopting Project settings from Review).
  // A failed read rejects: the caller is about to tell the user which
  // actions exist, and a stale list would make that claim wrong.
  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const requestedSession = sessionId;
    const page = await codingApi.projectActions(requestedSession);
    if (activeSession.current !== requestedSession) return;
    setActions(page.items);
    setPreviewUrl(page.preview_url || null);
    setPreviewPending(!!page.preview_pending);
  }, [sessionId]);

  return { actions, busy, previewUrl, previewPending, run, refresh };
}
