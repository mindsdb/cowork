import { useEffect, useMemo, useState } from 'react';

import {
  codingApi,
  projectResources,
  type CodeComputer,
  type CodeProject,
  type ProjectResourceState,
} from './api';

const EXECUTION_CAPACITY_REFRESH_MS = 5_000;
const CAPACITY_ISSUE = 'No online computer can run this task right now.';
const OFFLINE_ISSUE_SUFFIX = ' is on a computer that is offline.';

const offlineIssue = (resourceName: string) => `${resourceName}${OFFLINE_ISSUE_SUFFIX}`;
const isTransientIssue = (issue: string) => issue === CAPACITY_ISSUE || issue.endsWith(OFFLINE_ISSUE_SUFFIX);


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
  const [issue, setIssue] = useState('');
  const [refreshRevision, setRefreshRevision] = useState(0);

  useEffect(() => {
    setResourceIds(JSON.parse(defaultResourceIdsJson) as string[]);
    setResourceStates([]);
    setComputers([]);
    setAllComputers([]);
    setComputerId('');
    setIssue('');
  }, [defaultResourceIdsJson, selectedProject?.id]);

  useEffect(() => {
    let active = true;
    if (!selectedProject) {
      setLoading(true);
      setIssue('');
      codingApi.computers().then((page) => {
        if (!active) return;
        setComputers(page.items);
        setAllComputers(page.items);
        const local = page.items.find((computer) => computer.is_local || computer.id === 'local') || page.items[0];
        setComputerId(local?.id || '');
      }).catch((reason) => {
        if (active) setIssue(reason instanceof Error ? reason.message : 'Could not find this computer.');
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
    setIssue('');
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
        setIssue(offline ? offlineIssue(offline.resource.name) : CAPACITY_ISSUE);
      }
    }).catch((reason) => {
      if (active) setIssue(reason instanceof Error ? reason.message : 'Could not check where this task can run.');
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
      if (document.visibilityState === 'visible') {
        timer = window.setTimeout(
          () => setRefreshRevision((current) => current + 1),
          EXECUTION_CAPACITY_REFRESH_MS,
        );
      }
    };
    scheduleRefresh();
    document.addEventListener('visibilitychange', scheduleRefresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', scheduleRefresh);
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
    executionIssue: issue,
    refreshComputers: () => setRefreshRevision((current) => current + 1),
  };
}
