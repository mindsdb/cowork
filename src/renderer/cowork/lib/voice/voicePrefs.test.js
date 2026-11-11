import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE, getVoicePrefs, resetVoicePrefsForTests, setVoicePrefs, subscribeVoicePrefs } from './voicePrefs';

beforeEach(() => {
  window.localStorage.clear();
  resetVoicePrefsForTests();
});

describe('voice preferences', () => {
  it('start on, in the default voice', () => {
    expect(getVoicePrefs()).toEqual({ enabled: true, voice: DEFAULT_VOICE });
  });

  it('keep a change on this device and tell listeners when the voice changed', () => {
    const heard = vi.fn();
    const stop = subscribeVoicePrefs(heard);
    setVoicePrefs({ voice: 'willow' });
    setVoicePrefs({ enabled: false });
    stop();
    expect(heard.mock.calls.map(([, info]) => info.voiceChanged)).toEqual([true, false]);
    resetVoicePrefsForTests();
    expect(getVoicePrefs()).toEqual({ enabled: false, voice: 'willow' });
  });

  it('fall back to the default for a voice that is no longer offered', () => {
    window.localStorage.setItem('cowork.voiceCall', JSON.stringify({ voice: 'gone' }));
    expect(getVoicePrefs().voice).toBe(DEFAULT_VOICE);
  });
});
