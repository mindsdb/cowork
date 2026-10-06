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
import SettingsView, { unsavedEditReverts } from './SettingsView';

// ENG-3200: edits write straight into App-level `settings`, which outlives the
// Settings modal. A save the server rejected (a Member changing org-only
// budgets → 403) left the edits there, so reopening snapshotted them as
// "Saved" until a hard reload.

const SERVER = { maxToolRounds: '50', maxContinuations: '5', maxTurnTokens: '1250000' };

function Harness({ onSave, latest, initial = SERVER }) {
  const [settings, setSettings] = useState(initial);
  const [open, setOpen] = useState(true);
  latest.current = settings;
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)}>toggle</button>
      {open && (
        <SettingsView
          settings={settings}
          setSetting={(k, v) => setSettings((prev) => ({ ...prev, [k]: v }))}
          onSave={onSave}
          theme="dark" onThemeChange={vi.fn()}
          skin="default" onSkinChange={vi.fn()}
          customTheme={{}} onCustomThemeChange={vi.fn()}
          agentLabel="Anton"
          section="agent"
          onSectionChange={vi.fn()}
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

  it('reverts an edit the server rejected when the view closes', async () => {
    const latest = { current: null };
    const onSave = vi.fn(async () => {
      throw new Error('Failed to save settings: changing organization settings requires an org admin.');
    });
    render(<Harness onSave={onSave} latest={latest} />);
    editBudget();
    clickSave();
    await screen.findByText(/requires an org admin/);
    expect(latest.current.maxContinuations).toBe('9');

    reopen();

    expect(latest.current.maxContinuations).toBe(SERVER.maxContinuations);
  });

  it('reverts an edit that was never saved', () => {
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

describe('unsavedEditReverts', () => {
  const saved = JSON.stringify({ a: '1', b: '2' });

  it('reverts only edited keys that diverge from the snapshot', () => {
    expect(unsavedEditReverts(saved, { a: 'x', b: 'y' }, new Set(['a']))).toEqual([['a', '1']]);
    expect(unsavedEditReverts(saved, { a: '1', b: 'y' }, new Set(['a']))).toEqual([]);
  });

  it('skips keys missing from the snapshot', () => {
    expect(unsavedEditReverts(saved, { providerStatus: {} }, new Set(['providerStatus']))).toEqual([]);
  });

  it('is a no-op without a snapshot', () => {
    expect(unsavedEditReverts(null, { a: 'x' }, new Set(['a']))).toEqual([]);
  });
});
