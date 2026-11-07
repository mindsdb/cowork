import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SAVED_TABS_PER_PROJECT } from '../shared/browser-contract';
import { BROWSER_STORE_FILE, BrowserStore } from './browser-store';

/* Fails reads of one file only. A write after the failed read would still
   succeed, so the test sees that none happened. */
const failRead = vi.hoisted(() => ({ file: '' }));
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  const readFileSync = ((target: fs.PathOrFileDescriptor, options?: unknown) => {
    if (target === failRead.file) throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' });
    return actual.readFileSync(target, options as BufferEncoding);
  }) as typeof actual.readFileSync;
  return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});

let dir: string;
let clock: number;
const store = () => new BrowserStore(path.join(dir, BROWSER_STORE_FILE), () => new Date(clock));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-store-'));
  clock = Date.UTC(2026, 10, 5, 18);
});

afterEach(() => {
  failRead.file = '';
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('BrowserStore', () => {
  it('reads empty when the file is missing', () => {
    expect(store().savedTabs('p-1')).toEqual([]);
    expect(store().sites()).toEqual([]);
  });

  it('saves tabs per project, newest first, replacing by name', () => {
    store().saveTab('p-1', { name: 'Report', url: 'https://a.test/', notes: '' });
    clock += 1000;
    store().saveTab('p-1', { name: 'Docs', url: 'https://b.test/', notes: 'n' });
    clock += 1000;
    store().saveTab('p-1', { name: 'Report', url: 'https://a.test/v2', notes: '' });
    store().saveTab('p-2', { name: 'Other', url: 'https://c.test/', notes: '' });
    expect(store().savedTabs('p-1').map((t) => [t.name, t.url])).toEqual([['Report', 'https://a.test/v2'], ['Docs', 'https://b.test/']]);
    expect(store().savedTabs('p-1')[0]).toEqual({ name: 'Report', url: 'https://a.test/v2', notes: '', saved_at: '2026-11-05T18:00:02.000Z' });
    store().deleteSavedTab('p-1', 'Report');
    expect(store().savedTabs('p-1').map((t) => t.name)).toEqual(['Docs']);
    expect(store().savedTabs('p-2')).toHaveLength(1);
  });

  it('keeps at most 100 saved tabs per project, refusing a new name past them but replacing a kept one', () => {
    const s = store();
    for (let i = 0; i < MAX_SAVED_TABS_PER_PROJECT; i += 1) s.saveTab('p', { name: `tab ${i}`, url: 'https://a.test/', notes: '' });
    expect(() => s.saveTab('p', { name: 'one more', url: 'https://a.test/', notes: '' })).toThrow(expect.objectContaining({ code: 'too_many_saved_tabs' }));
    expect(s.savedTabs('p')).toHaveLength(MAX_SAVED_TABS_PER_PROJECT);
    expect(s.saveTab('p', { name: 'tab 7', url: 'https://b.test/', notes: '' }).url).toBe('https://b.test/');
    expect(s.saveTab('other', { name: 'one more', url: 'https://a.test/', notes: '' }).name).toBe('one more');
    expect(MAX_SAVED_TABS_PER_PROJECT).toBe(100);
  });

  it('writes the file owner-only', () => {
    store().noteSite('github.com', 'ada');
    expect(fs.statSync(path.join(dir, BROWSER_STORE_FILE)).mode & 0o777).toBe(0o600);
  });

  it('notes sites and forgets them on sign-out, keeping saved tabs', () => {
    store().saveTab('p-1', { name: 'Report', url: 'https://a.test/', notes: '' });
    store().noteSite('github.com', 'ada');
    expect(store().sites()).toEqual([{ site: 'github.com', account_hint: 'ada', noted_at: '2026-11-05T18:00:00.000Z' }]);
    store().forgetSites();
    expect(store().sites()).toEqual([]);
    expect(store().savedTabs('p-1')).toHaveLength(1);
  });

  it('raises on a file it cannot read and leaves it as it was', () => {
    store().saveTab('p-1', { name: 'Report', url: 'https://a.test/', notes: '' });
    const file = path.join(dir, BROWSER_STORE_FILE);
    const before = fs.readFileSync(file, 'utf-8');
    failRead.file = file;
    expect(() => store().saveTab('p-1', { name: 'New', url: 'https://n.test/', notes: '' })).toThrow(/too many open files/);
    expect(() => store().noteSite('github.com', '')).toThrow(/too many open files/);
    failRead.file = '';
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
  });

  it.each(['__proto__', 'constructor', 'toString'])('keeps a project named %s like any other', (project) => {
    expect(store().savedTabs(project)).toEqual([]);
    store().saveTab(project, { name: 'Report', url: 'https://a.test/', notes: '' });
    expect(store().savedTabs(project).map((t) => t.name)).toEqual(['Report']);
    expect(store().savedTabs('p-1')).toEqual([]);
    store().deleteSavedTab(project, 'Report');
    expect(store().savedTabs(project)).toEqual([]);
    // Deleting from a project that keeps nothing changes nothing.
    store().deleteSavedTab(project, 'Report');
    expect(store().savedTabs(project)).toEqual([]);
  });

  it('raises on a file that is not its shape', () => {
    fs.writeFileSync(path.join(dir, BROWSER_STORE_FILE), JSON.stringify({ version: 1, saved_tabs: { p: [{ name: 1 }] }, sites: {} }));
    expect(() => store().savedTabs('p')).toThrow(/malformed saved tab/);
    fs.writeFileSync(path.join(dir, BROWSER_STORE_FILE), '{not json');
    expect(() => store().sites()).toThrow();
  });
});
