// The dictate mic (ENG-4630): between the model picker and Send, offered only
// where live voice is, and what is said lands in the message box.

import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: { isWeb: true, isElectron: false, getApiOrigin: () => 'http://x', getAccessToken: async () => null, openExternal: vi.fn() },
}));

const dictation = vi.hoisted(() => ({ onText: null, toggle: vi.fn(), stop: vi.fn(), phase: 'idle', error: '' }));
vi.mock('../lib/voice/useDictation', async (importOriginal) => ({
  ...(await importOriginal()),
  useDictation: ({ onText }) => {
    dictation.onText = onText;
    return { ...dictation, active: dictation.phase !== 'idle' };
  },
}));

import Composer from './Composer';

function renderComposer(props = {}) {
  return render(<Composer onSend={vi.fn()} connectors={[]} draftKey={`dictation-${Math.random()}`} {...props} />);
}

describe('the dictate mic', () => {
  it('is not there where live voice is not offered', () => {
    dictation.phase = 'idle';
    renderComposer();
    expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument();
  });

  it('sits just before Send and toggles dictation', async () => {
    dictation.phase = 'idle';
    renderComposer({ dictationAvailable: true });
    const mic = screen.getByRole('button', { name: 'Dictate' });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(mic.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(mic);
    expect(dictation.toggle).toHaveBeenCalled();
  });

  it('types what is said into the box', () => {
    dictation.phase = 'listening';
    renderComposer({ dictationAvailable: true });
    expect(screen.getByRole('button', { name: 'Stop dictating' })).toHaveAttribute('aria-pressed', 'true');

    act(() => dictation.onText('Draft a memo', true));
    act(() => dictation.onText(' for Friday', false));
    expect(screen.getByRole('textbox')).toHaveValue('Draft a memo for Friday');
  });

  it('stays until stopped even when a call takes the microphone', () => {
    dictation.phase = 'listening';
    renderComposer({ dictationAvailable: false });
    expect(screen.getByRole('button', { name: 'Stop dictating' })).toBeInTheDocument();
  });

  it('says why it could not start', () => {
    dictation.phase = 'idle';
    dictation.error = 'Allow the microphone in your browser to start a voice call.';
    renderComposer({ dictationAvailable: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Allow the microphone');
    dictation.error = '';
  });
});
