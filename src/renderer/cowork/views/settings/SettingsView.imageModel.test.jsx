/* The Image model row (ENG-4024): the model Anton's generate_image tool runs
   on. It lists MindsHub's `kind: "image"` models and nothing else, the chat
   rows above it list none of them, and with nothing saved it shows the
   catalog's image-role default without writing it. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
  revealSettingKey: vi.fn(async () => ''),
  fetchRecommendedModels: vi.fn(async () => ({})),
  testProviders: vi.fn(async () => ({})),
}));
vi.mock('../../../platform/host', () => ({
  host: { isElectron: true, isWeb: false, isMac: () => false, openExternal: vi.fn() },
  getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'electron' })),
  isElectron: true,
  getAccessToken: vi.fn(async () => ''),
}));
vi.mock('../../lib/analytics', () => ({
  resetDeviceIdentity: vi.fn(),
  trackBillingOpened: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';
import { mergeRecommendedModels } from '../../lib/settingsTransform';

const FLARE = 'gpt-image-2.6-flare';
const SUNBURST = 'gpt-image-2.6-sunburst';

function Harness({ initialSettings, onSave }) {
  const [settings, setSettings] = useState(initialSettings);
  const setSetting = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  return (
    <SettingsView
      settings={settings}
      setSetting={setSetting}
      onSave={onSave}
      theme="dark"
      onThemeChange={vi.fn()}
      skin="default"
      onSkinChange={vi.fn()}
      customTheme={{}}
      onCustomThemeChange={vi.fn()}
      agentLabel="Anton"
      serverOnline
      section="agent"
      onSectionChange={vi.fn()}
    />
  );
}

/* Settings as the app holds them: the rows, then the recommended-models
   response merged on top, the way readSettings builds them. This response
   lists an image model in the chat bucket too, to prove the merge drops it. */
const settingsWith = (over = {}, rec = {}) => {
  const base = {
    modelMode: 'default',
    providers: [{ type: 'minds-cloud', apiKey: '***', mindsUrl: 'https://mdb.ai' }],
    providerTypeLabels: { 'minds-cloud': 'MindsHub' },
    providerStatus: { 'minds-cloud': 'ok' },
    providerStatusDetails: {},
    planningProvider: 'minds-cloud',
    planningModel: 'sonnet',
    codingProvider: 'minds-cloud',
    codingModel: 'sonnet',
    ...over,
  };
  return {
    ...base,
    ...mergeRecommendedModels(base, {
      recommendedModels: { 'minds-cloud': ['sonnet', FLARE, 'opus'] },
      recommendedPair: { 'minds-cloud': ['sonnet', 'sonnet', 'sonnet'] },
      modelLabels: {
        sonnet: 'Claude Sonnet 5',
        opus: 'Claude Opus 5',
        [FLARE]: 'GPT Image 2.6 Flare',
        [SUNBURST]: 'GPT Image 2.6 Sunburst',
      },
      modelProviders: { sonnet: 'anthropic', opus: 'anthropic', [FLARE]: 'openai', [SUNBURST]: 'openai' },
      imageModels: [FLARE, SUNBURST],
      imageModelDefault: FLARE,
      ...rec,
    }),
  };
};

const imagePicker = () => screen.getByTitle('Pick the model used to generate images.');
const optionNames = () => screen.getAllByRole('option').map((o) => o.textContent);

let onSave;
beforeEach(() => {
  onSave = vi.fn(async () => {});
});

describe('SettingsView: Image model row', () => {
  it('sits with the other model rows and lists only image models', async () => {
    const user = userEvent.setup();
    render(<Harness initialSettings={settingsWith()} onSave={onSave} />);

    expect(screen.getByText('Image model')).toBeInTheDocument();
    expect(screen.getByText('Used to generate and edit images.')).toBeInTheDocument();

    await user.click(imagePicker());
    const names = optionNames();
    expect(names.some((n) => n.includes('GPT Image 2.6 Flare'))).toBe(true);
    expect(names.some((n) => n.includes('GPT Image 2.6 Sunburst'))).toBe(true);
    expect(names.some((n) => /Claude/.test(n))).toBe(false);
  });

  it('keeps image models out of the chat pickers', async () => {
    const user = userEvent.setup();
    render(<Harness initialSettings={settingsWith()} onSave={onSave} />);

    await user.click(screen.getByTitle(/Pick the model used for planning/));
    const names = optionNames();
    expect(names.some((n) => n.includes('Claude Sonnet 5'))).toBe(true);
    expect(names.some((n) => /GPT Image/.test(n))).toBe(false);
  });

  it("shows the catalog's image default when nothing is saved, and an untouched save writes no image model", async () => {
    const user = userEvent.setup();
    render(<Harness initialSettings={settingsWith({}, { imageModelDefault: SUNBURST })} onSave={onSave} />);

    expect(imagePicker()).toHaveTextContent('GPT Image 2.6 Sunburst');

    // Any other edit makes the form savable; the image row stays untouched.
    await user.click(screen.getByRole('switch', { name: 'Episodic memory' }));
    await user.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('imageModel');
  });

  it('falls back to GPT Image 2.6 Flare when the catalog declares no image default', () => {
    render(<Harness initialSettings={settingsWith({}, { imageModels: [SUNBURST, FLARE], imageModelDefault: '' })} onSave={onSave} />);
    expect(imagePicker()).toHaveTextContent('GPT Image 2.6 Flare');
  });

  it('shows the saved choice over the default, and saves a new pick', async () => {
    const user = userEvent.setup();
    render(<Harness initialSettings={settingsWith({ imageModel: SUNBURST })} onSave={onSave} />);
    expect(imagePicker()).toHaveTextContent('GPT Image 2.6 Sunburst');

    await user.click(imagePicker());
    await user.click(screen.getByRole('option', { name: /GPT Image 2\.6 Flare/ }));
    expect(imagePicker()).toHaveTextContent('GPT Image 2.6 Flare');

    await user.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ imageModel: FLARE }));
  });

  it('names a saved image model the catalog dropped as one to re-pick', () => {
    render(<Harness initialSettings={settingsWith({ imageModel: 'gpt-image-1-mini' })} onSave={onSave} />);
    expect(imagePicker()).toHaveTextContent(/legacy — re-select a model/);
  });

  it('says how to unlock an image model the wallet cannot pay for', () => {
    render(<Harness initialSettings={settingsWith({}, { modelEnabled: { sonnet: true, [FLARE]: false, [SUNBURST]: false } })} onSave={onSave} />);
    const row = imagePicker().closest('.grid.gap-1\\.5');
    expect(within(row).getByText(/GPT Image 2\.6 Flare needs credits/)).toBeInTheDocument();
  });

  it('points a user without MindsHub at it instead of an empty picker', () => {
    render(<Harness
      initialSettings={settingsWith({
        providers: [{ type: 'anthropic', apiKey: '***' }],
        providerTypeLabels: { anthropic: 'Anthropic' },
        planningProvider: 'anthropic',
        codingProvider: 'anthropic',
      }, { imageModels: [], imageModelDefault: '' })}
      onSave={onSave}
    />);
    expect(screen.getByText('Image model')).toBeInTheDocument();
    expect(screen.getByText(/Image generation runs on MindsHub/)).toBeInTheDocument();
    expect(screen.queryByTitle('Pick the model used to generate images.')).toBeNull();
  });

  it('draws no row when MindsHub is connected but lists no image models', () => {
    render(<Harness initialSettings={settingsWith({}, { imageModels: [], imageModelDefault: '' })} onSave={onSave} />);
    expect(screen.queryByText('Image model')).toBeNull();
  });
});
