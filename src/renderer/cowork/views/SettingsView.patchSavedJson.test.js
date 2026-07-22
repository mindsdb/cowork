import { describe, it, expect } from 'vitest';
import { patchSavedJson } from './SettingsView';

describe('patchSavedJson', () => {
  it('updates just the given key, leaving other fields untouched', () => {
    const prev = JSON.stringify({ greeting: 'Hi', navTitle: '', harness: 'anton' });
    const next = patchSavedJson(prev, 'navTitle', 'Acme');
    expect(JSON.parse(next)).toEqual({ greeting: 'Hi', navTitle: 'Acme', harness: 'anton' });
  });

  // The core reason this exists: an Appearance auto-save must never mark a
  // genuinely-unsaved Provider/Model edit (tracked in the same snapshot via
  // the shared page-wide Save button) as saved just because it happened to
  // be present in the same settings object at the same time.
  it('does not clear an unrelated field that has diverged from the snapshot (a pending manual edit)', () => {
    const prev = JSON.stringify({ navTitle: '', anthropicApiKey: 'old-key' });
    const next = patchSavedJson(prev, 'navTitle', 'Acme');
    expect(JSON.parse(next).anthropicApiKey).toBe('old-key');
  });

  it('returns the input unchanged when it is null', () => {
    expect(patchSavedJson(null, 'navTitle', 'Acme')).toBeNull();
  });

  it('returns the input unchanged when it is unparseable', () => {
    expect(patchSavedJson('not json', 'navTitle', 'Acme')).toBe('not json');
  });
});
