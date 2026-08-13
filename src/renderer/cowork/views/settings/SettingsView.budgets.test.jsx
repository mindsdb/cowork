import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Regression (ENG-1286, review on PR #636): the "No limit" checkbox wrote
// `String(spec.unlimited)` — a key that does not exist on BUDGET_FIELDS, so it
// wrote the literal string "undefined". The feature was dead on arrival and
// shipped green, because the lib-level tests exercise isBudgetUnlimited /
// resolveBudgetRestore only with well-formed inputs and nothing rendered the
// checkbox. Everything downstream then failed quietly rather than loudly:
// Number('undefined') >= max is NaN >= max is false, so the box re-rendered
// unchecked; clampBudgets saw NaN and dropped the key, so the save wrote
// nothing at all.
//
// These tests assert the VALUE that reaches setSetting, which is the only
// thing the bug got wrong.
vi.mock('../../api', () => ({
  fetchHealth: vi.fn(async () => ({})),
  validateSettings: vi.fn(async () => ({ ok: true })),
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
  trackHarnessSwapped: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
vi.mock('../ChannelsView', () => ({ default: () => <div data-testid="channels-stub" /> }));

import SettingsView from './SettingsView';
import { BUDGET_FIELDS } from '../../lib/settingsTransform';

// The budget group only renders when the server served every budget key — an
// older server hides it entirely rather than 400ing the save.
const withBudgets = (over = {}) => ({
  maxToolRounds: '50',
  maxContinuations: '5',
  maxTurnTokens: '1250000',
  ...over,
});

const baseProps = (settings) => ({
  settings,
  setSetting: vi.fn(), onSave: vi.fn(),
  theme: 'dark', onThemeChange: vi.fn(),
  skin: 'default', onSkinChange: vi.fn(),
  customTheme: {}, onCustomThemeChange: vi.fn(),
  agentLabel: 'Anton',
  section: 'agent',
  onSectionChange: vi.fn(),
  shellUpdate: null,
  onDownloadShellUpdate: vi.fn(),
});

// Matched on the aria-label directly. The checkbox sits inside a <label> that
// also carries its visible text, so `getByLabelText` matches BOTH the control
// and the text node, and `getByRole(name:)` misses because the wrapper changes
// the computed accessible name.
const findNoLimit = () => screen.queryAllByRole('checkbox')
  .find((el) => el.getAttribute('aria-label') === 'No limit');
const noLimitBox = () => {
  const el = findNoLimit();
  if (!el) throw new Error('no "No limit" checkbox rendered');
  return el;
};

describe('SettingsView — Max tokens per task', () => {
  it('writes the top of the range when "No limit" is ticked', () => {
    const props = baseProps(withBudgets());
    render(<SettingsView {...props} />);

    fireEvent.click(noLimitBox());

    // The exact assertion the bug failed: it wrote the string "undefined".
    expect(props.setSetting).toHaveBeenCalledWith(
      'maxTurnTokens', String(BUDGET_FIELDS.maxTurnTokens.max),
    );
    const [, written] = props.setSetting.mock.calls.at(-1);
    expect(Number.isNaN(Number(written))).toBe(false);
  });

  it('shows as ticked when the stored value is already the max', () => {
    render(<SettingsView {...baseProps(withBudgets({ maxTurnTokens: '50000000' }))} />);
    expect(noLimitBox()).toBeChecked();
  });

  it('restores a real number when "No limit" is unticked, never the max', () => {
    const props = baseProps(withBudgets({ maxTurnTokens: '50000000' }));
    render(<SettingsView {...props} />);

    fireEvent.click(noLimitBox());

    const [, written] = props.setSetting.mock.calls.at(-1);
    // Restoring the max would leave the switch impossible to turn off.
    expect(written).not.toBe(String(BUDGET_FIELDS.maxTurnTokens.max));
    expect(Number(written)).toBeGreaterThanOrEqual(BUDGET_FIELDS.maxTurnTokens.min);
  });

  it('disables the number input while "No limit" is on', () => {
    render(<SettingsView {...baseProps(withBudgets({ maxTurnTokens: '50000000' }))} />);
    expect(screen.getByLabelText('Max tokens per task')).toBeDisabled();
  });

  it('hides the field entirely on a server that does not serve the key', () => {
    // The renderer ships OTA and leads the installed server; writing a key an
    // older server rejects 400s the whole multi-key save.
    const { maxTurnTokens, ...older } = withBudgets();
    render(<SettingsView {...baseProps(older)} />);
    expect(findNoLimit()).toBeUndefined();
    // …while the two budgets that server DOES have stay visible.
    expect(screen.getByLabelText('Max steps per task')).toBeInTheDocument();
  });
});
