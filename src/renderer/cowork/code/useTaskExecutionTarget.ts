import { useEffect, useMemo, useState } from 'react';

import { isAppVisible, subscribeAppVisibility } from './useAppVisible';
import i18n from '../../lib/i18n';

import {
  codingApi,
  projectResources,
  type CodeComputer,
  type CodeProject,
  type ProjectResourceState,
} from './api';

const EXECUTION_CAPACITY_REFRESH_MS = 5_000;
// Kept as data and worded at render, so the text follows the current language.
type ExecutionIssue =
  | { kind: 'capacity' }
  | { kind: 'offline'; name: string }
  | { kind: 'error'; message: string }
  | null;

const isTransientIssue = (issue: ExecutionIssue) => issue?.kind === 'capacity' || issue?.kind === 'offline';

function issueText(issue: ExecutionIssue): string {
  if (!issue) return '';
  if (issue.kind === 'capacity') return i18n.t('executionTarget.capacityIssue', { ns: 'code' });
  if (issue.kind === 'offline') return i18n.t('executionTarget.offlineIssue', { ns: 'code', name: issue.name });
  return issue.message;
}

const errorIssue = (reason: unknown, fallbackKey: string): ExecutionIssue => ({
  kind: 'error',
  message: reason instanceof Error ? reason.message : i18n.t(fallbackKey, { ns: 'code' }),
});


export function useTaskExecutionTarget(selectedProject: CodeProject | null, engineId: string) {
  const resources = useMemo(
    () => selectedProject ? projectResources(selectedProject) : [],
    [selectedProject],
  );
  const defaultResourceIdsJson = JSON.stringify(resources.map((resource) => resource.id));
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [resourceStates, setResourceStates] = useState<ProjectResourceState[]>([]);
  const [computers, setComputers] = useState<CodeComputer[]>([]);
  const [allComputers, setAllComputers] = useState<CodeComputer[]>([]);
  const [computerId, setComputerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState<ExecutionIssue>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);

  useEffect(() => {
    setResourceIds(JSON.parse(defaultResourceIdsJson) as string[]);
    setResourceStates([]);
    setComputers([]);
    setAllComputers([]);
    setComputerId('');
    setIssue(null);
  }, [defaultResourceIdsJson, selectedProject?.id]);

  useEffect(() => {
    let active = true;
    if (!selectedProject) {
      setLoading(true);
      setIssue(null);
      codingApi.computers().then((page) => {
        if (!active) return;
        setComputers(page.items);
        setAllComputers(page.items);
        const local = page.items.find((computer) => computer.is_local || computer.id === 'local') || page.items[0];
        setComputerId(local?.id || '');
      }).catch((reason) => {
        if (active) setIssue(errorIssue(reason, 'executionTarget.findFailed'));
      }).finally(() => {
        if (active) setLoading(false);
      });
      return () => { active = false; };
    }
    if (!resourceIds.length) {
      setLoading(false);
      return () => { active = false; };
    }

    const allSelected = resourceIds.length === resources.length
      && resources.every((resource) => resourceIds.includes(resource.id));
    setLoading(true);
    setIssue(null);
    Promise.all([
      codingApi.projectResources(selectedProject.id),
      codingApi.projectComputers(selectedProject.id, allSelected ? undefined : resourceIds, engineId),
      codingApi.computers(),
    ]).then(([resourcePage, computerPage, allComputerPage]) => {
      if (!active) return;
      setResourceStates(resourcePage.items);
      setComputers(computerPage.items);
      setAllComputers(allComputerPage.items);
      setComputerId((current) => computerPage.items.some((computer) => computer.id === current)
        ? current
        : computerPage.items[0]?.id || '');
      if (!computerPage.items.length) {
        const selectedStates = resourcePage.items.filter((item) => resourceIds.includes(item.resource.id));
        const offline = selectedStates.find((item) => item.availability.status === 'offline');
        setIssue(offline ? { kind: 'offline', name: offline.resource.name } : { kind: 'capacity' });
      }
    }).catch((reason) => {
      if (active) setIssue(errorIssue(reason, 'executionTarget.checkFailed'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [engineId, refreshRevision, resourceIds, resources, selectedProject]);

  useEffect(() => {
    const waitingForCapacity = !!selectedProject
      && resourceIds.length > 0
      && !loading
      && computers.length === 0
      && isTransientIssue(issue);
    if (!waitingForCapacity) return undefined;

    let timer: number | undefined;
    const scheduleRefresh = () => {
      window.clearTimeout(timer);
      // Same rule as the task polls: a hidden or minimised window (which
      // Electron on macOS never reports through document.visibilityState)
      // must not keep asking where the task could run.
      if (isAppVisible()) {
        timer = window.setTimeout(
          () => setRefreshRevision((current) => current + 1),
          EXECUTION_CAPACITY_REFRESH_MS,
        );
      }
    };
    scheduleRefresh();
    const unsubscribeVisibility = subscribeAppVisibility(scheduleRefresh);
    return () => {
      window.clearTimeout(timer);
      unsubscribeVisibility();
    };
  }, [computers.length, issue, loading, resourceIds.length, selectedProject]);

  return {
    projectResources: resources,
    resourceIds,
    setResourceIds,
    resourceStates,
    computers,
    allComputers,
    computerId,
    setComputerId,
    executionLoading: loading,
    executionIssue: issueText(issue),
    refreshComputers: () => setRefreshRevision((current) => current + 1),
  };
}
