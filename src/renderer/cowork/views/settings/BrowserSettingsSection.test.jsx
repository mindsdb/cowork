import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({
  fetchBrowseLocations: vi.fn(),
  fetchBrowseStatus: vi.fn(),
  provisionBrowser: vi.fn(),
  updateSettings: vi.fn(),
}));

import { fetchBrowseLocations, fetchBrowseStatus, provisionBrowser, updateSettings } from '../../api';
import BrowserSettingsSection, { browserStatusLine, cityHelp, serverUrlProblem } from './BrowserSettingsSection';

describe('browserStatusLine', () => {
  it('says what state the browser is in', () => {
    expect(browserStatusLine(null, '')).toBe('Checking your browser…');
    expect(browserStatusLine({ provisioned: false }, '')).toBe('Not set up yet.');
    expect(browserStatusLine({ provisioned: true, status: 'running' }, '')).toBe('Ready.');
    expect(browserStatusLine({ provisioned: true, status: 'booting' }, '')).toMatch(/Starting up/);
    expect(browserStatusLine({ provisioned: true, status: 'stopped' }, '')).toMatch(/Asleep/);
    expect(browserStatusLine(null, 'MindsHub refused this request.')).toBe("Couldn't check your browser: MindsHub refused this request.");
  });

  it('describes your own server', () => {
    expect(browserStatusLine({ mode: 'standalone', status: 'not_configured' }, '')).toMatch(/address and API key/);
    expect(browserStatusLine({ mode: 'standalone', status: 'running' }, '')).toBe('Connected.');
    expect(browserStatusLine({ mode: 'standalone', status: 'unreachable', endpoint: 'https://b.acme.dev' }, '')).toMatch(/Can't reach the server at https:\/\/b\.acme\.dev/);
  });
});

describe('serverUrlProblem', () => {
  it('takes https anywhere and http only on this machine', () => {
    expect(serverUrlProblem('https://browser.acme.dev')).toBe('');
    expect(serverUrlProblem('https://browser.acme.dev/')).toBe('');
    expect(serverUrlProblem('http://localhost:8080')).toBe('');
    expect(serverUrlProblem('http://127.0.0.1:8080')).toBe('');
    expect(serverUrlProblem('')).toMatch(/Enter/);
    expect(serverUrlProblem('http://10.0.0.5:8080')).toMatch(/https/);
    expect(serverUrlProblem('https://browser.acme.dev/api')).toMatch(/no path/);
    expect(serverUrlProblem('not a url')).toMatch(/web address/);
  });
});

describe('BrowserSettingsSection', () => {
  beforeEach(() => {
    fetchBrowseLocations.mockReset();
    fetchBrowseLocations.mockResolvedValue({ proxy_available: false, prefs: null, cities: [], effective_city: '' });
    fetchBrowseStatus.mockReset();
    provisionBrowser.mockReset();
    updateSettings.mockReset();
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

  it('switching to your own server shows the address and key fields', async () => {
    fetchBrowseStatus.mockResolvedValue({ provisioned: true, status: 'running', mode: 'mindshub' });
    const setSetting = vi.fn();
    const { rerender } = render(<BrowserSettingsSection settings={{}} setSetting={setSetting} />);
    expect(screen.queryByLabelText('Browser server address')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText('Your own server'));
    expect(setSetting).toHaveBeenCalledWith('browserMode', 'standalone');
    rerender(<BrowserSettingsSection settings={{ browserMode: 'standalone' }} setSetting={setSetting} />);
    expect(screen.getByLabelText('Browser server address')).toBeInTheDocument();
    expect(screen.getByLabelText('Browser server API key')).toHaveAttribute('type', 'password');
    expect(screen.getByText(/Add your server below/)).toBeInTheDocument();
  });

  it('saves and tests your own server', async () => {
    fetchBrowseStatus
      .mockResolvedValueOnce({ provisioned: false, status: 'not_configured', mode: 'standalone' })
      .mockResolvedValueOnce({ provisioned: true, status: 'running', mode: 'standalone', endpoint: 'https://b.acme.dev' });
    updateSettings.mockResolvedValue({});
    const settings = { browserMode: 'standalone', browserServiceUrl: 'https://b.acme.dev/', browserServiceApiKey: 'secret' };
    render(<BrowserSettingsSection settings={settings} setSetting={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save and test' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      browserMode: 'standalone', browserServiceUrl: 'https://b.acme.dev', browserServiceApiKey: 'secret',
    }));
    expect(await screen.findByText(/Connected\./)).toBeInTheDocument();
  });

  it('refuses plain http to another machine before saving', async () => {
    fetchBrowseStatus.mockResolvedValue({ provisioned: false, status: 'not_configured', mode: 'standalone' });
    const settings = { browserMode: 'standalone', browserServiceUrl: 'http://10.0.0.5:8080', browserServiceApiKey: 'k' };
    render(<BrowserSettingsSection settings={settings} setSetting={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save and test' }));
    expect(await screen.findByText(/Use https:\/\/ for a server on another machine/)).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('shows a rejected API key in the server\'s words', async () => {
    fetchBrowseStatus
      .mockResolvedValueOnce({ provisioned: true, status: 'running', mode: 'standalone' })
      .mockRejectedValueOnce(new Error('The browser service at b.acme.dev rejected the API key.'));
    updateSettings.mockResolvedValue({});
    const settings = { browserMode: 'standalone', browserServiceUrl: 'https://b.acme.dev', browserServiceApiKey: 'wrong' };
    render(<BrowserSettingsSection settings={settings} setSetting={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save and test' }));
    expect(await screen.findByText(/rejected the API key/)).toBeInTheDocument();
  });

  it('hides the home connection settings when the deployment has no proxy', async () => {
    fetchBrowseStatus.mockResolvedValue({ provisioned: true, status: 'running' });
    render(<BrowserSettingsSection settings={{}} setSetting={vi.fn()} />);
    await screen.findByRole('switch', { name: 'Shared browser' });
    await waitFor(() => expect(fetchBrowseLocations).toHaveBeenCalled());
    expect(screen.queryByRole('switch', { name: 'Browse through a home internet connection' })).not.toBeInTheDocument();
  });

  it('hides them when the locations call fails', async () => {
    fetchBrowseStatus.mockResolvedValue({ provisioned: true, status: 'running' });
    fetchBrowseLocations.mockRejectedValue(new Error('nope'));
    render(<BrowserSettingsSection settings={{}} setSetting={vi.fn()} />);
    await screen.findByRole('switch', { name: 'Shared browser' });
    await waitFor(() => expect(fetchBrowseLocations).toHaveBeenCalled());
    expect(screen.queryByLabelText('Browser city')).not.toBeInTheDocument();
  });

  it('turns the home connection off, saves it and tells the browser', async () => {
    fetchBrowseStatus.mockResolvedValue({ provisioned: true, status: 'running', mode: 'mindshub' });
    fetchBrowseLocations.mockResolvedValue({
      proxy_available: true, prefs: null, cities: [{ id: 'us-los_angeles', label: 'Los Angeles, US' }], effective_city: 'us-los_angeles',
    });
    provisionBrowser.mockResolvedValue({ provisioned: true, status: 'running', mode: 'mindshub' });
    updateSettings.mockResolvedValue({});
    const setSetting = vi.fn();
    render(<BrowserSettingsSection settings={{}} setSetting={setSetting} />);
    const toggle = await screen.findByRole('switch', { name: 'Browse through a home internet connection' });
    expect(toggle).toBeChecked();
    expect(screen.getByText('Automatic uses Los Angeles, US. Applies to new tasks.')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(setSetting).toHaveBeenCalledWith('browserProxy', false);
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ browserProxy: false }));
    await waitFor(() => expect(provisionBrowser).toHaveBeenCalled());
  });

  it('greys out the city while the home connection is off, and in your own server mode shows neither', async () => {
    fetchBrowseStatus.mockResolvedValue({ provisioned: true, status: 'running', mode: 'mindshub' });
    fetchBrowseLocations.mockResolvedValue({ proxy_available: true, prefs: null, cities: [], effective_city: '' });
    const { rerender } = render(<BrowserSettingsSection settings={{ browserProxy: false }} setSetting={vi.fn()} />);
    const toggle = await screen.findByRole('switch', { name: 'Browse through a home internet connection' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByLabelText('Browser city')).toBeDisabled();
    rerender(<BrowserSettingsSection settings={{ browserMode: 'standalone' }} setSetting={vi.fn()} />);
    expect(screen.queryByLabelText('Browser city')).not.toBeInTheDocument();
  });
});

describe('cityHelp', () => {
  const locations = { cities: [{ id: 'gb-london', label: 'London, GB' }], effective_city: 'gb-london' };
  it('names the automatic pick only when automatic', () => {
    expect(cityHelp('', locations)).toBe('Automatic uses London, GB. Applies to new tasks.');
    expect(cityHelp('gb-london', locations)).toBe('Applies to new tasks.');
    expect(cityHelp('', null)).toBe('Applies to new tasks.');
  });
});
