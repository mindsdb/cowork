import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => ({
  fetchChannelBindings: vi.fn(),
  createChannelBinding: vi.fn(),
  updateChannelBinding: vi.fn(async () => ({})),
  deleteChannelBinding: vi.fn(),
  fetchProjects: vi.fn(async () => []),
}));

import { fetchChannelBindings, updateChannelBinding } from '../api';
import ChannelBindings from './ChannelBindings';

const route = (over) => ({
  id: 'b1', channel_type: 'telegram', external_group_id: '555', trigger_rule: 'always',
  allow_scratchpad: false, allow_connectors: false, allow_memory_writes: false, allow_file_replies: false,
  ...over,
});
const box = (name) => screen.getByRole('checkbox', { name });

beforeEach(() => { vi.clearAllMocks(); });

describe('ChannelBindings — what a chat may use', () => {
  it('starts with everything off and saves only the switch that changed', async () => {
    fetchChannelBindings.mockResolvedValue([route()]);
    const user = userEvent.setup();
    render(<ChannelBindings channelType="telegram" />);

    await screen.findByText('555');
    expect(['Code and files', 'Connections', 'Memory writes', 'Send files back'].map((n) => box(n).checked))
      .toEqual([false, false, false, false]);
    await user.click(box('Send files back'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateChannelBinding).toHaveBeenCalledWith('b1', { allow_file_replies: true });
  });

  it('keeps connections off and disabled until code and files is on', async () => {
    fetchChannelBindings.mockResolvedValue([route({ allow_connectors: true })]);
    const user = userEvent.setup();
    render(<ChannelBindings channelType="telegram" />);

    await screen.findByText('555');
    expect(box('Connections').checked).toBe(false);
    expect(box('Connections').disabled).toBe(true);
    expect(screen.getByText('Needs code and files on')).toBeTruthy();
    await user.click(box('Code and files'));
    expect(box('Connections').disabled).toBe(false);
  });

  it('turns connections off with code and files in the same save', async () => {
    fetchChannelBindings.mockResolvedValue([route({ allow_scratchpad: true, allow_connectors: true })]);
    const user = userEvent.setup();
    render(<ChannelBindings channelType="telegram" />);

    await screen.findByText('555');
    await user.click(box('Code and files'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateChannelBinding).toHaveBeenCalledWith('b1', { allow_scratchpad: false, allow_connectors: false });
  });

  it('states what code and files lets a person reach', async () => {
    fetchChannelBindings.mockResolvedValue([route()]);
    render(<ChannelBindings channelType="telegram" />);

    expect(await screen.findByText(/read and change this project's files, including its memory and connection settings/))
      .toBeTruthy();
  });

  it('shows the switches read-only to someone who may not change them', async () => {
    fetchChannelBindings.mockResolvedValue([route({ allow_scratchpad: true })]);
    render(<ChannelBindings channelType="telegram" switchesReadOnly />);

    await screen.findByText('555');
    expect(['Code and files', 'Connections', 'Memory writes', 'Send files back'].map((n) => box(n).disabled))
      .toEqual([true, true, true, true]);
    expect(box('Code and files').checked).toBe(true);
    expect(screen.getByText('An organization admin changes these.')).toBeTruthy();
  });

  it('saves connections as shown, off, when code and files is switched on', async () => {
    fetchChannelBindings.mockResolvedValue([route({ allow_scratchpad: false, allow_connectors: true })]);
    const user = userEvent.setup();
    render(<ChannelBindings channelType="telegram" />);

    await screen.findByText('555');
    await user.click(box('Code and files'));
    expect(box('Connections').checked).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateChannelBinding).toHaveBeenCalledWith('b1', { allow_scratchpad: true, allow_connectors: false });
  });
});
