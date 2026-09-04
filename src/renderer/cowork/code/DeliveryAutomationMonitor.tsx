import { useCallback, useEffect, useMemo, useRef } from 'react';

import { codingApi, type CodingSession } from './api';
import {
  deliveryFixCheckPrompt,
  nextDeliveryAutomationAction,
  type DeliveryAutomationAction,
} from './deliveryAutomation';
import { isActiveStatus } from './presentation';
import { isAppVisible, subscribeAppVisibility } from './useAppVisible';

const POLL_INTERVAL_MS = 60_000;

function policyEnabled(session: CodingSession): boolean {
  const policy = session.delivery_policy;
  return !!policy && (
    policy.fix_failing_checks
    || policy.mark_ready_when_passing
    || policy.merge_when_approved
    || policy.complete_source_after_merge
    || policy.archive_after_merge
  );
}

function canMonitor(session: CodingSession): boolean {
  const hasGitWorktree = session.workspaces === undefined
    ? session.workspace_kind === 'git_worktree'
    : session.workspaces.some((workspace) => workspace.workspace_kind === 'git_worktree');
  return !session.archived
    && !!session.project_id
    && !isActiveStatus(session.status)
    && hasGitWorktree
    && policyEnabled(session);
}

export async function executeDeliveryAutomationAction(
  session: CodingSession,
  action: DeliveryAutomationAction,
): Promise<boolean> {
  if (action.kind === 'fix') {
    const claim = await codingApi.claimDeliveryAutomation(session.id, action.fingerprint);
    if (!claim.claimed) return false;
    await codingApi.turn(session.id, deliveryFixCheckPrompt(action.item, action.check));
    return true;
  }
  if (action.kind === 'ready' || action.kind === 'merge') {
    await codingApi.pullRequestAction(session.id, {
      action: action.kind,
      target_url: action.item.external_url || '',
      connection_name: action.item.connection_name,
      confirmed: true,
    });
    return true;
  }
  if (action.kind === 'complete') {
    if (action.context.provider !== 'github' && action.context.provider !== 'linear') return false;
    await codingApi.completeSource(session.id, {
      provider: action.context.provider,
      action: 'complete',
      target_url: action.context.url,
      connection_name: action.context.connection_name,
      confirmed: true,
    });
    return true;
  }
  await codingApi.setArchived(session.id, true);
  return true;
}

/**
 * Runs opt-in delivery policies for every Code task, independently of which
 * task or app mode is visible. CodeView stays mounted when the user returns to
 * Cowork, so parallel delivery continues without tying behavior to an open UI.
 */
export function DeliveryAutomationMonitor({
  sessions,
  onSessionsChange,
  onError,
}: {
  sessions: CodingSession[];
  onSessionsChange: (sessions: CodingSession[]) => void;
  onError: (sessionId: string, message: string) => void;
}) {
  const sessionsRef = useRef(sessions);
  const callbacksRef = useRef({ onSessionsChange, onError });
  const running = useRef(new Set<string>());
  const executed = useRef(new Map<string, Set<string>>());
  sessionsRef.current = sessions;
  callbacksRef.current = { onSessionsChange, onError };

  const runSession = useCallback(async (session: CodingSession): Promise<boolean> => {
    if (running.current.has(session.id)) return false;
    running.current.add(session.id);
    let action: DeliveryAutomationAction | null = null;
    try {
      const policy = session.delivery_policy;
      if (!policy) return false;
      const plan = await codingApi.deliveryPlan(session.id);
      action = nextDeliveryAutomationAction({
        sessionId: session.id,
        plan,
        policy,
        sourceContexts: session.source_contexts || [],
        deliveries: session.deliveries || [],
      });
      if (!action) {
        callbacksRef.current.onError(session.id, '');
        return false;
      }
      const sessionActions = executed.current.get(session.id) || new Set<string>();
      executed.current.set(session.id, sessionActions);
      if (sessionActions.has(action.key)) return false;
      sessionActions.add(action.key);
      const changed = await executeDeliveryAutomationAction(session, action);
      callbacksRef.current.onError(session.id, '');
      return changed;
    } catch (reason) {
      if (action) executed.current.get(session.id)?.delete(action.key);
      callbacksRef.current.onError(
        session.id,
        reason instanceof Error ? reason.message : 'Delivery automation could not continue.',
      );
      return false;
    } finally {
      running.current.delete(session.id);
    }
  }, []);

  const runAll = useCallback(async () => {
    const live = new Set(sessionsRef.current.map((session) => session.id));
    for (const id of executed.current.keys()) {
      if (!live.has(id)) executed.current.delete(id);
    }
    // Run sessions sequentially to avoid a burst of GitHub GraphQL, check-run,
    // and review requests when several parallel tasks reach delivery together.
    let changed = false;
    for (const session of sessionsRef.current.filter(canMonitor)) {
      changed = (await runSession(session)) || changed;
    }
    if (!changed) return;
    try {
      const page = await codingApi.sessions(true);
      callbacksRef.current.onSessionsChange(page.items);
    } catch {
      // The existing five-second task-list refresh is the recovery path.
    }
  }, [runSession]);

  const eligibilityKey = useMemo(() => sessions.map((session) => (
    `${session.id}:${session.status}:${session.archived ? 1 : 0}:${JSON.stringify(session.delivery_policy)}:${session.deliveries?.length || 0}`
  )).join('|'), [sessions]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void runAll(); }, 0);
    return () => window.clearTimeout(timer);
  }, [eligibilityKey, runAll]);

  useEffect(() => {
    const refresh = () => { if (isAppVisible()) void runAll(); };
    const timer = window.setInterval(refresh, POLL_INTERVAL_MS);
    const unsubscribeVisibility = subscribeAppVisibility(refresh);
    return () => {
      window.clearInterval(timer);
      unsubscribeVisibility();
    };
  }, [runAll]);

  return null;
}
