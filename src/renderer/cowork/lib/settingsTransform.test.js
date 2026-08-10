import { describe, it, expect } from 'vitest';
import {
  resolveModelPickerValue,
  buildModelOptions,
  diffSettingsForWrite,
  effectiveRoleModel,
  effectiveRoleProvider,
  recommendedModelOptions,
  mergeRecommendedModels,
  clampBudgetValue,
  clampBudgets,
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
      pin: 'top',
    });
  });

  it('omits the legacy placeholder when showStalePin is false', () => {
    const options = buildModelOptions('mindshub_air', MINDS_LIST, false, false);
    expect(options.some((o) => o.value === '__stale__')).toBe(false);
  });

  // ENG-1248: a model the wallet can't pay for stays selectable — a disabled
  // row was a dead-end click. The row carries a right-aligned tag instead.
  it('lists every model in the recommended list, tagging needs-credits ones but keeping them selectable', () => {
    const options = buildModelOptions('sonnet', MINDS_LIST, false, false, { opus: false });
    const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
    expect(byValue.sonnet).toEqual({ value: 'sonnet', label: 'sonnet', disabled: false });
    expect(byValue.opus).toEqual({ value: 'opus', label: 'opus', disabled: false, tag: 'Needs credits' });
  });

  it('appends an "Other…" entry only when allowOther is true', () => {
    const withOther = buildModelOptions('claude-opus-4-8', ANTHROPIC_LIST, true, false);
    expect(withOther.at(-1)).toEqual({ value: '__custom__', label: 'Other…', pin: 'bottom' });

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

  it('keeps the bare label on a labelled needs-credits model, moving the wallet state to the tag', () => {
    const options = buildModelOptions('sonnet', MINDS_LIST, false, false, { opus: false }, { opus: 'Claude Opus 5' });
    const opus = options.find((o) => o.value === 'opus');
    expect(opus).toEqual({ value: 'opus', label: 'Claude Opus 5', disabled: false, tag: 'Needs credits' });
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

describe('agent tool-budget settings (max_tool_rounds / max_continuations)', () => {
  it('transforms server rows into camelCase string values', async () => {
    const { transformSettingsRows } = await import('./settingsTransform');
    const rows = [
      { key: 'max_tool_rounds', value: '50', is_sensitive: false, is_set: false },
      { key: 'max_continuations', value: '5', is_sensitive: false, is_set: false },
    ];
    const s = transformSettingsRows(rows);
    // Strings, not numbers: the page-wide dirty compare is a JSON diff
    // against the post-save re-fetch, so the type must survive the
    // save -> PUT -> re-fetch round trip unchanged.
    expect(s.maxToolRounds).toBe('50');
    expect(s.maxContinuations).toBe('5');
  });

  it('writes changed budgets to their snake_case keys as strings', () => {
    const writes = diffSettingsForWrite(
      { maxToolRounds: '80', maxContinuations: '3' },
      { maxToolRounds: '50', maxContinuations: '3' },
    );
    expect(writes).toEqual({ max_tool_rounds: '80' }); // unchanged key skipped
  });

  it('never writes a budget key the server did not send', () => {
    // Older server (no budget settings): the key is absent from the fetched
    // snapshot, and a PUT would 400 and fail the whole multi-key save. The
    // UI also hides the section in this state; this pins the write layer.
    expect(diffSettingsForWrite({ maxToolRounds: '200' }, { theme: 'dark' })).toEqual({});
    // Non-budget keys keep the old behavior (writable even when absent).
    expect(diffSettingsForWrite({ greeting: 'hi' }, {})).toEqual({ greeting: 'hi' });
  });
});

describe('clampBudgetValue / clampBudgets', () => {
  const spec = { min: 5, max: 500, fallback: 50 };

  it('clamps into range and returns strings', () => {
    expect(clampBudgetValue('80', spec)).toBe('80');
    expect(clampBudgetValue('2', spec)).toBe('5');
    expect(clampBudgetValue('9999', spec)).toBe('500');
    expect(clampBudgetValue(' 50 ', spec)).toBe('50');
  });

  it('treats number-input-legal scientific notation as its numeric value', () => {
    // parseInt('5e2') === 5 was the bug: a user-entered 5e2 means 500.
    expect(clampBudgetValue('5e2', spec)).toBe('500');
    expect(clampBudgetValue('1e3', spec)).toBe('500'); // 1000, max-clamped
  });

  it('empty/unparseable input reverts to prev, then fallback', () => {
    // Clearing a saved 500 to retype must not silently save the default.
    expect(clampBudgetValue('', spec, '500')).toBe('500');
    expect(clampBudgetValue('abc', spec, '120')).toBe('120');
    expect(clampBudgetValue('', spec, null)).toBe('50');
    expect(clampBudgetValue('', spec, 'junk')).toBe('50');
    // A stale out-of-range prev (e.g. Escape-dismissed draft) still clamps.
    expect(clampBudgetValue('', spec, '9999')).toBe('500');
  });

  it('clampBudgets clamps present keys and never materializes absent ones', () => {
    const out = clampBudgets({ maxToolRounds: '9999', harness: 'anton' });
    expect(out.maxToolRounds).toBe('500');
    expect(out.harness).toBe('anton');
    // absent keys stay absent: materializing one would create a phantom
    // write — and a failing PUT on an older server without these settings
    expect('maxContinuations' in out).toBe(false);
    // untouched settings object is returned by reference (no spurious dirty)
    const clean = { maxToolRounds: '50', maxContinuations: '5' };
    expect(clampBudgets(clean)).toBe(clean);
  });

  it('clampBudgets drops empty/unparseable drafts instead of defaulting them', () => {
    // An Escape-orphaned '' draft must not become a factory-default write
    // that silently overwrites the user's saved value — no key, no PUT,
    // server keeps what it has.
    const out = clampBudgets({ maxToolRounds: '', maxContinuations: 'abc', harness: 'anton' });
    expect('maxToolRounds' in out).toBe(false);
    expect('maxContinuations' in out).toBe(false);
    expect(out.harness).toBe('anton');
  });
});

// ─── buildModelOptions: version tags + section metadata (ENG-1287) ───
//
// `modelFamilies[id] === id` means the version behind that alias moves, so
// picking it always gets the newest release. Version state rides on `tag`, the
// row's right-aligned pill, never on `label`: the label is what the collapsed
// trigger shows and what the search matches. `modelProviders[id]` is MindsHub's
// authoritative serving-vendor field, which decides the picker section instead of
// the alias-inference in lib/modelCatalog.

const FAMILY_META = {
  modelProviders: { sonnet: 'anthropic', 'sonnet-4-5': 'anthropic', kimi: 'moonshot' },
  modelFamilies: { sonnet: 'sonnet', 'sonnet-4-5': 'sonnet', kimi: 'kimi' },
};
const FAMILY_LABELS = {
  sonnet: 'Claude Sonnet 5',
  'sonnet-4-5': 'Claude Sonnet 4.5',
  kimi: 'Kimi K3',
};

describe('buildModelOptions — moving vs pinned versions', () => {
  it('tags nothing when no model in the list is a frozen version', () => {
    // The tag distinguishes a moving alias from a frozen one. With nothing frozen in
    // the list it would sit on every row and distinguish nothing.
    const options = buildModelOptions('sonnet', ['sonnet', 'kimi'], false, false, {}, FAMILY_LABELS, FAMILY_META);
    const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
    expect(byValue.sonnet).toEqual({ value: 'sonnet', label: 'Claude Sonnet 5', disabled: false, provider: 'anthropic' });
    expect(byValue.kimi).toEqual({ value: 'kimi', label: 'Kimi K3', disabled: false, provider: 'moonshot' });
  });

  it('tags the moving aliases "Latest" once a frozen version is listed', () => {
    const options = buildModelOptions(
      'sonnet', ['sonnet', 'sonnet-4-5', 'kimi'], false, false, {}, FAMILY_LABELS, FAMILY_META,
    );
    const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
    expect(byValue.sonnet.tag).toBe('Latest');
    // Every moving alias, not only the one that has a pin — the tag is a claim
    // about that alias, and it is now readable against a row that lacks it.
    expect(byValue.kimi.tag).toBe('Latest');
    // And the marker stays out of the label: ModelSelect renders the selected
    // option's label verbatim in the collapsed trigger and filters on that same
    // string, so a suffix here would show permanently in the closed control and make
    // typing "latest" match every row.
    expect(byValue.sonnet.label).toBe('Claude Sonnet 5');
    expect(byValue.kimi.label).toBe('Kimi K3');
  });

  it('tags no BYOK model when the metadata covers only MindsHub ids', () => {
    // The shape every call site actually produces: `modelFamilies` is global to the
    // settings blob, `modelList` is per-provider. A user with a MindsHub key who
    // points a role at Anthropic previously saw every row tagged "(latest)",
    // including `claude-haiku-4-5-20251001`, a dated snapshot that never moves.
    const options = buildModelOptions(
      'claude-opus-4-8', ANTHROPIC_LIST, true, false, {}, {},
      { modelProviders: { sonnet: 'anthropic' }, modelFamilies: { sonnet: 'sonnet' } },
    );
    for (const o of options) {
      expect(o.tag).toBeUndefined();
      expect(o.label || '').not.toContain('latest');
      expect(o.label || '').not.toContain('version');
    }
  });

  it('never drops a model, on a family chain or a cycle', () => {
    // Options must stay a permutation of modelList: resolveModelPickerValue
    // resolves the stored model against the unordered list, so a dropped id gives
    // showStalePin === false with no rendered option (the ENG-739 desync class).
    // A Statsig edit reaches the app with no deploy and auth does not validate the
    // family target, so neither shape is theoretical.
    const chain = ['sonnet', 'sonnet-4-5', 'sonnet-4-1'];
    const chainOpts = buildModelOptions('sonnet', chain, false, false, {}, {}, {
      modelProviders: { sonnet: 'anthropic', 'sonnet-4-5': 'anthropic', 'sonnet-4-1': 'anthropic' },
      modelFamilies: { sonnet: 'sonnet', 'sonnet-4-5': 'sonnet', 'sonnet-4-1': 'sonnet-4-5' },
    });
    expect(chainOpts.map((o) => o.value).sort()).toEqual([...chain].sort());

    const cycle = ['a', 'b'];
    const cycleOpts = buildModelOptions('a', cycle, false, false, {}, {}, {
      modelProviders: { a: 'anthropic', b: 'anthropic' },
      modelFamilies: { a: 'b', b: 'a' },
    });
    expect(cycleOpts.map((o) => o.value).sort()).toEqual([...cycle].sort());
  });

  it('marks a frozen version as an older version and never as latest', () => {
    const options = buildModelOptions(
      'sonnet', ['sonnet', 'sonnet-4-5'], false, false, {}, FAMILY_LABELS, FAMILY_META,
    );
    const pin = options.find((o) => o.value === 'sonnet-4-5');
    expect(pin.tag).toBe('Older version');
    expect(pin.label).toBe('Claude Sonnet 4.5');
  });

  it('lists a frozen version directly under the alias it froze', () => {
    // The gateway's order is meaningful upstream (free/baseline model first), so
    // heads keep their positions and only the pin moves to follow its head.
    const options = buildModelOptions(
      'sonnet', ['sonnet', 'kimi', 'sonnet-4-5'], false, false, {}, FAMILY_LABELS, FAMILY_META,
    );
    expect(options.map((o) => o.value)).toEqual(['sonnet', 'sonnet-4-5', 'kimi']);
  });

  it('keeps an orphaned pin listed, untagged, in its own position', () => {
    // A typo'd family in the policy, or a head filtered out upstream. The model is
    // still selectable so it must not vanish — but it must not claim to be latest.
    const options = buildModelOptions('sonnet-4-5', ['sonnet-4-5'], false, false, {}, FAMILY_LABELS, {
      modelProviders: { 'sonnet-4-5': 'anthropic' },
      modelFamilies: { 'sonnet-4-5': 'sonet' },
    });
    expect(options.map((o) => o.value)).toEqual(['sonnet-4-5']);
    // No tag at all: "Older version" is relative to a newer one, and the head is
    // not in this list, so there is nothing for the user to read it against.
    expect(options[0].tag).toBeUndefined();
    expect(options[0].label).toBe('Claude Sonnet 4.5');
  });

  it('leaves the other rows untagged when the only pin in the list is an orphan', () => {
    // The orphan carries no marker itself, so it must not turn "Latest" on for the
    // rows around it either: every row would claim to be the newest with nothing
    // rendered anywhere to read that against.
    const options = buildModelOptions('sonnet', ['sonnet', 'kimi', 'sonnet-4-5'], false, false, {}, FAMILY_LABELS, {
      modelProviders: FAMILY_META.modelProviders,
      modelFamilies: { sonnet: 'sonnet', kimi: 'kimi', 'sonnet-4-5': 'sonet' },
    });
    for (const o of options) expect(o.tag).toBeUndefined();
  });

  it('carries the backend provider through so the picker stops inferring it', () => {
    const options = buildModelOptions('sonnet', ['sonnet', 'kimi'], false, false, {}, FAMILY_LABELS, FAMILY_META);
    expect(options.find((o) => o.value === 'sonnet').provider).toBe('anthropic');
    expect(options.find((o) => o.value === 'kimi').provider).toBe('moonshot');
  });

  it('tags nothing and sets no provider without the metadata', () => {
    // A BYOK provider, or a cowork-server too old to send it: every model renders
    // exactly as it does today rather than claiming to be "latest".
    const options = buildModelOptions('claude-opus-4-8', ANTHROPIC_LIST, true, false);
    for (const o of options) {
      expect(o.tag).toBeUndefined();
      expect(o.provider).toBeUndefined();
    }
  });

  it('marks a locked pin independently of its head, and keeps both rows selectable', () => {
    const options = buildModelOptions(
      'sonnet', ['sonnet', 'sonnet-4-5'], false, false,
      { 'sonnet-4-5': false }, FAMILY_LABELS, FAMILY_META,
    );
    const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
    // A model the wallet can't pay for stays selectable: the wall is at use time.
    expect(byValue.sonnet.disabled).toBe(false);
    expect(byValue['sonnet-4-5'].disabled).toBe(false);
    // Both facts stay readable on the same row, and the label stays the bare name
    // so the closed trigger and the search never see a marker.
    expect(byValue['sonnet-4-5'].label).toBe('Claude Sonnet 4.5');
    expect(byValue['sonnet-4-5'].tag).toBe('Older version · Needs credits');
    expect(byValue.sonnet.tag).toBe('Latest');
  });

  it('keeps the version tag on a locked moving alias', () => {
    const options = buildModelOptions(
      'sonnet', ['sonnet', 'sonnet-4-5'], false, false,
      { sonnet: false }, FAMILY_LABELS, FAMILY_META,
    );
    const head = options.find((o) => o.value === 'sonnet');
    expect(head.label).toBe('Claude Sonnet 5');
    expect(head.disabled).toBe(false);
    // Version state reads first, so the wallet state can never hide it.
    expect(head.tag).toBe('Latest · Needs credits');
  });

  it('keeps the __stale__ and "Other…" entries pinned outside the sections', () => {
    const options = buildModelOptions('latest:sonnet', ['sonnet'], true, true, {}, FAMILY_LABELS, FAMILY_META);
    expect(options[0]).toMatchObject({ value: '__stale__', pin: 'top' });
    expect(options[options.length - 1]).toMatchObject({ value: '__custom__', pin: 'bottom' });
  });
});

describe('mergeRecommendedModels — the section/version maps', () => {
  it('overlays modelProviders and modelFamilies when the server sends them', () => {
    const merged = mergeRecommendedModels({}, {
      modelProviders: { sonnet: 'anthropic' },
      modelFamilies: { sonnet: 'sonnet' },
    });
    expect(merged.modelProviders).toEqual({ sonnet: 'anthropic' });
    expect(merged.modelFamilies).toEqual({ sonnet: 'sonnet' });
  });

  it('keeps what we hold when the server sends them empty or omits them', () => {
    // An older cowork-server, a BYOK provider, or a failed MindsHub fetch — the
    // endpoint still answers 200. Wiping would flatten the picker until restart.
    const held = { modelProviders: { sonnet: 'anthropic' }, modelFamilies: { sonnet: 'sonnet' } };
    expect(mergeRecommendedModels(held, { modelProviders: {}, modelFamilies: {} }).modelProviders)
      .toEqual(held.modelProviders);
    expect(mergeRecommendedModels(held, { recommendedModels: {} }).modelFamilies)
      .toEqual(held.modelFamilies);
  });
});
