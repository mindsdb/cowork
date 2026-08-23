import {
  hasFrozenVersions,
  isFrozenAlias,
  isMovingAlias,
  orderByFamily,
} from './modelCatalog';

/** Keep a configured/current model usable while a live catalog is empty or no
 * longer advertises that exact version. The caller supplies the best label it
 * has; every picker then feeds the same source shape into the canonical adapter. */
export function withModelPickerFallback(models = [], id = '', name = id) {
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
export function buildModelPickerOptions(models = [], modelMeta = {}) {
  const { modelProviders = {}, modelFamilies = {}, modelEnabled = {} } = modelMeta || {};
  const list = (models || []).filter(Boolean);
  const ids = list.map((model) => model.id);
  const byId = new Map(list.map((model) => [model.id, model]));
  const ordered = orderByFamily(ids, modelFamilies).map((id) => byId.get(id)).filter(Boolean);
  const tagMoving = hasFrozenVersions(ids, modelFamilies);

  return ordered.map((model) => {
    const tag = [
      tagMoving && isMovingAlias(model.id, modelFamilies) ? 'Latest' : '',
      isFrozenAlias(model.id, modelFamilies) && byId.has(modelFamilies[model.id]) ? 'Older version' : '',
      modelEnabled[model.id] === false ? 'Needs credits' : '',
    ].filter(Boolean).join(' · ');

    return {
      value: model.id,
      label: model.name,
      ...(tag ? { tag } : {}),
      ...(modelProviders[model.id] ? { provider: modelProviders[model.id] } : {}),
    };
  });
}
