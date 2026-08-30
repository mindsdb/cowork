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
  const [computerId, setComputerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [issue, setIssue] = useState('');

  useEffect(() => {
    setResourceIds(resources.map((resource) => resource.id));
    setResourceStates([]);
    setComputers([]);
    setComputerId('');
    setIssue('');
  }, [resources, selectedProject?.id]);

  useEffect(() => {
    if (!selectedProject || !resourceIds.length) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    const allSelected = resourceIds.length === resources.length
      && resources.every((resource) => resourceIds.includes(resource.id));
    setLoading(true);
    setIssue('');
    Promise.all([
      codingApi.projectResources(selectedProject.id),
      codingApi.projectComputers(selectedProject.id, allSelected ? undefined : resourceIds, engineId),
    ]).then(([resourcePage, computerPage]) => {
      if (!active) return;
      setResourceStates(resourcePage.items);
      setComputers(computerPage.items);
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
  }, [engineId, resourceIds, resources, selectedProject]);

  return {
    projectResources: resources,
    resourceIds,
    setResourceIds,
    resourceStates,
    computers,
    computerId,
    setComputerId,
    executionLoading: loading,
    executionIssue: issue,
  };
}
