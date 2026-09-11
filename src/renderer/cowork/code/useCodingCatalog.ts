import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { codingApi, type EngineCapability } from './api';
import { onMindsHubCredentialChanged } from '../../platform/host';

export interface CodingCatalog {
  /** Model-loading effects depend on this, not on callback identity. */
  revision: number;
  engines: EngineCapability[];
  enginesLoading: boolean;
  error: string;
  modelError: (engineId: string) => string;
  modelIds: (engineId: string) => string[] | null;
  modelsLoading: (engineId: string) => boolean;
  loadModels: (engineId: string) => Promise<void>;
}

const EMPTY_MODELS: Record<string, string[]> = {};

export function useCodingCatalog(enabled = true): CodingCatalog {
  const [engines, setEngines] = useState<EngineCapability[]>([]);
  const [enginesLoading, setEnginesLoading] = useState(enabled);
  const [modelsByEngine, setModelsByEngine] = useState<Record<string, string[]>>(EMPTY_MODELS);
  const [loadingModels, setLoadingModels] = useState<Set<string>>(() => new Set());
  const [engineError, setEngineError] = useState('');
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  const modelCache = useRef(new Map<string, string[]>());
  const inFlight = useRef(new Map<string, Promise<void>>());
  const generation = useRef(0);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    return onMindsHubCredentialChanged(() => {
      // Fence old responses immediately, before React commits the refresh.
      generation.current += 1;
      setRevision((current) => current + 1);
    });
  }, [enabled]);

  // Reset before consumers' model-loading effects run. Only the catalogue is
  // reset: the mounted task/project form retains its draft and selections.
  useLayoutEffect(() => {
    generation.current += 1;
    modelCache.current.clear();
    inFlight.current.clear();
    setEngines([]);
    setEnginesLoading(enabled);
    setEngineError('');
    setModelsByEngine(EMPTY_MODELS);
    setModelErrors({});
    setLoadingModels(new Set());
    return () => { generation.current += 1; };
  }, [enabled, revision]);

  useEffect(() => {
    if (!enabled) return undefined;
    const requestGeneration = generation.current;
    setEnginesLoading(true);
    codingApi.engines().then((items) => {
      if (requestGeneration === generation.current) {
        setEngines(items);
        setEngineError('');
      }
    }).catch((reason) => {
      if (requestGeneration === generation.current) setEngineError(reason instanceof Error ? reason.message : 'Could not load coding agents.');
    }).finally(() => {
      if (requestGeneration === generation.current) setEnginesLoading(false);
    });
  }, [enabled, revision]);

  const loadModels = useCallback(async (engineId: string) => {
    if (!enabled || !engineId || modelCache.current.has(engineId)) return;
    const pending = inFlight.current.get(engineId);
    if (pending) return pending;
    const requestGeneration = generation.current;
    setLoadingModels((current) => new Set(current).add(engineId));
    const request = codingApi.models(engineId).then(({ items }) => {
      if (requestGeneration !== generation.current) return;
      modelCache.current.set(engineId, items);
      setModelsByEngine((current) => ({ ...current, [engineId]: items }));
      setModelErrors((current) => {
        if (!current[engineId]) return current;
        const next = { ...current };
        delete next[engineId];
        return next;
      });
    }).catch((reason) => {
      if (requestGeneration !== generation.current) return;
      setModelsByEngine((current) => ({ ...current, [engineId]: [] }));
      setModelErrors((current) => ({
        ...current,
        [engineId]: reason instanceof Error ? reason.message : 'Could not load coding models.',
      }));
    }).finally(() => {
      if (requestGeneration !== generation.current) return;
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
    revision,
    engines,
    enginesLoading,
    error: engineError,
    modelError: (engineId) => modelErrors[engineId] || '',
    modelIds: (engineId) => modelsByEngine[engineId] ?? null,
    modelsLoading: (engineId) => loadingModels.has(engineId),
    loadModels,
  };
}
