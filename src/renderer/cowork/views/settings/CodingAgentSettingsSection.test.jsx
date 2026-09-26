/* The Code Mode default-model picker builds its rows from the same settings
   maps as every other picker, so an admin-restricted model reads "Restricted"
   here too, not "Needs credits" with an Add credits button. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  // Web: the section skips its engine and shell reads, which need the desktop.
  return { ...actual, host: { ...actual.host, isWeb: true, isElectron: false, openExternal: vi.fn() } };
});

import CodingAgentSettingsSection from './CodingAgentSettingsSection';

const settings = {
  codingAgentEngine: 'codex',
  codingAgentModel: 'gpt-codex',
  recommendedModels: { 'minds-cloud': ['gpt-codex', 'opus', 'fable'] },
  modelLabels: { 'gpt-codex': 'GPT 5.3 Codex', opus: 'Claude Opus 5', fable: 'Claude Fable 5' },
  modelEnabled: { 'gpt-codex': true, opus: false, fable: false },
  modelDisabledReasons: { opus: 'model_restricted', fable: 'wallet_empty' },
};

describe('CodingAgentSettingsSection model picker', () => {
  it('tags a restricted model Restricted with no credits route, and a wallet-closed one Needs credits', async () => {
    const user = userEvent.setup();
    render(
      <CodingAgentSettingsSection
        settings={settings}
        setSetting={vi.fn()}
        available
        enabled
        onEnabledChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Coding agent model' }));
    const restricted = await screen.findByRole('option', { name: /Claude Opus 5/ });
    expect(restricted).toHaveTextContent('Restricted');
    expect(within(restricted).queryByRole('button', { name: 'Add credits' })).toBeNull();

    const walletRow = screen.getByRole('option', { name: /Claude Fable 5/ });
    expect(walletRow).toHaveTextContent('Needs credits');
    expect(within(walletRow).getByRole('button', { name: 'Add credits' })).toBeInTheDocument();
  });
});
