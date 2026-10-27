import { MODEL_ROUTER_ID, isModelLocked, orderByFamily, unavailableModelFields } from './modelCatalog';
import type { ModelDisabledReason } from './modelCatalog';


export interface ModelPickerSource {
  id: string;
  name: string;
}

export interface ModelPickerMeta {
  modelProviders?: Record<string, string>;
  modelFamilies?: Record<string, string>;
  modelEnabled?: Record<string, boolean>;
  /** Why MindsHub lists a model as unavailable, id → reason. Only rows with
   * `modelEnabled[id] === false` carry one; absent on older servers. */
  modelDisabledReasons?: Record<string, ModelDisabledReason>;
  /** Per-model reasoning effort levels the gateway advertises: id → { efforts, default }. */
  modelEfforts?: Record<string, { efforts: string[]; default?: string }>;
  onRefresh?: () => Promise<unknown> | unknown;
}

export interface ModelPickerOption {
  value: string;
  label: string;
  tag?: string;
  provider?: string;
  disabled?: boolean;
  /** The wallet or the spent allowance closes this row; ModelSelect adds "Add credits". */
  locked?: boolean;
  /** An org admin's model rule closes this row; no credits action applies. */
  restricted?: boolean;
  /** Row tooltip. */
  title?: string;
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
  const {
    modelProviders = {}, modelFamilies = {}, modelEnabled = {}, modelDisabledReasons = {},
  } = modelMeta || {};
  const list = (models || []).filter(Boolean);
  const ids = list.map((model) => model.id);
  const byId = new Map(list.map((model) => [model.id, model]));
  const ordered = orderByFamily(ids, modelFamilies)
    .map((id: string) => byId.get(id))
    .filter((model: ModelPickerSource | undefined): model is ModelPickerSource => Boolean(model));

  return ordered.map((model: ModelPickerSource) => {
    return {
      value: model.id,
      label: model.name,
      /* Availability is the only row tag: "Needs credits" for the
         wallet or the allowance, "Restricted" for an admin's model rule, from
         the helper the Settings builder shares. Version state needs none: the
         name carries the version and orderByFamily seats a pinned version
         under its head. The old "Latest" / "Older version" pills sat on most
         rows and pushed long names into an ellipsis. */
      ...unavailableModelFields(modelEnabled, modelDisabledReasons, model.id),
      ...(modelProviders[model.id] ? { provider: modelProviders[model.id] } : {}),
    };
  });
}

/**
 * The models an operator's picker offers (see lib/modelPicker): the catalog's models, less each
 * one it lists as not enabled. The operator's server lists a model it routes but doesn't let users
 * pick as `enabled: false`, so the picker leaves it out rather than show it locked.
 */
export function offeredModels<T extends ModelPickerSource>(
  models: T[] = [],
  modelEnabled: Record<string, boolean> = {},
): T[] {
  return (models || []).filter((model) => model && !isModelLocked(modelEnabled, model.id));
}

/**
 * The model a question sends under an operator's picker. A model the picker doesn't offer, such as
 * the one a reopened conversation was saved on before the operator removed it, becomes
 * MODEL_ROUTER_ID: the operator's own model, which api.js sends as no model at all. No model stays
 * no model.
 */
export function offeredModelId(
  modelId: string | null | undefined,
  offered: ModelPickerSource[],
): string | null {
  if (!modelId || modelId === MODEL_ROUTER_ID) return modelId || null;
  return offered.some((model) => model.id === modelId) ? modelId : MODEL_ROUTER_ID;
}
