import { useRef, useState } from 'react';
import {
  codingApi,
  type CreateCodeTaskInput,
  type CodingSession,
} from './api';


const CONTROL_TIMEOUT_MS = 20_000;


function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}


export function withControlTimeout<Result>(request: Promise<Result>, message: string): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), CONTROL_TIMEOUT_MS);
    request.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
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
  // Actions can overlap: an approval is allowed while a steer is still in
  // flight. Count them so the first one to settle does not release the
  // controls while another request is still pending.
  const pendingActions = useRef(0);
  const beginAction = () => {
    pendingActions.current += 1;
    setBusy(true);
  };
  const endAction = () => {
    pendingActions.current = Math.max(0, pendingActions.current - 1);
    if (pendingActions.current === 0) setBusy(false);
  };
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

  const execute = async <Result,>(
    action: () => Promise<Result>,
    refreshList = false,
    rethrow = false,
  ): Promise<Result | undefined> => {
    const actionSessionId = selectedId;
    beginAction();
    setError('');
    try {
      let result: Result;
      try {
        result = await action();
      } catch (reason) {
        if (selectedIdRef.current === actionSessionId) {
          setError(errorMessage(reason, 'Coding operation failed.'));
        }
        if (rethrow) throw reason;
        return undefined;
      }

      await reconcile(
        refresh,
        'The operation completed',
        () => selectedIdRef.current === actionSessionId,
      );
      if (refreshList) {
        await reconcile(
          () => loadSessions(selectedIdRef.current === actionSessionId ? actionSessionId || undefined : undefined),
          'The operation completed',
          () => selectedIdRef.current === actionSessionId,
        );
      }
      return result;
    } finally {
      endAction();
    }
  };

  const run = async (
    action: () => Promise<unknown>,
    refreshList = false,
    rethrow = false,
  ): Promise<void> => {
    await execute(action, refreshList, rethrow);
  };

  const create = async (input: CreateCodeTaskInput) => {
    beginAction();
    setError('');
    try {
      const workspace = input.projectId
        ? { project_id: input.projectId }
        : { path: input.path, allow_direct_folder: true };
      const created = await codingApi.create({
        ...workspace,
        resource_ids: input.resourceIds,
        computer_id: input.computerId,
        prompt: input.prompt,
        engine_id: input.engineId,
        model: input.model,
        permission_mode: input.permissionMode,
        attachments: input.attachments,
        source_contexts: input.sourceContexts,
      });
      onSelectionChangeRef.current(created.id, false);
      await reconcile(() => loadSessions(created.id), 'The task started');
    } catch (reason) {
      setError(errorMessage(reason, 'Could not start this task.'));
    } finally {
      endAction();
    }
  };

  const fork = async () => {
    if (!session) return;
    beginAction();
    setError('');
    try {
      const forked = await codingApi.forkSession(session.id);
      onSelectionChangeRef.current(forked.id, false);
      await reconcile(() => loadSessions(forked.id), 'The task was forked');
    } catch (reason) {
      setError(errorMessage(reason, 'Could not fork this coding task.'));
    } finally {
      endAction();
    }
  };

  const toggleArchive = async () => {
    if (!session) return;
    const archive = !session.archived;
    beginAction();
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
      endAction();
    }
  };

  const remove = async () => {
    if (!session) return false;
    beginAction();
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
      endAction();
    }
  };

  return { busy, error, setError, run, runResult: execute, create, fork, toggleArchive, remove };
}
