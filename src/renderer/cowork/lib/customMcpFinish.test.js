import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';

const customMcpFinish = vi.hoisted(() => vi.fn());
vi.mock('../../platform/host', () => ({ host: { customMcpFinish } }));

import {
  CUSTOM_MCP_FINISH_PATH,
  captureCustomMcpCompletion,
  isCustomMcpFinishPage,
  takeCustomMcpCompletion,
} from './customMcpFinish';
import CustomMcpFinishPage, { resetCustomMcpFinishForTests } from '../components/connector/CustomMcpFinishPage';

const ID = 'A'.repeat(21) + '_-' + 'b'.repeat(20);
const loc = (hash, pathname = CUSTOM_MCP_FINISH_PATH, search = '') => ({ pathname, search, hash });

beforeEach(() => {
  sessionStorage.clear();
  resetCustomMcpFinishForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  customMcpFinish.mockReset();
});

describe('captureCustomMcpCompletion', () => {
  it('stashes the id and strips the fragment from the address', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    captureCustomMcpCompletion(loc(`#${ID}`));

    expect(replace).toHaveBeenCalledWith(window.history.state, '', CUSTOM_MCP_FINISH_PATH);
    expect(takeCustomMcpCompletion()).toBe(ID);
  });

  it.each([
    ['a Keycloak return', '#state=st-1&session_state=s&code=code-1'],
    ['a Keycloak error', '#error=login_required&state=st-1'],
    ['an id followed by more', `#${ID}&state=st-1&code=code-1`],
    ['too short an id', `#${ID.slice(1)}`],
  ])('leaves %s in the address and stashes nothing', (_name, hash) => {
    const replace = vi.spyOn(window.history, 'replaceState');
    captureCustomMcpCompletion(loc(hash));

    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('takes the id on the finish path with a trailing slash', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    captureCustomMcpCompletion(loc(`#${ID}`, `${CUSTOM_MCP_FINISH_PATH}/`));

    expect(replace).toHaveBeenCalledWith(window.history.state, '', `${CUSTOM_MCP_FINISH_PATH}/`);
    expect(takeCustomMcpCompletion()).toBe(ID);
    expect(isCustomMcpFinishPage(loc('', `${CUSTOM_MCP_FINISH_PATH}/`))).toBe(true);
  });

  it('leaves every other page alone', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    captureCustomMcpCompletion(loc(`#${ID}`, '/c/abc'));

    expect(replace).not.toHaveBeenCalled();
    expect(takeCustomMcpCompletion()).toBeNull();
    expect(isCustomMcpFinishPage(loc('', '/c/abc'))).toBe(false);
    expect(isCustomMcpFinishPage(loc(''))).toBe(true);
  });
});

describe('takeCustomMcpCompletion', () => {
  it('gives the id once', () => {
    captureCustomMcpCompletion(loc(`#${ID}`));
    expect(takeCustomMcpCompletion()).toBe(ID);
    expect(takeCustomMcpCompletion()).toBeNull();
  });

  it('drops an id kept longer than five minutes', () => {
    const at = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(at);
    captureCustomMcpCompletion(loc(`#${ID}`));

    expect(takeCustomMcpCompletion(sessionStorage, at + 5 * 60 * 1000 + 1)).toBeNull();
  });

  it('keeps an id for five minutes', () => {
    const at = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(at);
    captureCustomMcpCompletion(loc(`#${ID}`));

    expect(takeCustomMcpCompletion(sessionStorage, at + 5 * 60 * 1000)).toBe(ID);
  });
});

describe('CustomMcpFinishPage', () => {
  it('finishes the sign-in once and closes the pop-up', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    customMcpFinish.mockResolvedValue({ ok: true, name: 'cm-1' });
    captureCustomMcpCompletion(loc(`#${ID}`));

    render(createElement(CustomMcpFinishPage));

    expect(await screen.findByText('Signed in. You can close this window.')).toBeTruthy();
    expect(customMcpFinish).toHaveBeenCalledTimes(1);
    expect(customMcpFinish).toHaveBeenCalledWith(ID);
    expect(close).toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it.each([
    ['login_not_yours', "This sign-in link was started by someone else, so it wasn't used. Only finish sign-ins you started yourself."],
    ['wrong_organization', 'This sign-in was started in another organization. Switch back to the organization you added the server in, then add it again.'],
    ['expired', 'This sign-in has expired or was already used. Add the server again.'],
  ])('shows its own message for %s and stays open', async (code, message) => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    customMcpFinish.mockResolvedValue({ ok: false, code, reason: 'x' });
    captureCustomMcpCompletion(loc(`#${ID}`));

    render(createElement(CustomMcpFinishPage));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it('says the sign-in expired when no id was kept, and posts nothing', async () => {
    render(createElement(CustomMcpFinishPage));

    expect(await screen.findByText('This sign-in has expired or was already used. Add the server again.')).toBeTruthy();
    expect(customMcpFinish).not.toHaveBeenCalled();
  });
});
