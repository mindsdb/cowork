import { describe, it, expect } from 'vitest';
import {
  resolveModelPickerValue,
  diffSettingsForWrite,
  effectiveRoleModel,
  effectiveRoleProvider,
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
