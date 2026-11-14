import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoiceSettingsSection from './VoiceSettingsSection';
import { getVoicePrefs, resetVoicePrefsForTests } from '../../lib/voice/voicePrefs';

beforeEach(() => {
  window.localStorage.clear();
  resetVoicePrefsForTests();
});

describe('Settings > Voice', () => {
  it('turns the voice agent off at once, and hides the voice picker while off', async () => {
    render(<VoiceSettingsSection agentLabel="Anton" />);
    expect(screen.getByRole('combobox', { name: 'Voice' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Voice agent' }));
    expect(getVoicePrefs().enabled).toBe(false);
    expect(screen.queryByRole('combobox', { name: 'Voice' })).not.toBeInTheDocument();
  });
});
