// ENG-1533: home renders the same connect-a-provider card as chat, so its
// "Start for free" is the same route to billing under the same trigger. Two
// surfaces reaching one destination must not read as two different causes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostMock = vi.hoisted(() => ({
  host: {
    isElectron: true,
    isWeb: false,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    isLocalApiOrigin: () => false,
    openExternal: vi.fn(),
  },
  isElectron: true,
  isWeb: false,
}));
vi.mock('../../platform/host', () => hostMock);

const analyticsMock = vi.hoisted(() => ({ trackBillingOpened: vi.fn() }));
vi.mock('../lib/analytics', () => analyticsMock);

import HomeView from './HomeView';
import { ConnectProviderCard } from './ChatView';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';

// skipIntro bypasses the boot choreography so the interactive surface — and with
// it the blocked card — is mounted synchronously.
const renderHome = (props = {}) =>
  render(
    <HomeView
      greeting="Good morning"
      activeTasks={[]}
      skipIntro
      serverOnline
      configReady={false}
      {...props}
    />,
  );

beforeEach(() => {
  analyticsMock.trackBillingOpened.mockClear();
  hostMock.host.openExternal.mockClear();
});

describe('HomeView — connect-a-provider route to billing', () => {
  it('records trigger=connect_provider, the same value the chat card uses', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole('button', { name: 'Start for free' }));

    expect(analyticsMock.trackBillingOpened).toHaveBeenCalledWith('connect_provider');
    expect(hostMock.host.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
  });

  it('records nothing on render — the click is the event, not the card', () => {
    renderHome();
    expect(screen.getByRole('button', { name: 'Start for free' })).toBeInTheDocument();
    expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled();
  });

  it('shows no billing route at all once a provider is configured', () => {
    renderHome({ configReady: true });
    expect(screen.queryByRole('button', { name: 'Start for free' })).toBeNull();
    expect(analyticsMock.trackBillingOpened).not.toHaveBeenCalled();
  });
});

describe('HomeView: connect-a-provider copy', () => {
  it('opens with the same pitch as the chat card, and neither calls the allowance monthly', () => {
    /* One card reached two ways. Home adds the list of key providers after
       the first sentence; the pitch itself has to read the same on both. */
    const firstSentence = (text) => text.slice(0, text.indexOf('.') + 1);
    const { unmount } = renderHome();
    const home = screen.getByText(/^Start with MindsHub/).textContent;
    unmount();
    render(<ConnectProviderCard time="" />);
    const chat = screen.getByText(/^Start with MindsHub/).textContent;

    expect(firstSentence(home)).toBe(firstSentence(chat));
    expect(firstSentence(home)).toBe('Start with MindsHub and get a free allowance on MindsHub Air, then pay as you go.');
    expect(home).not.toMatch(/monthly/i);
    expect(chat).not.toMatch(/monthly/i);
  });
});
