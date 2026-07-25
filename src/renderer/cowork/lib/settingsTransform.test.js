import { describe, it, expect } from 'vitest';
import {
  resolveModelPickerValue,
  buildModelOptions,
  diffSettingsForWrite,
  effectiveRoleModel,
  effectiveRoleProvider,
  recommendedModelOptions,
  mergeRecommendedModels,
} from './settingsTransform';

// The minds-cloud recommended list holds bare aliases — never `latest:`-prefixed.
const MINDS_LIST = ['sonnet', 'opus', 'mindshub_air', 'haiku'];
const ANTHROPIC_LIST = ['claude-opus-4-8', 'claude-sonnet-5'];

describe('resolveModelPickerValue', () => {
  // ─── ENG-739 regression ─────────────────────────────────────────────
  it('surfaces a login-written `latest:` minds-cloud pin as a selectable placeholder, not phantom __custom__', () => {
    const r = resolveModelPickerValue('latest:sonnet', MINDS_LIST, /* allowOther */ false);
    // The bug: this used to be inputMode=true / selectValue='__custom__',
    // which minds-cloud never renders as an <option> → control desyncs →
    // re-picking a model fires no change → "Saved" writes nothing.
    expect(r.inputMode).toBe(false);
    expect(r.showStalePin).toBe(true);
    // selectValue matches the placeholder <option value="__stale__">, so the
    // stored pin is what's shown as "current" and any real pick is a change.
    expect(r.selectValue).toBe('__stale__');
  });

  it('leaves a listed minds-cloud model selected directly (value matches its option)', () => {
    const r = resolveModelPickerValue('mindshub_air', MINDS_LIST, false);
    expect(r).toEqual({
      savedIsCustom: false,
      showStalePin: false,
      inputMode: false,
      selectValue: 'mindshub_air',
    });
  });

  // ─── allowOther providers: free-text mode preserved ─────────────────
  it('routes a not-listed model to free-text (__custom__) for allowOther providers', () => {
    const r = resolveModelPickerValue('my-fine-tune-123', ANTHROPIC_LIST, /* allowOther */ true);
    expect(r.savedIsCustom).toBe(true);
    expect(r.inputMode).toBe(true);
    expect(r.showStalePin).toBe(false);
    expect(r.selectValue).toBe('__custom__');
  });

  it('does not force a stale placeholder for allowOther providers', () => {
    const r = resolveModelPickerValue('latest:sonnet', ANTHROPIC_LIST, true);
    expect(r.showStalePin).toBe(false);
    expect(r.inputMode).toBe(true);
    expect(r.selectValue).toBe('__custom__');
  });

  // ─── forceCustom (user toggled "Other…") ────────────────────────────
  it('honours an explicit "Other…" toggle even when the model is listed', () => {
    const r = resolveModelPickerValue('claude-opus-4-8', ANTHROPIC_LIST, true, /* forceCustom */ true);
    expect(r.inputMode).toBe(true);
    expect(r.selectValue).toBe('__custom__');
  });

  // ─── ENG-739 review: forceCustom must not wedge a non-allowOther provider ─
  it('ignores a lingering forceCustom when the provider does not allow free text', () => {
    // Repro: user toggled "Other…" on Anthropic (forceCustom stays true), then
    // repointed to minds-cloud (allowOther=false) without a provider onChange to
    // reset it. minds-cloud renders neither a __custom__ option nor a text input,
    // so __custom__ would be a blank, unwritable select. Must stay selectable.
    const r = resolveModelPickerValue('mindshub_air', MINDS_LIST, /* allowOther */ false, /* forceCustom */ true);
    expect(r.inputMode).toBe(false);
    expect(r.selectValue).toBe('mindshub_air');
  });

  it('shows the stale placeholder (not __custom__) for a minds-cloud pin even with forceCustom', () => {
    const r = resolveModelPickerValue('latest:sonnet', MINDS_LIST, false, /* forceCustom */ true);
    expect(r.inputMode).toBe(false);
    expect(r.showStalePin).toBe(true);
    expect(r.selectValue).toBe('__stale__');
  });

  // ─── edge cases ─────────────────────────────────────────────────────
  it('treats an unset model as directly selectable (no placeholder, no custom)', () => {
    const r = resolveModelPickerValue('', MINDS_LIST, false);
    expect(r.showStalePin).toBe(false);
    expect(r.inputMode).toBe(false);
    expect(r.selectValue).toBe('');
  });

  it('tolerates a missing/undefined model list', () => {
    const r = resolveModelPickerValue('sonnet', undefined, false);
    expect(r.showStalePin).toBe(true);
    expect(r.selectValue).toBe('__stale__');
  });
});

// ─── ENG-739 self-serve recovery (the whole point of the picker fix) ──
//
// This is the safe recovery path the reviewer asked us to guarantee: rather
// than auto-deleting a `latest:` pin (which we removed as unsafe — a user can
// deliberately set one), a stuck user picks an enabled model and Save writes a
// *real* change. Chains the two pure functions the UI uses so the picker fix is
// proven end-to-end at the client layer.
describe('ENG-739 stale-pin recovery writes the chosen model', () => {
  it('latest:sonnet pin → picking mindshub_air produces a real planning_model write', () => {
    // 1. Picker surfaces the stale pin as a selectable placeholder (not a
    //    phantom __custom__ that would swallow the change).
    const picker = resolveModelPickerValue('latest:sonnet', MINDS_LIST, /* allowOther */ false);
    expect(picker.selectValue).toBe('__stale__');

    // 2. User selects an enabled model; Save diffs against the stored pin and
    //    emits the server-key write. Before the fix the control never fired a
    //    change, so this diff was empty and "Saved" was a no-op.
    const writes = diffSettingsForWrite(
      { planningModel: 'mindshub_air' },
      { planningModel: 'latest:sonnet' },
    );
    expect(writes).toEqual({ planning_model: 'mindshub_air' });
  });

  it('re-selecting the same stale pin writes nothing (no accidental churn)', () => {
    const writes = diffSettingsForWrite(
      { planningModel: 'latest:sonnet' },
      { planningModel: 'latest:sonnet' },
    );
    expect(writes).toEqual({});
  });
});

// ─── buildModelOptions — the <Select> options list paired with the values
// resolveModelPickerValue can return. Every value it can produce
// (curModel, '__stale__', '__custom__') must appear here, or the ENG-739
// invariant ("selectValue always matches a rendered option") breaks again
// one layer up, in the option list rather than the resolved value.
describe('buildModelOptions', () => {
  it('renders a disabled legacy placeholder first when showStalePin is set', () => {
    const options = buildModelOptions('latest:sonnet', MINDS_LIST, false, true);
    expect(options[0]).toEqual({
      value: '__stale__',
      label: 'sonnet (legacy — re-select a model)',
      disabled: true,
    });
  });

  it('omits the legacy placeholder when showStalePin is false', () => {
    const options = buildModelOptions('mindshub_air', MINDS_LIST, false, false);
    expect(options.some((o) => o.value === '__stale__')).toBe(false);
  });

  it('lists every model in the recommended list, disabling locked ones', () => {
    const options = buildModelOptions('sonnet', MINDS_LIST, false, false, { opus: false });
    const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
    expect(byValue.sonnet).toEqual({ value: 'sonnet', label: 'sonnet', disabled: false });
    expect(byValue.opus).toEqual({ value: 'opus', label: 'opus — Add credits to unlock', disabled: true });
  });

  it('appends an "Other…" entry only when allowOther is true', () => {
    const withOther = buildModelOptions('claude-opus-4-8', ANTHROPIC_LIST, true, false);
    expect(withOther.at(-1)).toEqual({ value: '__custom__', label: 'Other…' });

    const withoutOther = buildModelOptions('mindshub_air', MINDS_LIST, false, false);
    expect(withoutOther.some((o) => o.value === '__custom__')).toBe(false);
  });

  it('tolerates a missing/undefined model list', () => {
    expect(buildModelOptions('sonnet', undefined, false, false)).toEqual([]);
  });

  it("every selectValue resolveModelPickerValue can return matches a rendered option's value", () => {
    // Stale-pin case.
    const stale = resolveModelPickerValue('latest:sonnet', MINDS_LIST, false);
    const staleOptions = buildModelOptions('latest:sonnet', MINDS_LIST, false, stale.showStalePin);
    expect(staleOptions.map((o) => o.value)).toContain(stale.selectValue);

    // Custom (__custom__) case.
    const custom = resolveModelPickerValue('my-fine-tune-123', ANTHROPIC_LIST, true);
    const customOptions = buildModelOptions('my-fine-tune-123', ANTHROPIC_LIST, true, custom.showStalePin);
    expect(customOptions.map((o) => o.value)).toContain(custom.selectValue);

    // Directly-listed case.
    const listed = resolveModelPickerValue('mindshub_air', MINDS_LIST, false);
    const listedOptions = buildModelOptions('mindshub_air', MINDS_LIST, false, listed.showStalePin);
    expect(listedOptions.map((o) => o.value)).toContain(listed.selectValue);
  });

  // ─── ENG-1049: the picker showed ids derived into names ("Mindshub Air")
  // instead of the policy's own labels ("MindsHub Air"). The label is
  // display-only — `value` stays the alias everything else is keyed on.
  it('prefers MindsHub\'s label over the id-derived one, keeping the id as the value', () => {
    const labels = { mindshub_air: 'MindsHub Air', opus: 'Claude Opus 5' };
    const options = buildModelOptions('sonnet', MINDS_LIST, false, false, {}, labels);
    const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
    expect(byValue.mindshub_air.label).toBe('MindsHub Air');
    expect(byValue.opus.label).toBe('Claude Opus 5');
    // No label published for this one, so the derived form still shows.
    expect(byValue.sonnet.label).toBe('sonnet');
  });

  it('keeps the locked suffix on a labelled model', () => {
    const options = buildModelOptions('sonnet', MINDS_LIST, false, false, { opus: false }, { opus: 'Claude Opus 5' });
    const opus = options.find((o) => o.value === 'opus');
    expect(opus).toEqual({ value: 'opus', label: 'Claude Opus 5 — Add credits to unlock', disabled: true });
  });

  it('labels the legacy placeholder from the label map too', () => {
    const options = buildModelOptions('latest:sonnet', MINDS_LIST, false, true, {}, { sonnet: 'Claude Sonnet 5' });
    expect(options[0].label).toBe('Claude Sonnet 5 (legacy — re-select a model)');
  });
});

// ─── recommendedModelOptions — the composer's model dropdown. Same label
// rule as the Settings picker, or the two disagree about a model's name.
describe('recommendedModelOptions', () => {
  const rec = { 'minds-cloud': ['mindshub_air', 'sonnet'] };

  it('uses MindsHub\'s label when there is one, the derived label otherwise', () => {
    const options = recommendedModelOptions(rec, 'minds-cloud', { mindshub_air: 'MindsHub Air' });
    expect(options).toEqual([
      { id: 'mindshub_air', label: 'MindsHub Air' },
      { id: 'sonnet', label: 'sonnet' },
    ]);
  });

  it('falls back to derived labels with no label map at all', () => {
    expect(recommendedModelOptions(rec, 'minds-cloud')).toEqual([
      { id: 'mindshub_air', label: 'mindshub_air' },
      { id: 'sonnet', label: 'sonnet' },
    ]);
  });

  it('returns [] for a provider with no list', () => {
    expect(recommendedModelOptions(rec, 'anthropic')).toEqual([]);
    expect(recommendedModelOptions(undefined, 'minds-cloud')).toEqual([]);
  });
});

// ─── mergeRecommendedModels — the one rule for folding a
// /settings/recommended-models response into settings. Used by the mount-time
// load and by the picker's on-open refresh, which is the whole point: the
// refresh used to assign the response straight through, so a failed MindsHub
// fetch (still a 200, with empty buckets) emptied the dropdown until restart.
describe('mergeRecommendedModels', () => {
  const held = {
    recommendedModels: { 'minds-cloud': ['mindshub_air', 'sonnet'], anthropic: ['claude-opus-5'] },
    recommendedPair: { 'minds-cloud': ['sonnet', 'haiku', 'kimi'] },
    modelEfforts: { sonnet: { efforts: ['low', 'high'], default: 'high' } },
    modelEnabled: { mindshub_air: true, sonnet: false },
    modelLabels: { mindshub_air: 'MindsHub Air' },
  };

  it('takes the live values when the server has them', () => {
    const merged = mergeRecommendedModels(held, {
      recommendedModels: { 'minds-cloud': ['mindshub_air', 'sonnet', 'opus'] },
      recommendedPair: {},
      modelEfforts: {},
      modelEnabled: { mindshub_air: true, sonnet: true, opus: true },
      modelLabels: { opus: 'Claude Opus 5' },
    });
    expect(merged.recommendedModels['minds-cloud']).toEqual(['mindshub_air', 'sonnet', 'opus']);
    // A top-up unlocking paid models is exactly what the refresh is for.
    expect(merged.modelEnabled).toEqual({ mindshub_air: true, sonnet: true, opus: true });
    expect(merged.modelLabels).toEqual({ opus: 'Claude Opus 5' });
    // Buckets the response left empty keep what we already had.
    expect(merged.recommendedPair).toEqual(held.recommendedPair);
    expect(merged.modelEfforts).toEqual(held.modelEfforts);
  });

  it('keeps the model list when the MindsHub fetch failed behind a 200', () => {
    // What cowork-server answers when its own /v1/models call fails:
    // RECOMMENDED_MODELS['minds-cloud'] is an empty placeholder, and the live
    // overlay is skipped. Assigning this through emptied the picker.
    const merged = mergeRecommendedModels(held, {
      recommendedModels: { 'minds-cloud': [], anthropic: [], openai: [] },
      recommendedPair: { 'minds-cloud': ['sonnet', 'haiku', 'kimi'] },
      modelEfforts: {},
      modelEnabled: {},
      modelLabels: {},
    });
    expect(merged.recommendedModels['minds-cloud']).toEqual(['mindshub_air', 'sonnet']);
    expect(merged.recommendedModels.anthropic).toEqual(['claude-opus-5']);
    // An empty enabled map reads as "everything available" and would silently
    // unlock paid models; cowork-server refuses to persist one for the same reason.
    expect(merged.modelEnabled).toEqual(held.modelEnabled);
    expect(merged.modelLabels).toEqual(held.modelLabels);
    expect(merged.modelEfforts).toEqual(held.modelEfforts);
  });

  it('returns null when the request itself failed, so the caller changes nothing', () => {
    expect(mergeRecommendedModels(held, null)).toBeNull();
    expect(mergeRecommendedModels(held, undefined)).toBeNull();
  });

  it('populates from empty on first load', () => {
    const merged = mergeRecommendedModels(
      { recommendedModels: { 'minds-cloud': [] }, recommendedPair: {} },
      {
        recommendedModels: { 'minds-cloud': ['mindshub_air'] },
        recommendedPair: { 'minds-cloud': ['sonnet', 'haiku', 'kimi'] },
        modelEnabled: { mindshub_air: true },
        modelLabels: { mindshub_air: 'MindsHub Air' },
      },
    );
    expect(merged.recommendedModels['minds-cloud']).toEqual(['mindshub_air']);
    expect(merged.modelEnabled).toEqual({ mindshub_air: true });
    expect(merged.modelLabels).toEqual({ mindshub_air: 'MindsHub Air' });
    // Absent from the response entirely, not just empty.
    expect(merged.modelEfforts).toEqual({});
  });

  it('tolerates missing settings keys', () => {
    const merged = mergeRecommendedModels({}, { recommendedModels: { 'minds-cloud': ['sonnet'] } });
    expect(merged.recommendedModels).toEqual({ 'minds-cloud': ['sonnet'] });
    expect(merged.modelEnabled).toEqual({});
  });
});

describe('effectiveRoleModel / effectiveRoleProvider — canonical fields, never model_overrides (ENG-739 reopen)', () => {
  // The exact real-hardware divergence captured on the free-tier machine:
  // the server executes planning_model = latest:sonnet (→ 403 → card), while
  // model_overrides.planning = mindshub_air (what the old picker displayed as
  // already-selected → no change → Save disabled → no recovery).
  const drifted = {
    modelMode: 'custom',
    planningModel: 'latest:sonnet',
    codingModel: 'latest:haiku',
    planningProvider: 'minds_cloud',
    codingProvider: 'minds_cloud',
    modelOverrides: {
      planning: { providerType: 'minds-cloud', model: 'mindshub_air' },
      coding: { providerType: 'minds-cloud', model: 'mindshub_air' },
    },
  };

  it('returns the executed planning_model (the pin), NOT the model_overrides value', () => {
    expect(effectiveRoleModel(drifted, 'planning')).toBe('latest:sonnet');
    expect(effectiveRoleModel(drifted, 'coding')).toBe('latest:haiku');
  });

  it('feeding the effective model to the picker surfaces the stale placeholder', () => {
    const picker = resolveModelPickerValue(effectiveRoleModel(drifted, 'planning'), MINDS_LIST, false);
    expect(picker.showStalePin).toBe(true);
    expect(picker.selectValue).toBe('__stale__'); // mindshub_air is now a real, savable change
  });

  it('resolves the provider from the canonical field, mapped to client type', () => {
    expect(effectiveRoleProvider(drifted, 'planning')).toBe('minds-cloud');
  });

  it('planning falls back to defaultModel when planningModel is unset', () => {
    expect(effectiveRoleModel({ defaultModel: 'sonnet' }, 'planning')).toBe('sonnet');
  });

  it('unset provider defaults to minds-cloud', () => {
    expect(effectiveRoleProvider({}, 'planning')).toBe('minds-cloud');
  });
})
