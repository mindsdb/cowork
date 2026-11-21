import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WINDOW_PROOF_HEADER } from '../shared/server-launch';

/* A dotenv that still holds a token an earlier server wrote. Nothing in
   server-auth may read it. */
const readEnvFile = vi.hoisted(() => vi.fn(() => ({ COWORK_AUTH_TOKEN: 'ab'.repeat(32) })));
vi.mock('./cowork-home', () => ({ readEnvFile, readEnvFileAt: readEnvFile }));

import {
  authHeader,
  clearServerCredentials,
  envForRenderer,
  getServerAuthToken,
  getWindowProof,
  newServerCredentials,
} from './server-auth';

afterEach(() => {
  clearServerCredentials();
});

describe('the server credentials', () => {
  it('are none before a launch, even with a token in the dotenv', () => {
    expect(getServerAuthToken()).toBeNull();
    expect(getWindowProof()).toBeNull();
    expect(authHeader()).toEqual({});
    expect(readEnvFile).not.toHaveBeenCalled();
  });

  it("are the launch's own, from memory and never from the dotenv", () => {
    const launch = newServerCredentials();

    expect(getServerAuthToken()).toBe(launch.authToken);
    expect(getWindowProof()).toBe(launch.windowProof);
    expect(getServerAuthToken()).not.toBe('ab'.repeat(32));
    expect(readEnvFile).not.toHaveBeenCalled();
  });

  it('are two different 32-byte hex values, fresh for every launch', () => {
    const first = newServerCredentials();
    const second = newServerCredentials();

    for (const value of [first.authToken, first.windowProof, second.authToken, second.windowProof]) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(first.authToken).not.toBe(first.windowProof);
    expect(second.authToken).not.toBe(first.authToken);
    expect(second.windowProof).not.toBe(first.windowProof);
    expect(getServerAuthToken()).toBe(second.authToken);
  });

  it("give desktop main's own requests the bearer token and the window proof", () => {
    const launch = newServerCredentials();

    expect(authHeader()).toEqual({ Authorization: `Bearer ${launch.authToken}`, [WINDOW_PROOF_HEADER]: launch.windowProof });
  });

  it('are gone once cleared', () => {
    newServerCredentials();
    clearServerCredentials();

    expect(getServerAuthToken()).toBeNull();
    expect(getWindowProof()).toBeNull();
    expect(authHeader()).toEqual({});
  });
});

describe('the dotenv the renderer reads', () => {
  it.each([
    ['COWORK_AUTH_TOKEN'],
    ['export COWORK_AUTH_TOKEN'],
    ['COWORK_AUTH_TOKEN '],
    ['cowork_auth_token'],
  ])('leaves out a %j line', (key) => {
    const vars = { ANTON_TERMS_CONSENT: 'true', [key]: 'ab'.repeat(32), COWORK_KEYCHAIN: 'true' };

    expect(envForRenderer(vars)).toEqual({ ANTON_TERMS_CONSENT: 'true', COWORK_KEYCHAIN: 'true' });
  });

  it('keeps every other line, including ones whose names only contain the token name', () => {
    const vars = { COWORK_AUTH_TOKEN_NOTE: 'x', MY_COWORK_AUTH_TOKEN: 'y', ANTON_MINDS_URL: 'https://example.test' };

    expect(envForRenderer(vars)).toEqual(vars);
  });

  it('is what settings:read returns', () => {
    const app = readFileSync(resolve(__dirname, 'app.ts'), 'utf-8');
    const start = app.indexOf('ipcMain.handle(IPC.SETTINGS_READ');
    const handler = start < 0 ? '' : app.slice(start, app.indexOf('});', start));

    expect(handler).toContain('return envForRenderer(readEnvFile());');
  });
});

describe('the renderer never gets the server credentials', () => {
  it('cannot reach them through the preload bridge', () => {
    const preload = readFileSync(resolve(__dirname, 'preload.ts'), 'utf-8');

    for (const name of ['server-auth', 'getServerAuthToken', 'getWindowProof', 'authHeader']) {
      expect(preload).not.toContain(name);
    }
  });
});
