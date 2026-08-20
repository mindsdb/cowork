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
import { BUDGET_FIELDS, diffSettingsForWrite } from '../../lib/settingsTransform';

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

// Advanced Settings defaults to collapsed — every test below needs its
// fields visible first.
const expandAdvanced = () => fireEvent.click(screen.getByRole('button', { name: 'Advanced Settings' }));

describe('SettingsView — Max tokens per task', () => {
  it('writes the top of the range when "No limit" is ticked', () => {
    const props = baseProps(withBudgets());
    render(<SettingsView {...props} />);
    expandAdvanced();

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
    expandAdvanced();
    expect(noLimitBox()).toBeChecked();
  });

  it('restores a real number when "No limit" is unticked, never the max', () => {
    const props = baseProps(withBudgets({ maxTurnTokens: '50000000' }));
    render(<SettingsView {...props} />);
    expandAdvanced();

    fireEvent.click(noLimitBox());

    const [, written] = props.setSetting.mock.calls.at(-1);
    // Restoring the max would leave the switch impossible to turn off.
    expect(written).not.toBe(String(BUDGET_FIELDS.maxTurnTokens.max));
    expect(Number(written)).toBeGreaterThanOrEqual(BUDGET_FIELDS.maxTurnTokens.min);
  });

  it('disables the number input while "No limit" is on', () => {
    render(<SettingsView {...baseProps(withBudgets({ maxTurnTokens: '50000000' }))} />);
    expandAdvanced();
    expect(screen.getByLabelText('Max tokens per task')).toBeDisabled();
  });

  it('displays and accepts Max tokens per task in millions, storing the natural count', () => {
    const props = baseProps(withBudgets({ maxTurnTokens: '1250000' }));
    render(<SettingsView {...props} />);
    expandAdvanced();

    const input = screen.getByLabelText('Max tokens per task');
    expect(input).toHaveValue(1.25); // 1_250_000 tokens, shown as "1.25"

    fireEvent.change(input, { target: { value: '2' } });
    expect(props.setSetting).toHaveBeenCalledWith('maxTurnTokens', '2000000');
  });

  it('sends the natural token count over the wire, never the millions-scaled display value', () => {
    // The million-scale display is entirely a BudgetNumberField rendering
    // concern (toDisplayUnits/toNaturalUnits) — settings state, the
    // diff-for-write payload, and the server's max_turn_tokens column must
    // never see anything but the real token count. This is the guard rail
    // that would catch it if that boundary ever leaked.
    const props = baseProps(withBudgets({ maxTurnTokens: '1250000' }));
    render(<SettingsView {...props} />);
    expandAdvanced();

    fireEvent.change(screen.getByLabelText('Max tokens per task'), { target: { value: '2' } });
    const [, written] = props.setSetting.mock.calls.at(-1);
    expect(written).toBe('2000000'); // NOT '2' — the agent reads real tokens

    const writes = diffSettingsForWrite(
      { maxTurnTokens: written },
      { maxTurnTokens: '1250000' }, // lastFetched, as if freshly loaded from the server
    );
    expect(writes).toEqual({ max_turn_tokens: '2000000' });
  });

  it('reverts to the factory default when the field is cleared and blurred', () => {
    const props = baseProps(withBudgets());
    render(<SettingsView {...props} />);
    expandAdvanced();

    const input = screen.getByLabelText('Max tokens per task');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(props.setSetting).toHaveBeenCalledWith(
      'maxTurnTokens', String(BUDGET_FIELDS.maxTurnTokens.fallback),
    );
  });

  it('reverts Max steps per task and Max auto-continues to default too, on clear + blur', () => {
    const props = baseProps(withBudgets());
    render(<SettingsView {...props} />);
    expandAdvanced();

    const steps = screen.getByLabelText('Max steps per task');
    fireEvent.change(steps, { target: { value: '' } });
    fireEvent.blur(steps);
    expect(props.setSetting).toHaveBeenCalledWith(
      'maxToolRounds', String(BUDGET_FIELDS.maxToolRounds.fallback),
    );

    const continuations = screen.getByLabelText('Max auto-continues');
    fireEvent.change(continuations, { target: { value: '' } });
    fireEvent.blur(continuations);
    expect(props.setSetting).toHaveBeenCalledWith(
      'maxContinuations', String(BUDGET_FIELDS.maxContinuations.fallback),
    );
  });

  it('hides the field entirely on a server that does not serve the key', () => {
    // The renderer ships OTA and leads the installed server; writing a key an
    // older server rejects 400s the whole multi-key save.
    const { maxTurnTokens, ...older } = withBudgets();
    render(<SettingsView {...baseProps(older)} />);
    expandAdvanced();
    expect(findNoLimit()).toBeUndefined();
    // …while the two budgets that server DOES have stay visible.
    expect(screen.getByLabelText('Max steps per task')).toBeInTheDocument();
  });
});

describe('SettingsView — Advanced Settings collapse', () => {
  it('starts collapsed, hiding the budget fields', () => {
    render(<SettingsView {...baseProps(withBudgets())} />);
    expect(screen.queryByLabelText('Max steps per task')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advanced Settings' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands on click, revealing the fields, and collapses again on a second click', () => {
    render(<SettingsView {...baseProps(withBudgets())} />);
    const toggle = screen.getByRole('button', { name: 'Advanced Settings' });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Max steps per task')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Max steps per task')).not.toBeInTheDocument();
  });
});
