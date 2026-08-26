import { useState, useMemo, useCallback } from 'react';
import { MODEL_ROUTER } from '../lib/modelCatalog';
import { recommendedModelOptions, providerValueToType,
         mergeRecommendedModels } from '../lib/settingsTransform';
import { fetchRecommendedModels } from '../api';

// Model selection + availability for the composer's model picker. Owns the
// selected planning model, the recommended-model list for the active provider,
// the picker-metadata bag, and the wallet-availability refresh. The app-wide
// settings store stays in AppCore and is injected as `settings` / `setSettings`;
// the ~14 read sites (composer, ChatView, task launch) consume this return
// unchanged.
export function useModels({ settings, setSettings }) {
  // Composer model options for the active (planning) provider. Sourced from
  // the backend-overlaid recommendedModels map (single source of truth in
  // cowork-server) — names come from MindsHub's own label for the model where
  // it publishes one, else derived from the id, never hardcoded. Empty until
  // settings load; the composer then shows just the configured model.
  const mindsModels = useMemo(() => (
    recommendedModelOptions(settings.recommendedModels, 'minds-cloud', settings.modelLabels)
      .map((o) => ({ id: o.id, name: o.label }))
  ), [settings.recommendedModels, settings.modelLabels]);
  const models = useMemo(() => {
    const providerType = providerValueToType(settings.planningProvider) || 'minds-cloud';
    if (providerType === 'minds-cloud') return mindsModels;
    return recommendedModelOptions(settings.recommendedModels, providerType, settings.modelLabels)
      .map((o) => ({ id: o.id, name: o.label }));
  }, [mindsModels, settings.recommendedModels, settings.planningProvider, settings.modelLabels]);

  // Re-check wallet availability when the composer's model menu opens, so a top-up
  // made outside the app unlocks its models without a restart. This is what makes
  // it safe for the composer to DISABLE a locked model at all: `modelEnabled` is
  // otherwise refreshed only by the Settings picker, so a user who hits "Add
  // credits" (which opens an external browser), tops up and comes back would find
  // the row still greyed until they visited Settings or restarted. Settings has had
  // this since ENG-412; this is parity with it.
  //
  // A failed refresh leaves the map we hold in place — mergeRecommendedModels never
  // lets an empty response overwrite it, and a model absent from the map counts as
  // available — so this can never lock the picker.
  const refreshModelAvailability = useCallback(async () => {
    const data = await fetchRecommendedModels({ refresh: true });
    // keepOrder: the menu is already open on the list we hold when this lands.
    const merged = mergeRecommendedModels(settings, data, { keepOrder: true });
    if (merged) setSettings((prev) => ({ ...prev, ...merged }));
  }, [settings, setSettings]);

  // Picker metadata for the composer's model menu, passed as one bag so the
  // components in between don't grow a prop each. The composer groups rather than
  // App because ChatView builds its own single-item list, which stays ungrouped.
  const modelMeta = useMemo(() => ({
    modelProviders: settings.modelProviders,
    modelFamilies: settings.modelFamilies,
    modelEnabled: settings.modelEnabled,
    // Which models advertise reasoning-effort levels (ENG-1940) — same
    // settings key SettingsView's per-role effort picker reads, so
    // Composer's EffortSelect stays in lockstep with it.
    modelEfforts: settings.modelEfforts,
    // Account-wide harness toggle (web-only Settings → Agent Harness) —
    // EffortSelect needs this outside coding mode, where Composer's own
    // harness state is hardcoded 'anton' and can't say whether Hermes is
    // actually configured account-wide.
    harness: settings.harness,
    onRefresh: refreshModelAvailability,
  }), [settings.modelProviders, settings.modelFamilies, settings.modelEnabled, settings.modelEfforts, settings.harness, refreshModelAvailability]);

  // Defaults to "Model Router" — defer to whatever this account's Settings
  // has configured — until a composer picks a concrete model for a task.
  // Never re-synced from settings after that: its whole point is that it
  // always tracks Settings live, server-side, without the renderer needing
  // to know the current planning/coding/router model.
  const [selectedModel, setSelectedModel] = useState(MODEL_ROUTER);

  return { selectedModel, setSelectedModel, mindsModels, models, modelMeta, refreshModelAvailability };
}
