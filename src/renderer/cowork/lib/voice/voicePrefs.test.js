import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE, getVoicePrefs, llmViaMindsHub, resetVoicePrefsForTests, setVoicePrefs, subscribeVoicePrefs } from './voicePrefs';

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

describe('llmViaMindsHub', () => {
  it('is MindsHub as the planning provider, or no provider set', () => {
    expect(llmViaMindsHub({ planningProvider: 'minds-cloud' })).toBe(true);
    expect(llmViaMindsHub({ planningProvider: 'minds_cloud' })).toBe(true);
    expect(llmViaMindsHub({})).toBe(true);
    expect(llmViaMindsHub(null)).toBe(true);
    expect(llmViaMindsHub({ planningProvider: 'anthropic' })).toBe(false);
    expect(llmViaMindsHub({ planningProvider: 'openai_compatible' })).toBe(false);
  });
});
