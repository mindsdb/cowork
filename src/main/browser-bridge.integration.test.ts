import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CdpSocket } from './cdp-client';
import * as bridge from './browser-bridge';
import { IPC } from '../shared/ipc-channels';
import type { BridgeStatePayload } from '../shared/browser-bridge-types';

// End-to-end (mocked CDP) attach → approve → inspect → navigate → scroll →
// tab-close → lost → re-attach, asserting the ORDER of state events and the
// result shapes (plan AC1–AC7).

class FakeCdpSocket implements CdpSocket {
  static instances: FakeCdpSocket[] = [];
  private handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  page = {
    url: 'https://shop.example.com/report',
    title: 'July Report',
    text: 'Total revenue 4,218,540',
    headings: ['July 2026 Revenue Report'],
    links: [{ text: 'Details', href: 'https://shop.example.com/report/details' }],
    viewport: { scrollX: 0, scrollY: 0, scrollHeight: 3000, innerHeight: 900 },
  };
  constructor() {
    FakeCdpSocket.instances.push(this);
  }
  send(data: string): void {
    const frame = JSON.parse(data);
    queueMicrotask(() => {
      const result =
        frame.method === 'Runtime.evaluate' ? { result: { value: this.page } } : {};
      this.fire('message', JSON.stringify({ id: frame.id, result }));
    });
  }
  close(): void {
    this.fire('close');
  }
  on(event: string, cb: (arg?: unknown) => void): void {
    (this.handlers[event] ||= []).push(cb);
  }
  fire(event: string, arg?: unknown): void {
    for (const cb of this.handlers[event] || []) cb(arg);
  }
  emitEvent(method: string, params: unknown): void {
    this.fire('message', JSON.stringify({ method, params }));
  }
}

const TARGET = {
  id: 'REPORT-TAB',
  type: 'page',
  title: 'July Report',
  url: 'https://shop.example.com/report',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/REPORT-TAB',
};

// Capture browser:state pushes by faking a BrowserWindow.
const stateEvents: BridgeStatePayload[] = [];
const fakeWindow = {
  webContents: {
    send: (channel: string, payload: BridgeStatePayload) => {
      if (channel === IPC.BROWSER_STATE) stateEvents.push(payload);
    },
  },
} as unknown as Electron.BrowserWindow;

let restore: () => void;

beforeEach(() => {
  process.env.COWORK_BUILD_KIND = 'dev';
  stateEvents.length = 0;
  FakeCdpSocket.instances = [];
  restore = bridge.__setBridgeDeps({
    listTargets: async () => [TARGET],
    wsFactory: () => {
      const s = new FakeCdpSocket();
      queueMicrotask(() => s.fire('open'));
      return s;
    },
  });
  // Wire the window sink so emitState pushes reach us (avoids the electron
  // ipcMain require in the node test env).
  bridge.__setWindowForTest(() => fakeWindow);
});

afterEach(() => {
  bridge.__resetBridgeForTest();
  restore();
});

describe('browser-bridge integration (mocked CDP)', () => {
  it('runs the full attach→approve→inspect→navigate→scroll→lost→re-attach flow', async () => {
    // attach → awaiting-approval
    await bridge.attach('REPORT-TAB');
    // approve → connected
    await bridge.approve();

    const inspectRes = await bridge.inspect();
    expect(inspectRes.status).toBe('ok');
    expect(inspectRes.observed?.headings).toContain('July 2026 Revenue Report');

    const navRes = await bridge.navigateApprovedLink('https://shop.example.com/report/details');
    expect(navRes.status).toBe('ok');

    const scrollRes = await bridge.scroll('down');
    expect(scrollRes.status).toBe('ok');

    // tab closed → lost
    FakeCdpSocket.instances[0].emitEvent('Target.targetDestroyed', { targetId: 'REPORT-TAB' });
    expect(bridge.currentState()).toBe('lost');

    // re-attach → awaiting → connected again
    await bridge.attach('REPORT-TAB');
    await bridge.approve();
    expect(bridge.currentState()).toBe('connected');

    // Assert the ORDER of pushed state transitions.
    const order = stateEvents.map((e) => e.state);
    expect(order).toEqual([
      'awaiting-approval',
      'connected',
      'lost',
      'awaiting-approval',
      'connected',
    ]);
  });
});
