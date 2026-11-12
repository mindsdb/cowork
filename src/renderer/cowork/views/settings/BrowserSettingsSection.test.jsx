import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import loginsAnswer from '../../__fixtures__/browser-router/logins_answer.json';

const shell = vi.hoisted(() => ({ isWeb: true, inApp: false, clearData: null, usageEvents: true, setUsageEvents: null }));
/* Main's word that the local server took the in-app browser's registration. */
const registered = vi.hoisted(() => new Set());
vi.mock('../../../platform/host', () => ({
  host: {
    get isWeb() { return shell.isWeb; },
    get supportsInAppBrowser() { return shell.inApp; },
    inAppBrowser: { clearData: (...args) => shell.clearData(...args) },
    // As the real host answers: null on the web.
    getUsageEventsPref: async () => (shell.isWeb ? null : shell.usageEvents),
    setUsageEventsPref: (...args) => shell.setUsageEvents(...args),
  },
  onInAppBrowserRegistered: (cb) => {
    registered.add(cb);
    return () => registered.delete(cb);
  },
}));

vi.mock('../../api', () => ({
  fetchBrowseStatus: vi.fn(),
  provisionBrowser: vi.fn(),
  signOutOfBrowserSites: vi.fn(),
  testDecisionModel: vi.fn(),
}));

import { useState } from 'react';
import { fetchBrowseStatus, provisionBrowser, signOutOfBrowserSites, testDecisionModel } from '../../api';
import { READ_TIMEOUT_MS } from '../../lib/browseStatus';
import BrowserSettingsSection, {
  approveStepsHelp,
  onlyWhenNeededHelp,
  DESKTOP_SIGN_INS,
  NOT_ENTITLED,
  ORGANIZATION_OFF,
  SIGN_OUT_HELP,
  SIGN_OUT_UNCONFIRMED,
  STATUS_UNCONFIRMED,
  WEB_JEV_LINE,
  WEB_SIGN_INS,
  WEB_SIGN_OUT_HELP,
  desktopDisclosure,
  pageContentLine,
  usageEventsHelp,
  webDisclosure,
} from './BrowserSettingsSection';

const AVAILABLE = { enabled: true, available: true, status: 'running' };

// The browser on, unless a test says otherwise: most tests are about its settings.
function renderSection(settings = { browserEnabled: true }, setSetting = vi.fn(), props = {}) {
  return render(<BrowserSettingsSection settings={settings} setSetting={setSetting} agentLabel="Cowork" {...props} />);
}

/* A read whose connection stalls: no answer and no error until the limit it
   was given passes, when it rejects as api.js's abort does. */
function stalls({ timeoutMs }) {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new DOMException('The operation was aborted.', 'AbortError')), timeoutMs);
  });
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
    registered.clear();
    fetchBrowseStatus.mockReset();
    provisionBrowser.mockReset();
    signOutOfBrowserSites.mockReset();
    signOutOfBrowserSites.mockResolvedValue(loginsAnswer.examples['signed out of every site'].body);
  });

  it('renders nothing when the server says the browser is not offered', async () => {
    fetchBrowseStatus.mockResolvedValue({ enabled: true, available: false, status: 'unavailable' });
    const { container } = renderSection();
    await settled();
    expect(container).toBeEmptyDOMElement();
  });

  describe('on a server with no status route (a 404), which predates the browser', () => {
    const noRoute = () => Object.assign(new Error('API /browse/status returned 404'), { status: 404 });

    it('renders nothing on the web', async () => {
      fetchBrowseStatus.mockRejectedValue(noRoute());
      const { container } = renderSection();
      await settled();
      expect(container).toBeEmptyDOMElement();
    });

    it('offers no browser on a desktop that hosts the in-app browser', async () => {
      shell.isWeb = false;
      shell.inApp = true;
      fetchBrowseStatus.mockRejectedValue(noRoute());
      renderSection();
      // The usage-events group shows whatever the browser's status.
      await screen.findByRole('switch', { name: 'Send anonymous usage events' });
      await settled();
      expect(screen.queryByRole('heading', { level: 2, name: 'Shared browser' })).not.toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: 'Shared browser' })).not.toBeInTheDocument();
      expect(screen.queryByText(STATUS_UNCONFIRMED)).not.toBeInTheDocument();
      expect(screen.queryByText(ORGANIZATION_OFF)).not.toBeInTheDocument();
      expect(screen.queryByText(NOT_ENTITLED)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    });
  });

  describe('when the status call fails', () => {
    // cowork-server's own read of MindsHub, or the router behind it, did not answer.
    const unreachable = () => Object.assign(new Error('MindsHub did not answer'), { status: 503, code: 'mindshub_unreachable' });

    it('says the browser could not be confirmed, and keeps the switch and sign-out', async () => {
      fetchBrowseStatus.mockRejectedValue(unreachable());
      const setSetting = vi.fn();
      renderSection({ browserEnabled: true }, setSetting);
      expect(await screen.findByText(STATUS_UNCONFIRMED)).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Shared browser' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('switch', { name: 'Shared browser' }));
      expect(setSetting).toHaveBeenCalledWith('browserEnabled', false);
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(signOutOfBrowserSites).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('Signed out of all sites.')).toBeInTheDocument();
      // No disclosure is shown for an answer that never came.
      expect(screen.queryByText(webDisclosure('Cowork'))).not.toBeInTheDocument();
    });

    it('says so once a read with no answer passes the time limit, and not before', async () => {
      vi.useFakeTimers();
      try {
        fetchBrowseStatus.mockImplementation(stalls);
        renderSection();
        await act(async () => { await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1); });
        expect(fetchBrowseStatus).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(STATUS_UNCONFIRMED)).not.toBeInTheDocument();
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(screen.getByText(STATUS_UNCONFIRMED)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps one read out through focus and a visible tab, so the time limit still passes', async () => {
      vi.useFakeTimers();
      try {
        fetchBrowseStatus.mockImplementation(stalls);
        renderSection();
        await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
        act(() => {
          window.dispatchEvent(new Event('focus'));
          document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(fetchBrowseStatus).toHaveBeenCalledTimes(1);
        await act(async () => { await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 15_000); });
        expect(screen.getByText(STATUS_UNCONFIRMED)).toBeInTheDocument();
        // Once that read has failed, focus asks again.
        act(() => { window.dispatchEvent(new Event('focus')); });
        expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('asks again on Retry, and shows the answer', async () => {
      fetchBrowseStatus.mockRejectedValueOnce(unreachable()).mockResolvedValue(AVAILABLE);
      renderSection();
      await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
      expect(await screen.findByText(webDisclosure('Cowork'))).toBeInTheDocument();
      expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(STATUS_UNCONFIRMED)).not.toBeInTheDocument();
    });

    it('keeps the last answer when a later read fails', async () => {
      fetchBrowseStatus.mockResolvedValueOnce(AVAILABLE).mockRejectedValue(unreachable());
      renderSection();
      expect(await screen.findByText(webDisclosure('Cowork'))).toBeInTheDocument();
      act(() => { window.dispatchEvent(new Event('focus')); });
      await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalledTimes(2));
      await settled();
      expect(screen.getByText(webDisclosure('Cowork'))).toBeInTheDocument();
      expect(screen.queryByText(STATUS_UNCONFIRMED)).not.toBeInTheDocument();
    });

    it('keeps an answered unavailable when a later read fails', async () => {
      fetchBrowseStatus.mockResolvedValueOnce({ enabled: true, available: false, status: 'unavailable' }).mockRejectedValue(unreachable());
      const { container } = renderSection();
      await settled();
      act(() => { window.dispatchEvent(new Event('focus')); });
      await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalledTimes(2));
      await settled();
      expect(container).toBeEmptyDOMElement();
    });

    it('shows no group on a desktop shell that runs no browser', async () => {
      shell.isWeb = false;
      shell.inApp = false;
      shell.usageEvents = null;
      fetchBrowseStatus.mockRejectedValue(unreachable());
      const { container } = renderSection();
      await settled();
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('asks the server again', () => {
    beforeEach(() => {
      fetchBrowseStatus
        .mockResolvedValueOnce({ enabled: true, available: false, status: 'unavailable' })
        .mockResolvedValue(AVAILABLE);
    });

    it('when the window gets focus', async () => {
      renderSection();
      await settled();
      expect(screen.queryByRole('switch', { name: 'Shared browser' })).not.toBeInTheDocument();
      act(() => { window.dispatchEvent(new Event('focus')); });
      expect(await screen.findByRole('switch', { name: 'Shared browser' })).toBeInTheDocument();
    });

    it('when the tab shows again, and not while it is hidden', async () => {
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      try {
        renderSection();
        await settled();
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        await settled();
        expect(fetchBrowseStatus).toHaveBeenCalledTimes(1);
        visibility.mockReturnValue('visible');
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(await screen.findByRole('switch', { name: 'Shared browser' })).toBeInTheDocument();
        expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);
      } finally {
        visibility.mockRestore();
      }
    });

    it("when the desktop's browser registers, while the window keeps focus", async () => {
      shell.isWeb = false;
      shell.inApp = true;
      const { unmount } = renderSection();
      await settled();
      expect(screen.queryByRole('switch', { name: 'Shared browser' })).not.toBeInTheDocument();
      expect(registered.size).toBe(1);
      act(() => { registered.forEach((cb) => cb()); });
      expect(await screen.findByRole('switch', { name: 'Shared browser' })).toBeInTheDocument();
      expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);
      unmount();
      expect(registered.size).toBe(0);
    });

    it('and keeps only the newest answer', async () => {
      shell.isWeb = false;
      shell.inApp = true;
      let answerFirst;
      fetchBrowseStatus.mockReset();
      fetchBrowseStatus
        .mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }))
        .mockResolvedValue(AVAILABLE);
      renderSection();
      await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalledTimes(1));
      // The browser's registration asks again even with the first read still out.
      act(() => { registered.forEach((cb) => cb()); });
      expect(await screen.findByRole('switch', { name: 'Shared browser' })).toBeInTheDocument();
      await act(async () => { answerFirst({ enabled: true, available: false, status: 'unavailable' }); });
      expect(screen.getByRole('switch', { name: 'Shared browser' })).toBeInTheDocument();
    });
  });

  it('shows the switch in its own group once the server offers the browser, off and marked Beta until turned on', async () => {
    fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    renderSection({});
    const toggle = await screen.findByRole('switch', { name: 'Shared browser' });
    expect(toggle).not.toBeChecked();
    // Off: only the switch; approvals and sign-out show once it is on.
    expect(screen.queryByRole('switch', { name: 'Approve browser steps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: "Only show the browser when I'm needed" })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Use the shared browser/ })).toHaveTextContent('Beta');
    expect(screen.getByRole('heading', { level: 2, name: 'Shared browser' })).toBeInTheDocument();
  });

  it("opens the browser's help on a tap of its info button, since touch has no hover", async () => {
    fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    renderSection({});
    await screen.findByRole('switch', { name: 'Shared browser' });
    expect(screen.queryByText('Sign-ins')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Learn what Cowork sees' }));
    expect(await screen.findByText('Sign-ins')).toBeInTheDocument();
    expect(screen.getByText('What the model provider sees')).toBeInTheDocument();
  });

  it('approving browser steps is on until the person turns it off, and is their server-side setting', async () => {
    fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    const setSetting = vi.fn();
    renderSection({ browserEnabled: true }, setSetting);
    const toggle = await screen.findByRole('switch', { name: 'Approve browser steps' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(setSetting).toHaveBeenCalledWith('browserApproveSteps', false);
    expect(screen.getByText(approveStepsHelp('Cowork'))).toBeInTheDocument();
  });

  it("offers Only show the browser when I'm needed, on by default, with its help a tap away", async () => {
    fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    const setSetting = vi.fn();
    renderSection({ browserEnabled: true }, setSetting);
    const toggle = await screen.findByRole('switch', { name: "Only show the browser when I'm needed" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(setSetting).toHaveBeenCalledWith('browserOnlyWhenNeeded', false);
    expect(screen.queryByText(onlyWhenNeededHelp('Cowork'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'About showing the browser only when needed' }));
    expect(await screen.findByText(onlyWhenNeededHelp('Cowork'))).toBeInTheDocument();
  });

  it('shows the browser always only when that setting says false', async () => {
    fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    renderSection({ browserEnabled: true, browserOnlyWhenNeeded: false });
    expect(await screen.findByRole('switch', { name: "Only show the browser when I'm needed" })).not.toBeChecked();
  });

  it('shows approvals off only when the setting says false', async () => {
    fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    renderSection({ browserEnabled: true, browserApproveSteps: false });
    expect(await screen.findByRole('switch', { name: 'Approve browser steps' })).not.toBeChecked();
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
      // Sign-ins and what the model provider sees are on the switch, on hover.
      await userEvent.hover(screen.getByRole('switch', { name: 'Shared browser' }));
      expect(await screen.findByText(WEB_SIGN_INS)).toBeInTheDocument();
      expect(WEB_SIGN_INS).toMatch(/every organization you belong to, until they go 90 days unused or you sign out of all sites in Settings\.$/);
      // No deletion with the MindsHub account runs, so the line promises none.
      expect(WEB_SIGN_INS).not.toMatch(/delet/i);
      expect(screen.getByText(`${pageContentLine('Cowork')} ${WEB_JEV_LINE}`)).toBeInTheDocument();
      expect(WEB_JEV_LINE).toMatch(/the goal of each browser step/);
      expect(WEB_JEV_LINE).toMatch(/first 1,500 characters, and the recent steps, earlier addresses included/);
    });

    it('names no provider by sign-in on the web', async () => {
      renderSection({}, vi.fn(), { signedInToMindsHub: true });
      await screen.findByText(webDisclosure('Cowork'));
      await userEvent.hover(screen.getByRole('switch', { name: 'Shared browser' }));
      expect(await screen.findByText(`${pageContentLine('Cowork')} ${WEB_JEV_LINE}`)).toBeInTheDocument();
      expect(screen.queryByText(/MindsHub when you're signed in/)).not.toBeInTheDocument();
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

    it.each([
      ['with no code', undefined],
      ['while the browser starts', 'browser_starting'],
      ['while the browser is unavailable', 'browser_unavailable'],
    ])('says so when the server could not sign out (%s)', async (_case, code) => {
      signOutOfBrowserSites.mockRejectedValue(Object.assign(new Error('API /browse/logins returned 424'), { status: 424, code }));
      renderSection();
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
      expect(await screen.findByText("Couldn't clear the browser's data. Try again.")).toBeInTheDocument();
    });

    it('says the sign-out may have finished when the server stopped waiting for the browser', async () => {
      signOutOfBrowserSites.mockRejectedValue(Object.assign(new Error("The browser isn't reachable."), { status: 424, code: 'browser_unreachable' }));
      renderSection();
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
      expect(await screen.findByText(SIGN_OUT_UNCONFIRMED)).toBeInTheDocument();
      expect(screen.queryByText("Couldn't clear the browser's data. Try again.")).not.toBeInTheDocument();
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
      await userEvent.hover(screen.getByRole('switch', { name: 'Shared browser' }));
      expect(await screen.findByText(DESKTOP_SIGN_INS)).toBeInTheDocument();
      // Session cookies end when the app quits, so the line promises no more than the site keeps.
      expect(DESKTOP_SIGN_INS).toMatch(/until the site signs you out or you sign out of all sites in Settings\. Some sites sign you out when the app quits\.$/);
      expect(screen.getByText(pageContentLine('Cowork'))).toBeInTheDocument();
      expect(screen.queryByText(/MindsHub/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Jev/)).not.toBeInTheDocument();
    });

    it('says what Jev on MindsHub gets when it picks the steps, as on the web', async () => {
      fetchBrowseStatus.mockResolvedValue({ ...AVAILABLE, decisions_model: 'mindshub' });
      renderSection({}, vi.fn(), { signedInToMindsHub: true });
      await screen.findByText(desktopDisclosure('Cowork'));
      await userEvent.hover(screen.getByRole('switch', { name: 'Shared browser' }));
      const line = `${pageContentLine('Cowork', { signedInToMindsHub: true })} ${WEB_JEV_LINE}`;
      expect(await screen.findByText(line)).toBeInTheDocument();
    });

    it("says what the organization's own decision model gets", async () => {
      fetchBrowseStatus.mockResolvedValue({ ...AVAILABLE, decisions_model: 'own' });
      renderSection();
      await screen.findByText(desktopDisclosure('Cowork'));
      await userEvent.hover(screen.getByRole('switch', { name: 'Shared browser' }));
      expect(await screen.findByText(/^When Cowork reads a page.* Your organization's decision model also gets the goal of each browser step/)).toBeInTheDocument();
      expect(screen.queryByText(/Jev/)).not.toBeInTheDocument();
    });

    it('names MindsHub as the model provider while the app is signed in to it', async () => {
      renderSection({}, vi.fn(), { signedInToMindsHub: true });
      const line = pageContentLine('Cowork', { signedInToMindsHub: true });
      expect(line).toBe("When Cowork reads a page, its text and a screenshot go to the model provider that serves your turn, MindsHub when you're signed in.");
      await screen.findByText(desktopDisclosure('Cowork'));
      await userEvent.hover(screen.getByRole('switch', { name: 'Shared browser' }));
      expect(await screen.findByText(line)).toBeInTheDocument();
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
      expect(screen.getByText(usageEventsHelp('Cowork'))).toBeInTheDocument();
      // It names the agent whose events stop, and MindsDB, which receives them.
      expect(usageEventsHelp('Cowork')).toBe("Cowork sends MindsDB anonymous usage events, with an installation id, the browser's included, never page text or addresses. Off stops them from the next time you restart the app.");
      fireEvent.click(toggle);
      await waitFor(() => expect(shell.setUsageEvents).toHaveBeenCalledWith(false));
      expect(toggle).not.toBeChecked();
    });

    it.each([
      ['the organization turned the browser off', true, () => fetchBrowseStatus.mockResolvedValue({ enabled: true, available: false, status: 'organization_off' })],
      ['the browser is not registered', true, () => fetchBrowseStatus.mockResolvedValue({ enabled: true, available: false, status: 'unavailable' })],
      ['the status call fails', true, () => fetchBrowseStatus.mockRejectedValue(new Error('offline'))],
      ['the shell runs no browser', false, () => fetchBrowseStatus.mockResolvedValue({ enabled: true, available: false, status: 'unavailable' })],
    ])('keeps the usage-events switch when %s', async (_case, inApp, answer) => {
      shell.inApp = inApp;
      answer();
      renderSection();
      expect(await screen.findByRole('switch', { name: 'Send anonymous usage events' })).toBeChecked();
      expect(screen.getByRole('heading', { level: 2, name: 'Usage events' })).toBeInTheDocument();
    });

    it('puts the usage-events switch back when the app could not save it', async () => {
      shell.setUsageEvents = vi.fn(async () => false);
      renderSection();
      const toggle = await screen.findByRole('switch', { name: 'Send anonymous usage events' });
      fireEvent.click(toggle);
      await waitFor(() => expect(shell.setUsageEvents).toHaveBeenCalledWith(false));
      await waitFor(() => expect(toggle).toBeChecked());
    });

    it('offers no browser while the server says the browser is not registered', async () => {
      fetchBrowseStatus.mockResolvedValue({ enabled: true, available: false, status: 'unavailable' });
      renderSection();
      await screen.findByRole('switch', { name: 'Send anonymous usage events' });
      expect(screen.queryByRole('heading', { level: 2, name: 'Shared browser' })).not.toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: 'Shared browser' })).not.toBeInTheDocument();
    });
  });

  describe('without a decisions model to pick its steps', () => {
    const NO_DECISIONS = { ...AVAILABLE, enabled: false, decisions_model: null, can_set_decisions_model: false };
    const ADMIN = { ...NO_DECISIONS, can_set_decisions_model: true };

    // Settings as the form holds them: what setSetting writes reads back.
    function Form({ initial, onSet }) {
      const [settings, setSettings] = useState(initial);
      const setSetting = (key, value) => {
        onSet(key, value);
        setSettings((prev) => ({ ...prev, [key]: value }));
      };
      return <BrowserSettingsSection settings={settings} setSetting={setSetting} agentLabel="Cowork" />;
    }

    beforeEach(() => {
      testDecisionModel.mockReset();
    });

    it("tells a member to ask their admin, and its switch can't turn on", async () => {
      fetchBrowseStatus.mockResolvedValue(NO_DECISIONS);
      renderSection({ browserEnabled: false });
      expect(await screen.findByText('Ask your admin to set up a decision model to use the browser.')).toBeInTheDocument();
      const browserSwitch = screen.getByRole('switch', { name: 'Shared browser' });
      expect(browserSwitch).not.toBeChecked();
      expect(browserSwitch).toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByLabelText('Decision model endpoint')).not.toBeInTheDocument();
    });

    it('reads as off when the switch was saved on and the model was removed, and says why', async () => {
      fetchBrowseStatus.mockResolvedValue(NO_DECISIONS);
      renderSection({ browserEnabled: true });
      expect(await screen.findByText(/^Off: there's no decision model anymore\. Ask your admin/)).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Shared browser' })).not.toBeChecked();
      expect(screen.queryByRole('switch', { name: 'Approve browser steps' })).not.toBeInTheDocument();
    });

    it('lets an admin turn it on only once the decision model they enter answers a test', async () => {
      fetchBrowseStatus.mockResolvedValue(ADMIN);
      const onSet = vi.fn();
      render(<Form initial={{ browserEnabled: false, decisionModelUrl: '', decisionModelApiKey: '' }} onSet={onSet} />);
      const browserSwitch = await screen.findByRole('switch', { name: 'Shared browser' });
      expect(browserSwitch).not.toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(browserSwitch);
      // The fields open; the switch stays off.
      expect(onSet).not.toHaveBeenCalledWith('browserEnabled', true);
      expect(browserSwitch).not.toBeChecked();
      const test = screen.getByRole('button', { name: 'Test and turn on' });
      expect(test).toBeDisabled();
      await userEvent.type(screen.getByLabelText('Decision model endpoint'), 'https://decide.example.test/v1/systemone');
      await userEvent.type(screen.getByLabelText('API key'), 'own-key');

      testDecisionModel.mockResolvedValueOnce({ ok: false, error: 'http_401', ms: 3 });
      await userEvent.click(test);
      expect(await screen.findByText(/didn't answer as expected \(http_401\)/)).toBeInTheDocument();
      expect(onSet).not.toHaveBeenCalledWith('browserEnabled', true);

      testDecisionModel.mockResolvedValueOnce({ ok: true, error: null, ms: 3 });
      await userEvent.click(test);
      await waitFor(() => expect(onSet).toHaveBeenCalledWith('browserEnabled', true));
      expect(testDecisionModel).toHaveBeenLastCalledWith({ url: 'https://decide.example.test/v1/systemone', apiKey: 'own-key', model: '' });
      expect(screen.getByRole('switch', { name: 'Shared browser' })).toBeChecked();
      expect(screen.queryByLabelText('Decision model endpoint')).not.toBeInTheDocument();
      // The fields save with the form, as the rest of the page does.
      expect(onSet).toHaveBeenCalledWith('decisionModelUrl', 'https://decide.example.test/v1/systemone');
    });

    it('tests a saved key without showing it', async () => {
      fetchBrowseStatus.mockResolvedValue(ADMIN);
      testDecisionModel.mockResolvedValue({ ok: true, error: null });
      render(<Form initial={{ browserEnabled: true, decisionModelUrl: 'https://decide.example.test/d', decisionModelApiKey: '***', decisionModel: 'jev-own' }} onSet={vi.fn()} />);
      const key = await screen.findByLabelText('API key');
      expect(key).toHaveValue('');
      expect(key).toHaveAttribute('placeholder', 'Saved. Type to replace it.');
      await userEvent.click(screen.getByRole('button', { name: 'Test and turn on' }));
      expect(testDecisionModel).toHaveBeenCalledWith({ url: 'https://decide.example.test/d', apiKey: '***', model: 'jev-own' });
    });

    it('shows the browser as before with a decisions model, and on a server that predates the field', async () => {
      for (const status of [{ ...AVAILABLE, decisions_model: 'own' }, AVAILABLE]) {
        fetchBrowseStatus.mockResolvedValue(status);
        const { unmount } = renderSection({ browserEnabled: true });
        expect(await screen.findByRole('switch', { name: 'Approve browser steps' })).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Shared browser' })).toBeChecked();
        unmount();
      }
    });
  });

  it('shows no browser on the web where MindsHub is not the LLM provider', async () => {
    fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    const { container } = renderSection({ browserEnabled: true, planningProvider: 'anthropic' });
    await settled();
    expect(container).toBeEmptyDOMElement();
  });
});
