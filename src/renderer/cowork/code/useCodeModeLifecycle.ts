import { useEffect, useRef } from 'react';

import { codingApi, type CodingSession, type TaskRunStatus } from './api';
import { isActiveStatus } from './presentation';

const ACTIVE_RUN_STATUSES = new Set<TaskRunStatus>([
  'queued',
  'preparing',
  'running',
  'awaiting_approval',
  'recovering',
]);

interface CodeModeLifecycleOptions {
  enabled: boolean;
  fixtureActive?: boolean;
  sessions: CodingSession[];
  onDisable: () => void;
  onSessionsChange: (sessions: CodingSession[]) => void;
  onStopIssue?: (issue: CodeModeStopIssue) => void;
}

interface StopActiveCodeSessionsResult {
  sessions: CodingSession[];
  stopped: number;
  failed: number;
}

export interface CodeModeStopIssue {
  discoveryFailed: boolean;
  cancelFailures: number;
}

interface StopCurrentCodeSessionsResult extends StopActiveCodeSessionsResult {
  discoveryFailed: boolean;
}

export function isCodeSessionActive(session: CodingSession): boolean {
  return isActiveStatus(session.status)
    || (session.run_status != null && ACTIVE_RUN_STATUSES.has(session.run_status));
}

export async function stopActiveCodeSessions(
  sessions: CodingSession[],
  cancel: (id: string) => Promise<CodingSession> = codingApi.cancel,
): Promise<StopActiveCodeSessionsResult> {
  const activeSessions = sessions.filter(isCodeSessionActive);
  const results = await Promise.all(activeSessions.map((session) => (
    cancel(session.id).then(
      (value) => ({ ok: true as const, value }),
      (reason) => ({ ok: false as const, reason }),
    )
  )));
  const updates = new Map<string, CodingSession>();
  results.forEach((result) => {
    if (result.ok) updates.set(result.value.id, result.value);
  });
  return {
    sessions: updates.size > 0
      ? sessions.map((session) => updates.get(session.id) || session)
      : sessions,
    stopped: updates.size,
    failed: results.filter((result) => !result.ok).length,
  };
}

export async function stopCurrentCodeSessions(
  cachedSessions: CodingSession[],
  load: () => Promise<CodingSession[]> = async () => (await codingApi.sessions(true)).items,
  cancel: (id: string) => Promise<CodingSession> = codingApi.cancel,
): Promise<StopCurrentCodeSessionsResult> {
  let currentSessions = cachedSessions;
  let discoveryFailed = false;
  try {
    currentSessions = await load();
  } catch {
    // The runtime may be offline while Settings remains available. Fall back
    // to the renderer cache so known active turns are still stopped, and
    // surface that the result could not be confirmed authoritatively.
    discoveryFailed = true;
  }
  return {
    ...await stopActiveCodeSessions(currentSessions, cancel),
    discoveryFailed,
  };
}

export function useCodeModeLifecycle({
  enabled,
  fixtureActive = false,
  sessions,
  onDisable,
  onSessionsChange,
  onStopIssue,
}: CodeModeLifecycleOptions): void {
  const previousEnabledRef = useRef(enabled);

  useEffect(() => {
    const wasEnabled = previousEnabledRef.current;
    previousEnabledRef.current = enabled;
    if (!wasEnabled || enabled || fixtureActive) return;

    // Hide immediately, then stop active turns without deleting their task,
    // isolated workspace, conversation, or edits.
    onDisable();
    void stopCurrentCodeSessions(sessions)
      .then((result) => {
        onSessionsChange(result.sessions);
        if (result.discoveryFailed || result.failed > 0) {
          onStopIssue?.({
            discoveryFailed: result.discoveryFailed,
            cancelFailures: result.failed,
          });
        }
      });
  }, [enabled, fixtureActive, onDisable, onSessionsChange, onStopIssue, sessions]);
}
