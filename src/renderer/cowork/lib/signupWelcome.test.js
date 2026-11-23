// A sign-up link lands a new account in Cowork web with ?welcome=1, plus
// &from=desktop when it started in the desktop app (ENG-4288).
import { describe, it, expect, beforeEach } from 'vitest';
import { captureSignupWelcome, takeSignupWelcome } from './signupWelcome';
import { captureConsoleHandoff, takeConsoleHandoff } from './consoleHandoff';

const land = (search) => {
  window.history.replaceState(null, '', `/${search}`);
  captureSignupWelcome();
};

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('signup welcome', () => {
  it('reads a desktop sign-up', () => {
    land('?welcome=1&from=desktop');
    expect(takeSignupWelcome()).toEqual({ from: 'desktop' });
  });

  it('reads a web sign-up, which carries no from', () => {
    land('?welcome=1');
    expect(takeSignupWelcome()).toEqual({ from: 'web' });
  });

  it('strips its params so a reload does not greet again, and keeps any others', () => {
    land('?welcome=1&from=desktop&ci=1');
    expect(window.location.search).toBe('?ci=1');
    land('?welcome=1');
    expect(window.location.search).toBe('');
  });

  it('applies once', () => {
    land('?welcome=1&from=desktop');
    expect(takeSignupWelcome()).not.toBeNull();
    expect(takeSignupWelcome()).toBeNull();
  });

  it('survives the login round trip: captured before the redirect, taken after it', () => {
    land('?welcome=1&from=desktop');
    // The Keycloak redirect comes back to the bare pathname.
    window.history.replaceState(null, '', '/');
    expect(takeSignupWelcome()).toEqual({ from: 'desktop' });
  });

  it('keeps nothing beyond the tab', () => {
    land('?welcome=1&from=desktop');
    expect(window.localStorage.length).toBe(0);
  });

  it('ignores a page without the welcome mark', () => {
    land('?from=desktop');
    expect(window.location.search).toBe('?from=desktop');
    expect(takeSignupWelcome()).toBeNull();
  });

  it('leaves a console link alone', () => {
    window.history.replaceState(null, '', '/?from=console');
    captureConsoleHandoff();
    captureSignupWelcome();
    expect(takeSignupWelcome()).toBeNull();
    expect(takeConsoleHandoff()).not.toBeNull();
  });

  it('expires a landing abandoned mid-login', () => {
    land('?welcome=1&from=desktop');
    expect(takeSignupWelcome(window.sessionStorage, Date.now() + 11 * 60 * 1000)).toBeNull();
  });
});
