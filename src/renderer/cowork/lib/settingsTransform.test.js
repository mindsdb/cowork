import { describe, it, expect } from 'vitest';
import { resolveModelPickerValue } from './settingsTransform';

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
