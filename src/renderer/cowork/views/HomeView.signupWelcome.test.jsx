// A new account lands on Home from a sign-up link (ENG-4288). One that started
// in the desktop app is told it can start here or go back to the app; one that
// started on the web just lands, composer ready.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeView from './HomeView';
import { captureSignupWelcome } from '../lib/signupWelcome';
import { __resetDraftsForTests } from '../lib/draftStore';
import { reset as resetOnboarding } from '../components/onboarding/onboardingStore';

const { trackSignupLanded } = vi.hoisted(() => ({ trackSignupLanded: vi.fn() }));
vi.mock('../lib/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  trackSignupLanded,
}));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchSkills: vi.fn(async () => []) };
});

const NOTICE = 'Your account is ready. You can start right here, or go back to the Cowork app and sign in.';

function Home() {
  return (
    <HomeView
      onSend={vi.fn(async () => true)}
      activeTasks={[]}
      onSelectTask={vi.fn()}
      onClearActive={vi.fn()}
      project={{ name: 'general' }}
      projects={[{ name: 'general' }]}
      models={[]}
      onProjectChange={vi.fn()}
      onModelChange={vi.fn()}
      configReady
      serverOnline
      skipIntro
      onPrefill={vi.fn()}
    />
  );
}

const land = (search) => {
  window.history.replaceState(null, '', `/${search}`);
  captureSignupWelcome();
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  __resetDraftsForTests();
  trackSignupLanded.mockClear();
  resetOnboarding();
});

describe('HomeView sign-up landing', () => {
  it('greets a desktop sign-up with a one-line notice, and strips the params', async () => {
    land('?welcome=1&from=desktop');
    expect(window.location.search).toBe('');
    render(<Home />);

    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(trackSignupLanded).toHaveBeenCalledWith('desktop');
  });

  it('shows no notice for a web sign-up, but still counts the landing', async () => {
    land('?welcome=1');
    render(<Home />);

    await waitFor(() => expect(trackSignupLanded).toHaveBeenCalledWith('web'));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it('can be dismissed', async () => {
    land('?welcome=1&from=desktop');
    render(<Home />);

    await screen.findByText(NOTICE);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it('greets and counts once: a reload, or Home opened again, shows nothing', async () => {
    land('?welcome=1&from=desktop');
    const first = render(<StrictMode><Home /></StrictMode>);
    await screen.findByText(NOTICE);
    first.unmount();

    render(<Home />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(trackSignupLanded).toHaveBeenCalledTimes(1);
  });

  it('shows nothing and counts nothing on an ordinary visit', async () => {
    render(<Home />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(trackSignupLanded).not.toHaveBeenCalled();
  });
});
