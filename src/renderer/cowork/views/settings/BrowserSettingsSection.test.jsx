import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import loginsAnswer from '../../__fixtures__/browser-router/logins_answer.json';

const shell = vi.hoisted(() => ({ isWeb: true, inApp: false, clearData: null, usageEvents: true, setUsageEvents: null }));
vi.mock('../../../platform/host', () => ({
  host: {
    get isWeb() { return shell.isWeb; },
    get supportsInAppBrowser() { return shell.inApp; },
    inAppBrowser: { clearData: (...args) => shell.clearData(...args) },
    getUsageEventsPref: async () => shell.usageEvents,
    setUsageEventsPref: (...args) => shell.setUsageEvents(...args),
  },
}));

vi.mock('../../api', () => ({
  fetchBrowseStatus: vi.fn(),
  provisionBrowser: vi.fn(),
  signOutOfBrowserSites: vi.fn(),
}));

import { fetchBrowseStatus, provisionBrowser, signOutOfBrowserSites } from '../../api';
import BrowserSettingsSection, {
  DESKTOP_SIGN_INS,
  NOT_ENTITLED,
  ORGANIZATION_OFF,
  SIGN_OUT_HELP,
  USAGE_EVENTS_HELP,
  WEB_JEV_LINE,
  WEB_SIGN_INS,
  WEB_SIGN_OUT_HELP,
  desktopDisclosure,
  pageContentLine,
  webDisclosure,
} from './BrowserSettingsSection';

const AVAILABLE = { enabled: true, available: true, status: 'running' };

function renderSection(settings = {}, setSetting = vi.fn()) {
  return render(<BrowserSettingsSection settings={settings} setSetting={setSetting} agentLabel="Cowork" />);
}

// Lets the status answer (and anything it starts) land before asserting absence.
async function settled() {
  await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalled());
  await new Promise((resolve) => { setTimeout(resolve, 0); });
}

describe('BrowserSettingsSection', () => {
  beforeEach(() => {
    shell.isWeb = true;
    shell.inApp = false;
    shell.clearData = vi.fn(async () => ({ ok: true }));
    shell.usageEvents = true;
    shell.setUsageEvents = vi.fn(async () => true);
    fetchBrowseStatus.mockReset();
    provisionBrowser.mockReset();
    signOutOfBrowserSites.mockReset();
    signOutOfBrowserSites.mockResolvedValue(loginsAnswer.examples['signed out of every site'].body);
  });

  it.each([
    ['the server says the browser is not offered', () => fetchBrowseStatus.mockResolvedValue({ enabled: true, available: false, status: 'unavailable' })],
    ['the status call fails', () => fetchBrowseStatus.mockRejectedValue(new Error('offline'))],
  ])('renders nothing when %s', async (_case, answer) => {
    answer();
    const { container } = renderSection();
    await settled();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Couldn't check/)).not.toBeInTheDocument();
  });

  it('shows the switch in its own group once the server offers the browser', async () => {
    fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    renderSection();
    const toggle = await screen.findByRole('switch', { name: 'Shared browser' });
    expect(toggle).toBeChecked();
    expect(screen.getByRole('heading', { level: 2, name: 'Shared browser' })).toBeInTheDocument();
  });

  it.each([
    ['not_entitled', NOT_ENTITLED],
    ['organization_off', ORGANIZATION_OFF],
  ])('says plainly when access is off (%s), with no switch, and still offers sign-out', async (status, line) => {
    fetchBrowseStatus.mockResolvedValue({ enabled: true, available: false, status });
    renderSection();
    expect(await screen.findByText(line)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOutOfBrowserSites).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Signed out of all sites.')).toBeInTheDocument();
  });

  it('names the organization switch in the words the server pinned', () => {
    expect(ORGANIZATION_OFF).toBe('Your organization turned off the browser.');
    expect(NOT_ENTITLED).toBe('Not available for your account.');
  });

  it.each([true, false])('offers no other place for the browser to run, and no city or proxy (web: %s)', async (web) => {
    shell.isWeb = web;
    shell.inApp = !web;
    fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    renderSection();
    await screen.findByRole('switch', { name: 'Shared browser' });
    await settled();
    expect(screen.queryByText('Where the browser runs')).not.toBeInTheDocument();
    expect(screen.queryByText('Your own server')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/server address|API key|city/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/proxy|residential|home connection/i)).not.toBeInTheDocument();
  });

  it('is a switch with no setup step: turning it on only saves the setting', async () => {
    fetchBrowseStatus.mockResolvedValue({ enabled: false, available: true, status: 'none' });
    const setSetting = vi.fn();
    renderSection({ browserEnabled: false }, setSetting);
    const toggle = await screen.findByRole('switch', { name: 'Shared browser' });
    expect(screen.queryByRole('button', { name: 'Set up' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(setSetting).toHaveBeenCalledWith('browserEnabled', true);
    await settled();
    expect(provisionBrowser).not.toHaveBeenCalled();
  });

  describe('on the web', () => {
    beforeEach(() => fetchBrowseStatus.mockResolvedValue(AVAILABLE));

    it("says websites see MindsDB's addresses, that sign-ins are kept and reused, and what the model provider and Jev get", async () => {
      renderSection();
      expect(await screen.findByText(webDisclosure('Cowork'))).toBeInTheDocument();
      expect(webDisclosure('Cowork')).toMatch(/websites see MindsDB's addresses/);
      expect(webDisclosure('Cowork')).toMatch(/asks you before a step that submits, buys, sends or deletes/);
      expect(screen.getByText(WEB_SIGN_INS)).toBeInTheDocument();
      expect(WEB_SIGN_INS).toMatch(/every organization you belong to, until they go 90 days unused/);
      expect(WEB_SIGN_INS).toMatch(/Deleting your MindsHub account deletes them/);
      expect(screen.getByText(`${pageContentLine('Cowork')} ${WEB_JEV_LINE}`)).toBeInTheDocument();
      expect(WEB_JEV_LINE).toMatch(/first 1,500 characters/);
    });

    it('signs out of every site through the server, keeping saved tabs', async () => {
      renderSection();
      expect(await screen.findByText(WEB_SIGN_OUT_HELP)).toBeInTheDocument();
      expect(WEB_SIGN_OUT_HELP).toMatch(/Saved tabs stay/);
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(signOutOfBrowserSites).toHaveBeenCalledTimes(1);
      expect(shell.clearData).not.toHaveBeenCalled();
      expect(await screen.findByText('Signed out of all sites.')).toBeInTheDocument();
    });

    it('says so when the server could not sign out', async () => {
      signOutOfBrowserSites.mockRejectedValue(Object.assign(new Error('API /browse/logins returned 424'), { status: 424 }));
      renderSection();
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
      expect(await screen.findByText("Couldn't clear the browser's data. Try again.")).toBeInTheDocument();
    });

    it('offers no usage-events switch', async () => {
      renderSection();
      await screen.findByRole('switch', { name: 'Shared browser' });
      expect(screen.queryByRole('switch', { name: 'Send anonymous usage events' })).not.toBeInTheDocument();
    });
  });

  describe("on the desktop's in-app browser", () => {
    beforeEach(() => {
      shell.isWeb = false;
      shell.inApp = true;
      fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    });

    it("says websites see the person's own connection, that no MindsDB server carries it, and that the agent's code can read the sign-ins", async () => {
      renderSection();
      expect(await screen.findByText(desktopDisclosure('Cowork'))).toBeInTheDocument();
      expect(desktopDisclosure('Cowork')).toMatch(/your own connection, and no MindsDB server carries your browsing/);
      expect(desktopDisclosure('Cowork')).toMatch(/Cowork's code runs as you and can read this browser's sign-ins/);
      expect(screen.getByText(DESKTOP_SIGN_INS)).toBeInTheDocument();
      expect(screen.getByText(pageContentLine('Cowork'))).toBeInTheDocument();
      expect(screen.queryByText(/Jev/)).not.toBeInTheDocument();
    });

    it('signs out of all sites through the app, and says so', async () => {
      renderSection();
      expect(await screen.findByText(SIGN_OUT_HELP)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(shell.clearData).toHaveBeenCalledTimes(1);
      expect(signOutOfBrowserSites).not.toHaveBeenCalled();
      expect(await screen.findByText('Signed out of all sites.')).toBeInTheDocument();
    });

    it('says so when the browser data could not be cleared', async () => {
      shell.clearData = vi.fn(async () => ({ ok: false }));
      renderSection();
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
      expect(await screen.findByText("Couldn't clear the browser's data. Try again.")).toBeInTheDocument();
    });

    it("offers a switch for the agent's usage events, on by default, that saves through the app", async () => {
      renderSection();
      const toggle = await screen.findByRole('switch', { name: 'Send anonymous usage events' });
      expect(toggle).toBeChecked();
      expect(screen.getByText(USAGE_EVENTS_HELP)).toBeInTheDocument();
      expect(USAGE_EVENTS_HELP).toMatch(/never page text or addresses/);
      fireEvent.click(toggle);
      await waitFor(() => expect(shell.setUsageEvents).toHaveBeenCalledWith(false));
      expect(toggle).not.toBeChecked();
    });

    it('puts the usage-events switch back when the app could not save it', async () => {
      shell.setUsageEvents = vi.fn(async () => false);
      renderSection();
      const toggle = await screen.findByRole('switch', { name: 'Send anonymous usage events' });
      fireEvent.click(toggle);
      await waitFor(() => expect(shell.setUsageEvents).toHaveBeenCalledWith(false));
      await waitFor(() => expect(toggle).toBeChecked());
    });

    it('offers nothing while the server says the browser is not registered', async () => {
      fetchBrowseStatus.mockResolvedValue({ enabled: true, available: false, status: 'unavailable' });
      const { container } = renderSection();
      await settled();
      expect(container).toBeEmptyDOMElement();
    });
  });
});
