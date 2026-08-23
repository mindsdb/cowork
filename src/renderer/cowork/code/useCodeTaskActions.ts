import { useRef, useState } from 'react';
import {
  codingApi,
  type CreateCodeTaskInput,
  type CodingSession,
} from './api';


function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}


export function useCodeTaskActions({
  selectedId,
  session,
  refresh,
  loadSessions,
  onSessionsChange,
  onSelectionChange,
}: {
  selectedId: string | null;
  session: CodingSession | null;
  refresh: () => Promise<void>;
  loadSessions: (preferId?: string) => Promise<CodingSession[]>;
  onSessionsChange: (sessions: CodingSession[]) => void;
  onSelectionChange: (sessionId: string | null, newTask?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedIdRef = useRef(selectedId);
  const onSessionsChangeRef = useRef(onSessionsChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  selectedIdRef.current = selectedId;
  onSessionsChangeRef.current = onSessionsChange;
  onSelectionChangeRef.current = onSelectionChange;

  const reconcile = async (
    action: () => Promise<unknown>,
    completedMessage: string,
    stillRelevant: () => boolean = () => true,
  ): Promise<boolean> => {
    try {
      await action();
      return true;
    } catch (reason) {
      if (stillRelevant()) {
        setError(`${completedMessage}, but the task list could not refresh: ${errorMessage(reason, 'try again shortly')}`);
      }
      return false;
    }
  };

  const run = async (
    action: () => Promise<unknown>,
    refreshList = false,
    rethrow = false,
  ): Promise<void> => {
    const actionSessionId = selectedId;
    setBusy(true);
    setError('');
    try {
      try {
        await action();
      } catch (reason) {
        if (selectedIdRef.current === actionSessionId) {
          setError(errorMessage(reason, 'Coding operation failed.'));
        }
        if (rethrow) throw reason;
        return;
      }
      await refresh();
      if (refreshList) {
        await reconcile(
          () => loadSessions(selectedIdRef.current === actionSessionId ? actionSessionId || undefined : undefined),
          'The operation completed',
          () => selectedIdRef.current === actionSessionId,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const create = async (input: CreateCodeTaskInput) => {
    setBusy(true);
    setError('');
    try {
      const created = await codingApi.create({
        path: input.path,
        prompt: input.prompt,
        allow_direct_folder: input.allowDirect,
        engine_id: input.engineId,
        model: input.model,
        permission_mode: input.permissionMode,
        attachments: input.attachments,
      });
      onSelectionChangeRef.current(created.id, false);
      await reconcile(() => loadSessions(created.id), 'The task started');
    } catch (reason) {
      setError(errorMessage(reason, 'Could not start this task.'));
    } finally {
      setBusy(false);
    }
  };

  const fork = async () => {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const forked = await codingApi.forkSession(session.id);
      onSelectionChangeRef.current(forked.id, false);
      await reconcile(() => loadSessions(forked.id), 'The task was forked');
    } catch (reason) {
      setError(errorMessage(reason, 'Could not fork this coding task.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    if (!session) return;
    const archive = !session.archived;
    setBusy(true);
    setError('');
    try {
      await codingApi.setArchived(session.id, archive);
      await reconcile(async () => {
        const page = await codingApi.sessions(true);
        onSessionsChangeRef.current(page.items);
        if (archive) {
          const next = page.items.find((item) => !item.archived && item.id !== session.id);
          onSelectionChangeRef.current(next?.id || null, !next);
        } else {
          onSelectionChangeRef.current(session.id, false);
          await refresh();
        }
      }, `The task was ${archive ? 'archived' : 'restored'}`);
    } catch (reason) {
      setError(errorMessage(reason, 'Could not update this coding task.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!session) return false;
    setBusy(true);
    setError('');
    try {
      await codingApi.deleteSession(session.id);
      onSelectionChangeRef.current(null, false);
      await reconcile(() => loadSessions(), 'The task was deleted');
      return true;
    } catch (reason) {
      setError(errorMessage(reason, 'Could not delete this coding task.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, setError, run, create, fork, toggleArchive, remove };
}
