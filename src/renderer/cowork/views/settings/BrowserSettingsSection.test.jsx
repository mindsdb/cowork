import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({
  fetchBrowseStatus: vi.fn(),
  provisionBrowser: vi.fn(),
}));

import { fetchBrowseStatus, provisionBrowser } from '../../api';
import BrowserSettingsSection, { browserStatusLine } from './BrowserSettingsSection';

describe('browserStatusLine', () => {
  it('says what state the browser is in', () => {
    expect(browserStatusLine(null, '')).toBe('Checking your browser…');
    expect(browserStatusLine({ provisioned: false }, '')).toBe('Not set up yet.');
    expect(browserStatusLine({ provisioned: true, status: 'running' }, '')).toBe('Ready.');
    expect(browserStatusLine({ provisioned: true, status: 'booting' }, '')).toMatch(/Starting up/);
    expect(browserStatusLine({ provisioned: true, status: 'stopped' }, '')).toMatch(/Asleep/);
    expect(browserStatusLine(null, 'boom')).toMatch(/Could not reach MindsHub/);
  });
});

describe('BrowserSettingsSection', () => {
  beforeEach(() => {
    fetchBrowseStatus.mockReset();
    provisionBrowser.mockReset();
  });

  it('offers setup until the browser exists, then turns it on', async () => {
    fetchBrowseStatus.mockResolvedValue({ provisioned: false, status: 'none' });
    provisionBrowser.mockResolvedValue({ provisioned: true, status: 'provisioning' });
    const setSetting = vi.fn();
    render(<BrowserSettingsSection settings={{}} setSetting={setSetting} />);
    const button = await screen.findByRole('button', { name: 'Set up' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(provisionBrowser).toHaveBeenCalled());
    await waitFor(() => expect(setSetting).toHaveBeenCalledWith('browserEnabled', true));
    expect(await screen.findByRole('switch', { name: 'Shared browser' })).toBeInTheDocument();
  });

  it('shows the toggle for a provisioned browser', async () => {
    fetchBrowseStatus.mockResolvedValue({ provisioned: true, status: 'running' });
    const setSetting = vi.fn();
    render(<BrowserSettingsSection settings={{ browserEnabled: false }} setSetting={setSetting} />);
    const toggle = await screen.findByRole('switch', { name: 'Shared browser' });
    fireEvent.click(toggle);
    expect(setSetting).toHaveBeenCalledWith('browserEnabled', true);
    expect(screen.getByText(/Ready\./)).toBeInTheDocument();
  });
});
