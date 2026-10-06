import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  validateSettings: vi.fn(async () => ({ ok: true })),
  fetchRecommendedModels: vi.fn(async () => ({})),
}));

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: spies.validateSettings,
  fetchRecommendedModels: spies.fetchRecommendedModels,
  revealSettingKey: vi.fn(async () => ''),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: true,
    isMac: () => true,
    getKeychainPref: vi.fn(async () => false),
    openExternal: vi.fn(),
    serverDiagnostics: vi.fn(async () => ({})),
    checkForUpdates: vi.fn(async () => ({ ok: true, offline: false, updateAvailable: false, uiUpdateAvailable: false, serverUpdateAvailable: false, shellUpdateAvailable: false })),
    applyUpdate: vi.fn(async () => true),
  },
  getVersionInfo: vi.fn(async () => ({ app: '2.26.7.29.1', ui: null, source: 'bundled' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../../lib/analytics', () => ({
  resetDeviceIdentity: vi.fn(),
}));

import { useState } from 'react';
import SettingsView from './SettingsView';

// ENG-3200: edits write straight into App-level `settings`, which outlives the
// Settings modal. A save the server rejected (a Member changing org-only
// budgets → 403) left the edits there, so reopening snapshotted them as
// "Saved" until a hard reload.

const SERVER = { maxToolRounds: '50', maxContinuations: '5', maxTurnTokens: '1250000' };

function Harness({ onSave, latest, initial = SERVER, onAppearancePreview }) {
  const [settings, setSettings] = useState(initial);
  const [open, setOpen] = useState(true);
  const [section, setSection] = useState('agent');
  const save = async (patch) => {
    const result = await onSave(patch);
    setSettings((prev) => ({ ...prev, ...(result?.settings || patch) }));
    return result;
  };
  latest.current = settings;
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)}>toggle</button>
      {open && (
        <SettingsView
          settings={settings}
          setSetting={(k, v) => setSettings((prev) => ({ ...prev, [k]: v }))}
          onSave={save}
          onAppearancePreview={onAppearancePreview}
          theme="dark" onThemeChange={vi.fn()}
          skin="default" onSkinChange={vi.fn()}
          customTheme={{}} onCustomThemeChange={vi.fn()}
          agentLabel="Anton"
          serverOnline
          section={section}
          onSectionChange={setSection}
        />
      )}
    </>
  );
}

// "Max auto-continues": 5 → 9.
const editBudget = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Advanced Settings' }));
  fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '9' } });
};
const clickSave = () => fireEvent.click(screen.getByRole('button', { name: /^Save settings$/ }));
const reopen = () => {
  fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
  fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
};

describe('SettingsView — closing discards unsaved edits (ENG-3200)', () => {
  beforeEach(() => {
    spies.validateSettings.mockReset().mockImplementation(async () => ({ ok: true }));
    spies.fetchRecommendedModels.mockReset().mockImplementation(async () => ({}));
  });

  it('keeps rejected edits local until the view closes', async () => {
    const latest = { current: null };
    const onSave = vi.fn(async () => {
      throw new Error('Failed to save settings: changing organization settings requires an org admin.');
    });
    render(<Harness onSave={onSave} latest={latest} />);
    editBudget();
    clickSave();
    await screen.findByText(/requires an org admin/);
    expect(latest.current.maxContinuations).toBe('5');
    expect(screen.getByLabelText('Max auto-continues')).toHaveValue(9);

    reopen();

    expect(latest.current.maxContinuations).toBe(SERVER.maxContinuations);
  });

  it('discards an edit that was never saved', () => {
    const latest = { current: null };
    render(<Harness onSave={vi.fn()} latest={latest} />);
    editBudget();
    reopen();
    expect(latest.current.maxContinuations).toBe(SERVER.maxContinuations);
  });

  it('keeps an edit that saved successfully', async () => {
    const latest = { current: null };
    render(<Harness onSave={vi.fn(async () => ({}))} latest={latest} />);
    editBudget();
    clickSave();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Saved$/ })).toBeInTheDocument());
    reopen();
    expect(latest.current.maxContinuations).toBe('9');
  });

  it('keeps a persisted edit when validation after the save fails', async () => {
    const latest = { current: null };
    spies.validateSettings.mockRejectedValue(new Error('validation unavailable'));
    const onSave = vi.fn(async () => ({}));
    render(<Harness onSave={onSave} latest={latest} />);
    editBudget();
    clickSave();
    await screen.findByText(/validation unavailable/);
    expect(onSave).toHaveBeenCalled();

    reopen();

    expect(latest.current.maxContinuations).toBe('9');
  });

  it('keeps model metadata the picker refreshed from the server', async () => {
    const latest = { current: null };
    spies.fetchRecommendedModels.mockResolvedValue({ modelEnabled: { sonnet: true, opus: true } });
    const initial = {
      modelMode: 'default',
      providers: [{ type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://mdb.ai' }],
      providerStatus: { 'minds-cloud': 'ok' },
      providerTypeLabels: { 'minds-cloud': 'MindsHub' },
      planningModel: 'sonnet',
      codingModel: 'sonnet',
      recommendedModels: { 'minds-cloud': ['sonnet', 'opus'] },
      modelEnabled: { sonnet: true, opus: false },
    };
    render(<Harness onSave={vi.fn()} latest={latest} initial={initial} />);
    await userEvent.setup().click(screen.getByTitle(/Pick the model used for planning/));
    await waitFor(() => expect(latest.current.modelEnabled.opus).toBe(true));

    reopen();

    expect(latest.current.modelEnabled.opus).toBe(true);
  });
});



describe('SettingsView draft ownership', () => {
  beforeEach(() => {
    spies.validateSettings.mockReset().mockResolvedValue({ configReady: true });
  });

  it('keeps App unchanged while editing and submits only the edited field', async () => {
    const latest = { current: null };
    const onSave = vi.fn(async () => ({}));
    render(<Harness onSave={onSave} latest={latest} />);
    editBudget();
    expect(latest.current.maxContinuations).toBe('5');
    expect(screen.getByLabelText('Max auto-continues')).toHaveValue(9);
    clickSave();
    await waitFor(() => expect(latest.current.maxContinuations).toBe('9'));
    expect(onSave).toHaveBeenCalledWith({ maxContinuations: '9' });
  });

  it('discards a later draft back to the persisted value after verification fails', async () => {
    const latest = { current: null };
    spies.validateSettings.mockRejectedValue(new Error('validation unavailable'));
    render(<Harness onSave={vi.fn(async () => ({}))} latest={latest} />);
    editBudget();
    clickSave();
    await screen.findByText(/Settings saved, but verification failed/);
    fireEvent.change(screen.getByLabelText('Max auto-continues'), { target: { value: '10' } });
    reopen();
    expect(latest.current.maxContinuations).toBe('9');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Settings' }));
    expect(screen.getByLabelText('Max auto-continues')).toHaveValue(9);
  });

  it('preserves edits made during an in-flight save', async () => {
    const latest = { current: null };
    let resolveSave;
    const onSave = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    render(<Harness onSave={onSave} latest={latest} />);
    editBudget();
    clickSave();
    fireEvent.change(screen.getByLabelText('Max auto-continues'), { target: { value: '10' } });
    resolveSave({});
    await screen.findByRole('button', { name: /^Save settings$/ });
    expect(latest.current.maxContinuations).toBe('9');
    expect(screen.getByLabelText('Max auto-continues')).toHaveValue(10);
    reopen();
    expect(latest.current.maxContinuations).toBe('9');
  });

  it('keeps an unrelated manual draft when appearance auto-saves', async () => {
    const latest = { current: null };
    const onSave = vi.fn(async () => ({}));
    render(<Harness onSave={onSave} latest={latest} initial={{ ...SERVER, showDots: false }} />);
    editBudget();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    fireEvent.click(screen.getByLabelText('Animated background'));
    await waitFor(() => expect(latest.current.showDots).toBe(true));
    expect(latest.current.maxContinuations).toBe('5');
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced Settings' }));
    expect(screen.getByLabelText('Max auto-continues')).toHaveValue(9);
    clickSave();
    await waitFor(() => expect(latest.current.maxContinuations).toBe('9'));
    expect(onSave.mock.calls[0][0]).toEqual({ showDots: true });
    expect(onSave.mock.calls[1][0]).toEqual({ maxContinuations: '9' });
  });
});


describe('SettingsView appearance request ownership', () => {
  it('does not clear a reopened view preview when an old auto-save completes', async () => {
    const latest = { current: null };
    let resolveSave;
    const onSave = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    const preview = {};
    const onAppearancePreview = (key, value) => {
      if (key === null) Object.keys(preview).forEach((k) => delete preview[k]);
      else if (value === undefined) delete preview[key];
      else preview[key] = value;
    };
    render(<Harness onSave={onSave} latest={latest} initial={{ ...SERVER, navTitle: 'Before' }}
      onAppearancePreview={onAppearancePreview} />);
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    fireEvent.change(screen.getByLabelText('Sidebar title text'), { target: { value: 'First' } });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ navTitle: 'First' }));
    reopen();
    fireEvent.change(screen.getByLabelText('Sidebar title text'), { target: { value: 'Second' } });
    expect(preview.navTitle).toBe('Second');
    resolveSave({});
    await waitFor(() => expect(latest.current.navTitle).toBe('First'));
    expect(screen.getByLabelText('Sidebar title text')).toHaveValue('Second');
    expect(preview.navTitle).toBe('Second');
  });

  it('does not mark a newer appearance edit saved when an older request completes', async () => {
    const latest = { current: null };
    const pending = [];
    const onSave = vi.fn(() => new Promise((resolve) => { pending.push(resolve); }));
    render(<Harness onSave={onSave} latest={latest} initial={{ ...SERVER, showDots: false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    fireEvent.click(screen.getByLabelText('Animated background'));
    fireEvent.click(screen.getByLabelText('Animated background'));
    pending[0]({});
    await waitFor(() => expect(latest.current.showDots).toBe(true));
    expect(screen.getByLabelText('Animated background')).not.toBeChecked();
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    pending[1]({});
    await waitFor(() => expect(latest.current.showDots).toBe(false));
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });
});
