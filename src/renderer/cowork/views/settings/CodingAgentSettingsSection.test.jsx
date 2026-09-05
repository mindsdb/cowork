import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  codeSetupStatus: vi.fn(),
  modalProps: { current: null },
}));

vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: true,
    isWeb: false,
    isMac: () => true,
    codeSetupStatus: mocks.codeSetupStatus,
  },
}));
vi.mock('../../code/CodeSetupModal', () => ({
  CodeSetupModal: (props) => {
    mocks.modalProps.current = props;
    return props.open ? <div>Code setup modal<button type="button" onClick={props.onComplete}>Finish setup stub</button></div> : null;
  },
}));
vi.mock('../../code/api', () => ({ codingApi: { engines: vi.fn(async () => []), models: vi.fn(async () => ({ items: [] })), terminalShells: vi.fn(async () => ({ items: [] })) } }));

import { codingApi } from '../../code/api';
import CodingAgentSettingsSection from './CodingAgentSettingsSection';

const baseProps = {
  settings: { codingAgentEngine: 'codex', codingAgentModel: 'gpt' },
  setSetting: vi.fn(),
  footer: null,
  available: true,
};

describe('CodingAgentSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.modalProps.current = null;
  });

  it('runs the setup before switching Code Mode on when the coding agent is not installed', async () => {
    mocks.codeSetupStatus.mockResolvedValue({ installed: false, gitWorks: true, devSource: false });
    const onEnabledChange = vi.fn();
    const user = userEvent.setup();
    render(<CodingAgentSettingsSection {...baseProps} enabled={false} onEnabledChange={onEnabledChange} />);

    await waitFor(() => expect(screen.getByText(/downloads the coding agent, about 110 MB/)).toBeInTheDocument());
    await user.click(screen.getByRole('switch', { name: 'Enable Code Mode' }));

    expect(onEnabledChange).not.toHaveBeenCalled();
    expect(screen.getByText('Code setup modal')).toBeInTheDocument();
    await user.click(screen.getByText('Finish setup stub'));
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it('waits for readiness before allowing the toggle to enable Code Mode', async () => {
    let resolve;
    mocks.codeSetupStatus.mockReturnValue(new Promise((done) => { resolve = done; }));
    const onEnabledChange = vi.fn();
    const user = userEvent.setup();
    render(<CodingAgentSettingsSection {...baseProps} enabled={false} onEnabledChange={onEnabledChange} />);
    const toggle = screen.getByRole('switch', { name: 'Enable Code Mode' });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await user.click(toggle);
    expect(onEnabledChange).not.toHaveBeenCalled();
    await act(async () => resolve({ installed: false, gitWorks: true }));
    expect(toggle).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(toggle);
    expect(screen.getByText('Code setup modal')).toBeInTheDocument();
    expect(onEnabledChange).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'malformed'])('offers a working retry after a %s readiness response', async (kind) => {
    if (kind === 'rejected') mocks.codeSetupStatus.mockRejectedValueOnce(new Error('IPC unavailable'));
    else mocks.codeSetupStatus.mockResolvedValueOnce({});
    mocks.codeSetupStatus.mockResolvedValue({ installed: false, gitWorks: true });
    const onEnabledChange = vi.fn();
    const user = userEvent.setup();
    render(<CodingAgentSettingsSection {...baseProps} enabled={false} onEnabledChange={onEnabledChange} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check this computer');
    const toggle = screen.getByRole('switch', { name: 'Enable Code Mode' });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(toggle).not.toHaveAttribute('aria-disabled', 'true'));
    await user.click(toggle);
    expect(screen.getByText('Code setup modal')).toBeInTheDocument();
    expect(onEnabledChange).not.toHaveBeenCalled();
  });

  it('still lets an existing user disable Code Mode if the readiness check fails', async () => {
    mocks.codeSetupStatus.mockRejectedValue(new Error('IPC unavailable'));
    const onEnabledChange = vi.fn();
    render(<CodingAgentSettingsSection {...baseProps} enabled onEnabledChange={onEnabledChange} />);
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('switch', { name: 'Enable Code Mode' }));
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });

  it('switches on directly when the coding agent is already installed', async () => {
    mocks.codeSetupStatus.mockResolvedValue({ installed: true, gitWorks: true, devSource: false });
    const onEnabledChange = vi.fn();
    const user = userEvent.setup();
    render(<CodingAgentSettingsSection {...baseProps} enabled={false} onEnabledChange={onEnabledChange} />);

    await waitFor(() => expect(mocks.codeSetupStatus).toHaveBeenCalled());
    await user.click(screen.getByRole('switch', { name: 'Enable Code Mode' }));

    expect(onEnabledChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText('Code setup modal')).toBeNull();
  });

  it('still runs the setup when the components are there but Git is not', async () => {
    // The partial-failure path: the components installed, winget did not.
    mocks.codeSetupStatus.mockResolvedValue({ installed: true, gitWorks: false, devSource: false });
    const onEnabledChange = vi.fn();
    const user = userEvent.setup();
    render(<CodingAgentSettingsSection {...baseProps} enabled={false} onEnabledChange={onEnabledChange} />);

    await waitFor(() => expect(mocks.codeSetupStatus).toHaveBeenCalled());
    expect(await screen.findByText(/Switching this on installs Git\./)).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Enable Code Mode' }));
    expect(screen.getByText('Code setup modal')).toBeInTheDocument();
    expect(onEnabledChange).not.toHaveBeenCalled();
  });

  it('keeps offering Set up now while Git is missing on a computer that already has Code Mode on', async () => {
    mocks.codeSetupStatus.mockResolvedValue({ installed: true, gitWorks: false, devSource: false });
    render(<CodingAgentSettingsSection {...baseProps} enabled onEnabledChange={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Set up now' })).toBeInTheDocument();
    expect(screen.getByText(/Code Mode is on, but Git is not installed on this computer yet\./)).toBeInTheDocument();
  });

  it('reads the agent list again once an existing user finishes the setup', async () => {
    // The status is read on mount, when the modal opens and again when it
    // closes; by then the components are on disk.
    mocks.codeSetupStatus
      .mockResolvedValueOnce({ installed: false, gitWorks: true, devSource: false })
      .mockResolvedValueOnce({ installed: false, gitWorks: true, devSource: false })
      .mockResolvedValue({ installed: true, gitWorks: true, devSource: false });
    vi.mocked(codingApi.engines)
      .mockResolvedValueOnce([{ id: 'codex', label: 'Codex', available: false, reason: 'Code Mode components are not installed on this computer yet.' }])
      .mockResolvedValueOnce([{ id: 'codex', label: 'Codex', available: true }]);
    const user = userEvent.setup();
    render(<CodingAgentSettingsSection {...baseProps} enabled onEnabledChange={vi.fn()} />);

    const agent = await screen.findByRole('combobox', { name: 'Coding agent engine' });
    await waitFor(() => expect(agent).toBeDisabled());
    await user.click(await screen.findByRole('button', { name: 'Set up now' }));
    await user.click(screen.getByText('Finish setup stub'));

    await waitFor(() => expect(codingApi.engines).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Coding agent engine' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Set up now' })).toBeNull();
  });

  it('offers Set up now to someone who already had Code Mode on before the components moved out of the first install', async () => {
    mocks.codeSetupStatus.mockResolvedValue({ installed: false, gitWorks: true, devSource: false });
    const user = userEvent.setup();
    render(<CodingAgentSettingsSection {...baseProps} enabled onEnabledChange={vi.fn()} />);

    const setUp = await screen.findByRole('button', { name: 'Set up now' });
    expect(screen.getByText(/components are not installed on this computer yet/)).toBeInTheDocument();
    await user.click(setUp);
    expect(screen.getByText('Code setup modal')).toBeInTheDocument();
  });
});
