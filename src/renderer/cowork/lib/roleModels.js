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

// Build the ordered option list for a role from the server's recommended-models
// map: `label` becomes the display `name`, each model gets a per-tier `locked`
// flag, and unlocked models are surfaced first so a free user reaches a
// selectable model without scrolling past locked frontier ones.
export function buildRoleModels(recommendedModels, providerType, tier) {
  const mapped = recommendedModelOptions(recommendedModels, providerType)
    .map((o) => ({ id: o.id, name: o.label, locked: isModelLocked(o, tier) }));
  return orderUnlockedFirst(mapped);
}

// Ensure the active selection is present in (and ordered within) the list. When
// the selection isn't in the live list, prepend it carrying a computed `locked`
// flag, then re-order so a locked selection can't sit above unlocked models.
// Returns the original list unchanged when the selection is already present.
export function withSelectionFirst(selected, list, tier) {
  if (!selected || list.some((m) => m.id === selected.id)) return list;
  const withSelected = [{ ...selected, locked: isModelLocked(selected, tier) }, ...list];
  return orderUnlockedFirst(withSelected);
}
