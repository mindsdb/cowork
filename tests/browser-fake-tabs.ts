/*
 * A fake tab factory for the in-app browser's main-process tests: tabs that
 * answer like a page without Electron.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { vi } from 'vitest';
import type { PageSnapshot, StepRequest } from '../src/shared/browser-contract';
import { BrowserSessions, type TabFactory, type TabHooks, type TabView } from '../src/main/browser-sessions';
import { BrowserStore } from '../src/main/browser-store';

export const FAKE_PAGE: PageSnapshot = {
  url: 'https://shop.example.test/signin',
  title: 'Sign in',
  scroll: { y: 0, height: 1800, viewport: 800 },
  elements: [
    { id: 1, role: 'searchbox', name: 'Search' },
    { id: 3, role: 'textbox', name: 'Password', type: 'password', value_hidden: true },
  ],
  text: 'Sign in to Example Shop.',
  truncated: false,
  challenges: [],
};

export interface FakeTab extends TabView {
  hooks: TabHooks;
  actions: StepRequest[];
}

export function fakeFactory(): TabFactory & { tabs: FakeTab[] } {
  const tabs: FakeTab[] = [];
  return {
    tabs,
    create: (hooks: TabHooks, url: string | null): TabView => {
      let current = url ?? 'about:blank';
      const tab: FakeTab = {
        hooks,
        actions: [],
        url: () => current,
        title: () => 'Sign in',
        loading: () => false,
        canGoBack: () => false,
        canGoForward: () => false,
        read: vi.fn(async () => ({ ...FAKE_PAGE, url: current })),
        act: vi.fn(async (request: StepRequest) => {
          tab.actions.push(request);
        }),
        screenshot: vi.fn(async () => ({ jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), width: 1024, height: 640 })),
        load: vi.fn(async (next: string) => {
          current = next;
        }),
        back: vi.fn(async () => {}),
        forward: vi.fn(async () => {}),
        reload: vi.fn(async () => {}),
        show: vi.fn(),
        park: vi.fn(),
        abortInput: vi.fn(),
        watchSecrets: vi.fn(),
        close: vi.fn(),
      };
      tabs.push(tab);
      return tab;
    },
  };
}

export function fakeHost() {
  const factory = fakeFactory();
  const sessions = new BrowserSessions({
    factory,
    emit: () => {},
    cookies: async (site) => ({ present: site === 'github.com', expiresAt: null }),
  });
  sessions.setAvailable(true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-host-'));
  const store = BrowserStore.forAccountRoot(dir);
  return { factory, sessions, store, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
