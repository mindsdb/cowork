import { useCallback, useEffect, useMemo, useState } from 'react';

import { codingApi, type CodeProject } from './api';
import { DEFAULT_CODING_AGENT_MODEL } from './defaults';

const LAST_PROJECT_KEY = 'mindshub-code:last-project';
const NO_PROJECT_STORAGE_VALUE = '__no_code_project__';


export function useCodeProjects(sessionProjectId?: string | null) {
  const [projects, setProjects] = useState<CodeProject[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(sessionProjectId || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await codingApi.projects();
      setProjects(page.items);
      setError('');
      setSelectedIdState((current) => {
        if (sessionProjectId && page.items.some((item) => item.id === sessionProjectId)) return sessionProjectId;
        if (current && page.items.some((item) => item.id === current)) return current;
        const stored = localStorage.getItem(LAST_PROJECT_KEY);
        if (stored === NO_PROJECT_STORAGE_VALUE) return null;
        return page.items.some((item) => item.id === stored) ? stored : page.items[0]?.id || null;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load Code Projects.');
    } finally {
      setLoading(false);
    }
  }, [sessionProjectId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (sessionProjectId && projects.some((item) => item.id === sessionProjectId)) {
      setSelectedIdState(sessionProjectId);
    }
  }, [projects, sessionProjectId]);

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id);
    if (id) localStorage.setItem(LAST_PROJECT_KEY, id);
    else localStorage.setItem(LAST_PROJECT_KEY, NO_PROJECT_STORAGE_VALUE);
  }, []);

  const selected = useMemo(
    () => projects.find((item) => item.id === selectedId) || null,
    [projects, selectedId],
  );

  const save = useCallback(async (project: CodeProject | null, values: Partial<CodeProject> & Pick<CodeProject, 'name' | 'resources'>) => {
    const saved = project
      ? await codingApi.updateProject(project.id, values)
      : await codingApi.createProject({
          name: values.name,
          resources: values.resources,
          connections: values.connections || [],
          environment: values.environment || { variables: {}, port_names: ['PORT'] },
          skill_sources: values.skill_sources || [],
          default_engine_id: values.default_engine_id || 'codex',
          default_model: values.default_model || DEFAULT_CODING_AGENT_MODEL,
          default_reasoning_effort: values.default_reasoning_effort ?? null,
          permission_mode: values.permission_mode || 'supervised',
        });
    await load();
    setSelectedId(saved.id);
    return saved;
  }, [load, setSelectedId]);

  // Put a project the server just returned into the list at once, so the view
  // reflects a successful save even if the refresh that follows fails.
  const replace = useCallback((saved: CodeProject) => {
    setProjects((current) => current.map((item) => (item.id === saved.id ? saved : item)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await codingApi.deleteProject(id);
    if (selectedId === id) setSelectedId(null);
    await load();
  }, [load, selectedId, setSelectedId]);

  return { projects, selected, selectedId, setSelectedId, loading, error, load, save, replace, remove };
}
