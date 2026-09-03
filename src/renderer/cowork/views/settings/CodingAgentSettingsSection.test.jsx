import { render, screen, waitFor } from '@testing-library/react';
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
