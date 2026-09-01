import { useEffect, useMemo, useState } from 'react';

import {
  codingApi,
  projectResources,
  type CodeComputer,
  type CodeProject,
  type ProjectResourceState,
} from './api';


export function useTaskExecutionTarget(selectedProject: CodeProject | null, engineId: string) {
  const resources = useMemo(
    () => selectedProject ? projectResources(selectedProject) : [],
    [selectedProject],
  );
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [resourceStates, setResourceStates] = useState<ProjectResourceState[]>([]);
  const [computers, setComputers] = useState<CodeComputer[]>([]);
  const [allComputers, setAllComputers] = useState<CodeComputer[]>([]);
  const [computerId, setComputerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState('');
  const [refreshRevision, setRefreshRevision] = useState(0);

  useEffect(() => {
    setResourceIds(resources.map((resource) => resource.id));
    setResourceStates([]);
    setComputers([]);
    setAllComputers([]);
    setComputerId('');
    setIssue('');
  }, [resources, selectedProject?.id]);

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
        setIssue(offline
          ? `${offline.resource.name} is on a computer that is offline.`
          : 'No online computer can run this task right now.');
      }
    }).catch((reason) => {
      if (active) setIssue(reason instanceof Error ? reason.message : 'Could not check where this task can run.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [engineId, refreshRevision, resourceIds, resources, selectedProject]);

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
