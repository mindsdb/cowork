// Role-scoped model-list helpers for the composer's two-role picker (ENG-531).
// Pure functions so the Planning/Coding derivation is shared by both roles and
// unit-testable without a React harness. App.jsx wires these into memos.

import { recommendedModelOptions } from './settingsTransform';
import { isModelLocked, orderUnlockedFirst } from './modelEntitlement';

// Settings key a composer role writes through to. Anything that isn't the
// coding role maps to planning (the default / per-message model).
export function settingKeyForRole(role) {
  return role === 'coding' ? 'codingModel' : 'planningModel';
}

// Resolve a model's locked state: the server's per-model availability map
// (`modelEnabled`, id → bool; `false` = tier can't use it) is the source of
// truth, with the client tier heuristic as the fallback when the server has no
// entry for that id. Absent id ⇒ defer to the heuristic (direct providers have
// no availability flag).
export function isRoleModelLocked(model, tier, modelEnabled = {}) {
  const id = model && model.id;
  // When the server has an opinion on this id (present in the map), it is
  // authoritative both ways: false = locked, true = unlocked (overrides the
  // heuristic). Only fall back to the tier heuristic when the id is absent
  // (no server availability info, e.g. dev simulation or direct providers).
  if (id != null && Object.prototype.hasOwnProperty.call(modelEnabled, id)) {
    return modelEnabled[id] === false;
  }
  return isModelLocked(model, tier);
}

// Build the ordered option list for a role from the server's recommended-models
// map: `label` becomes the display `name`, each model gets a `locked` flag
// (server availability first, tier heuristic fallback), and unlocked models are
// surfaced first so a free user reaches a selectable model without scrolling
// past locked frontier ones.
export function buildRoleModels(recommendedModels, providerType, tier, modelEnabled = {}, modelLabels = {}) {
  const mapped = recommendedModelOptions(recommendedModels, providerType, modelLabels)
    .map((o) => ({ id: o.id, name: o.label, locked: isRoleModelLocked(o, tier, modelEnabled) }));
  return orderUnlockedFirst(mapped);
}

// Ensure the active selection is present in (and ordered within) the list. When
// the selection isn't in the live list, prepend it carrying a computed `locked`
// flag, then re-order so a locked selection can't sit above unlocked models.
// Returns the original list unchanged when the selection is already present.
export function withSelectionFirst(selected, list, tier, modelEnabled = {}) {
  if (!selected || list.some((m) => m.id === selected.id)) return list;
  const withSelected = [{ ...selected, locked: isRoleModelLocked(selected, tier, modelEnabled) }, ...list];
  return orderUnlockedFirst(withSelected);
}
