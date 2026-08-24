import { useCallback, useEffect, useMemo, useState } from 'react';

import { codingApi, type CodeProject } from './api';
import { DEFAULT_CODING_AGENT_MODEL } from './defaults';

const LAST_PROJECT_KEY = 'mindshub-code:last-project';


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
        const preferred = sessionProjectId || current || localStorage.getItem(LAST_PROJECT_KEY);
        return page.items.some((item) => item.id === preferred) ? preferred : page.items[0]?.id || null;
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
    else localStorage.removeItem(LAST_PROJECT_KEY);
  }, []);

  const selected = useMemo(
    () => projects.find((item) => item.id === selectedId) || null,
    [projects, selectedId],
  );

  const save = useCallback(async (project: CodeProject | null, values: Partial<CodeProject> & Pick<CodeProject, 'name' | 'folders'>) => {
    const saved = project
      ? await codingApi.updateProject(project.id, values)
      : await codingApi.createProject({
          name: values.name,
          folders: values.folders,
          connections: values.connections || [],
          environment: values.environment || { variables: {}, port_names: ['PORT'] },
          default_engine_id: values.default_engine_id || 'codex',
          default_model: values.default_model || DEFAULT_CODING_AGENT_MODEL,
          permission_mode: values.permission_mode || 'supervised',
        });
    await load();
    setSelectedId(saved.id);
    return saved;
  }, [load, setSelectedId]);

  const remove = useCallback(async (id: string) => {
    await codingApi.deleteProject(id);
    if (selectedId === id) setSelectedId(null);
    await load();
  }, [load, selectedId, setSelectedId]);

  return { projects, selected, selectedId, setSelectedId, loading, error, load, save, remove };
}
