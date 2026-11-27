import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';

const finishConnectorOAuth = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ finishConnectorOAuth }));

import { OAUTH_FINISH_PATH, captureOAuthCompletion, isOAuthFinishPage, takeOAuthCompletion } from './oauthFinish';
import { CUSTOM_MCP_FINISH_PATH, takeCustomMcpCompletion } from './customMcpFinish';
import OAuthFinishPage, { resetOAuthFinishForTests } from '../components/connector/OAuthFinishPage';

const ID = 'A'.repeat(21) + '_-' + 'b'.repeat(20);
const loc = (hash, pathname = OAUTH_FINISH_PATH, search = '') => ({ pathname, search, hash });
const refused = (code, message = 'x') => Object.assign(new Error(message), { status: 403, code });

beforeEach(() => {
  sessionStorage.clear();
  resetOAuthFinishForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  finishConnectorOAuth.mockReset();
});

describe('captureOAuthCompletion', () => {
  it('stashes the id and strips the fragment from the address', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    captureOAuthCompletion(loc(`#${ID}`));

    expect(replace).toHaveBeenCalledWith(window.history.state, '', OAUTH_FINISH_PATH);
    expect(takeOAuthCompletion()).toBe(ID);
    expect(takeOAuthCompletion()).toBeNull();
  });

  it('is its own page: a custom MCP finish page neither shows it nor takes its id', () => {
    captureOAuthCompletion(loc(`#${ID}`, CUSTOM_MCP_FINISH_PATH));

    expect(isOAuthFinishPage(loc('', CUSTOM_MCP_FINISH_PATH))).toBe(false);
    expect(takeOAuthCompletion()).toBeNull();

    captureOAuthCompletion(loc(`#${ID}`));
    expect(takeCustomMcpCompletion()).toBeNull();
  });

  it('leaves a Keycloak return in the address', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    captureOAuthCompletion(loc('#state=st-1&session_state=s&code=code-1'));

    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
});

describe('OAuthFinishPage', () => {
  it('finishes the sign-in once and closes the pop-up', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    finishConnectorOAuth.mockResolvedValue({ status: 'success', service: 'linear', name: 'a-example-com' });
    captureOAuthCompletion(loc(`#${ID}`));

    render(createElement(OAuthFinishPage));

    expect(await screen.findByText('Connected. You can close this window.')).toBeTruthy();
    expect(finishConnectorOAuth).toHaveBeenCalledTimes(1);
    expect(finishConnectorOAuth).toHaveBeenCalledWith(ID);
    expect(close).toHaveBeenCalled();
  });

  it.each([
    ['login_not_yours', 'This sign-in link was started by someone else, so nothing was connected. Only use sign-in links you started yourself in Cowork.'],
    ['wrong_organization', 'This sign-in was started in another organization. Switch to it in Cowork and connect again.'],
    ['expired', 'This sign-in link has expired or was already used. Connect again from Cowork.'],
    ['failed', "Notion's admin must approve the app."],
    ['', "Couldn't finish the sign-in. Connect again from Cowork."],
  ])('shows its own message for "%s" and stays open', async (code, message) => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    finishConnectorOAuth.mockRejectedValue(refused(code, "Notion's admin must approve the app."));
    captureOAuthCompletion(loc(`#${ID}`));

    render(createElement(OAuthFinishPage));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it('says the link expired when no id was kept, and posts nothing', async () => {
    render(createElement(OAuthFinishPage));

    expect(await screen.findByText('This sign-in link has expired or was already used. Connect again from Cowork.')).toBeTruthy();
    expect(finishConnectorOAuth).not.toHaveBeenCalled();
  });
});
