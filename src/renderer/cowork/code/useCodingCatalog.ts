import { useCallback, useEffect, useRef, useState } from 'react';

import { codingApi, type EngineCapability } from './api';

export interface CodingCatalog {
  engines: EngineCapability[];
  enginesLoading: boolean;
  error: string;
  modelError: (engineId: string) => string;
  modelIds: (engineId: string) => string[] | null;
  modelsLoading: (engineId: string) => boolean;
  loadModels: (engineId: string) => Promise<void>;
  /** Fetch the engine list again, after Code Mode setup installs the coding agent. */
  reloadEngines: () => void;
}

const EMPTY_MODELS: Record<string, string[]> = {};

export function useCodingCatalog(enabled = true): CodingCatalog {
  const [engines, setEngines] = useState<EngineCapability[]>([]);
  const [enginesLoading, setEnginesLoading] = useState(enabled);
  const [modelsByEngine, setModelsByEngine] = useState<Record<string, string[]>>(EMPTY_MODELS);
  const [loadingModels, setLoadingModels] = useState<Set<string>>(() => new Set());
  const [engineError, setEngineError] = useState('');
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const [engineReload, setEngineReload] = useState(0);
  const modelCache = useRef(new Map<string, string[]>());
  const inFlight = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    setEnginesLoading(true);
    // A reload after Code Mode setup can race the Code service coming back
    // up, so a reload retries for a few seconds before reporting a failure.
    const attempts = engineReload > 0 ? 6 : 1;
    const load = async () => {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const items = await codingApi.engines();
          if (active) {
            setEngines(items);
            setEngineError('');
          }
          return;
        } catch (reason) {
          if (!active) return;
          if (attempt === attempts) {
            setEngineError(reason instanceof Error ? reason.message : 'Could not load coding agents.');
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    };
    void load().finally(() => {
      if (active) setEnginesLoading(false);
    });
    return () => { active = false; };
  }, [enabled, engineReload]);

  const reloadEngines = useCallback(() => setEngineReload((current) => current + 1), []);

  const loadModels = useCallback(async (engineId: string) => {
    if (!enabled || !engineId || modelCache.current.has(engineId)) return;
    const pending = inFlight.current.get(engineId);
    if (pending) return pending;
    setLoadingModels((current) => new Set(current).add(engineId));
    const request = codingApi.models(engineId).then(({ items }) => {
      modelCache.current.set(engineId, items);
      setModelsByEngine((current) => ({ ...current, [engineId]: items }));
      setModelErrors((current) => {
        if (!current[engineId]) return current;
        const next = { ...current };
        delete next[engineId];
        return next;
      });
    }).catch((reason) => {
      setModelsByEngine((current) => ({ ...current, [engineId]: [] }));
      setModelErrors((current) => ({
        ...current,
        [engineId]: reason instanceof Error ? reason.message : 'Could not load coding models.',
      }));
    }).finally(() => {
      inFlight.current.delete(engineId);
      setLoadingModels((current) => {
        const next = new Set(current);
        next.delete(engineId);
        return next;
      });
    });
    inFlight.current.set(engineId, request);
    return request;
  }, [enabled]);

  return {
    engines,
    enginesLoading,
    error: engineError,
    modelError: (engineId) => modelErrors[engineId] || '',
    modelIds: (engineId) => modelsByEngine[engineId] ?? null,
    modelsLoading: (engineId) => loadingModels.has(engineId),
    loadModels,
    reloadEngines,
  };
}
