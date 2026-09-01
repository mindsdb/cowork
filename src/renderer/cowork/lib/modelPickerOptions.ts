import {
  hasFrozenVersions,
  isFrozenAlias,
  isModelLocked,
  isMovingAlias,
  orderByFamily,
} from './modelCatalog';


export interface ModelPickerSource {
  id: string;
  name: string;
}

export interface ModelPickerMeta {
  modelProviders?: Record<string, string>;
  modelFamilies?: Record<string, string>;
  modelEnabled?: Record<string, boolean>;
  onRefresh?: () => Promise<unknown> | unknown;
}

export interface ModelPickerOption {
  value: string;
  label: string;
  tag?: string;
  provider?: string;
  disabled?: boolean;
  locked?: boolean;
}

/** Keep a configured/current model usable while a live catalog is empty or no
 * longer advertises that exact version. The caller supplies the best label it
 * has; every picker then feeds the same source shape into the canonical adapter. */
export function withModelPickerFallback(
  models: ModelPickerSource[] = [],
  id = '',
  name = id,
): ModelPickerSource[] {
  const list = (models || []).filter(Boolean);
  if (!id || list.some((model) => model.id === id)) return list;
  return [{ id, name: name || id }, ...list];
}

/**
 * Build the canonical model rows consumed by ModelSelect.
 *
 * Both Cowork and Code use this function so display names, provider groups,
 * moving-version tags, and wallet state cannot drift between workspaces.
 * ModelSelect owns the visual treatment and grouping; this helper only adapts
 * the settings catalog into its option contract.
 */
export function buildModelPickerOptions(
  models: ModelPickerSource[] = [],
  modelMeta: ModelPickerMeta = {},
): ModelPickerOption[] {
  const { modelProviders = {}, modelFamilies = {}, modelEnabled = {} } = modelMeta || {};
  const list = (models || []).filter(Boolean);
  const ids = list.map((model) => model.id);
  const byId = new Map(list.map((model) => [model.id, model]));
  const ordered = orderByFamily(ids, modelFamilies)
    .map((id: string) => byId.get(id))
    .filter((model: ModelPickerSource | undefined): model is ModelPickerSource => Boolean(model));
  const tagMoving = hasFrozenVersions(ids, modelFamilies);

  return ordered.map((model: ModelPickerSource) => {
    const locked = isModelLocked(modelEnabled, model.id);
    const tag = [
      tagMoving && isMovingAlias(model.id, modelFamilies) ? 'Latest' : '',
      isFrozenAlias(model.id, modelFamilies) && byId.has(modelFamilies[model.id]) ? 'Older version' : '',
      locked ? 'Needs credits' : '',
    ].filter(Boolean).join(' · ');

    return {
      value: model.id,
      label: model.name,
      ...(locked ? { disabled: true, locked: true } : {}),
      ...(tag ? { tag } : {}),
      ...(modelProviders[model.id] ? { provider: modelProviders[model.id] } : {}),
    };
  });
}
