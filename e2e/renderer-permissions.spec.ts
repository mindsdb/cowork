import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('keeps clipboard writes available and confines microphone/notifications to the app', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-permissions-'));
  const { ELECTRON_RUN_AS_NODE: _drop, ...env } = process.env;
  const app = await electron.launch({
    args: [path.resolve('e2e/helpers/renderer-permissions-app.cjs')],
    env: { ...env, PERMISSION_TEST_PROFILE: profile },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState();
    expect(await page.evaluate(async () => ({
      clipboard: (await navigator.permissions.query({ name: 'clipboard-write' as PermissionName })).state,
      microphone: (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state,
      notifications: await Notification.requestPermission(),
    }))).toEqual({ clipboard: 'granted', microphone: 'granted', notifications: 'granted' });

    const frame = page.frame({ url: /renderer-permissions-frame\.html$/ });
    expect(frame).not.toBeNull();
    expect(await frame!.evaluate(async () => ({
      notifications: await Notification.requestPermission(),
      microphone: await navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => { stream.getTracks().forEach(track => track.stop()); return 'unexpectedly allowed'; })
        .catch(error => error.name),
    }))).toEqual({ notifications: 'denied', microphone: 'NotAllowedError' });

    // Another top-level WebContents in the same session is not the app either.
    const otherWindow = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => {
      const original = BrowserWindow.getAllWindows()[0];
      const other = new BrowserWindow({ webPreferences: { sandbox: true, contextIsolation: true } });
      await other.loadURL(original.webContents.getURL());
    });
    const other = await otherWindow;
    await other.waitForLoadState();
    expect(await other.evaluate(async () => ({
      notifications: await Notification.requestPermission(),
      microphone: (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state,
    }))).toEqual({ notifications: 'denied', microphone: 'denied' });
  } finally {
    await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
