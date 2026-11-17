/*
 * What the in-app browser keeps beside its profile: each project's saved tabs
 * and the sites the person signed in to. One JSON file per account,
 * <account data root>/browser-host.json, owner-only (0600).
 *
 * A missing file reads as empty. Any other failure to read it, a file that
 * isn't this shape included, raises: reading it as empty would let the next
 * save replace everything that couldn't be read.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { BridgeError, MAX_SAVED_TABS_PER_PROJECT, type SavedTab } from '../shared/browser-contract';

export const BROWSER_STORE_FILE = 'browser-host.json';

/** A site as recorded; cookies_present and cookies_expire_at are read live from the profile. */
export interface StoredSite {
  site: string;
  account_hint: string;
  noted_at: string;
}

interface StoreFile {
  version: 1;
  saved_tabs: Record<string, SavedTab[]>;
  sites: Record<string, StoredSite>;
}

/* A record keyed by a project or a site, with no prototype: a project named
   __proto__ or constructor is then an ordinary key, read and written like any
   other. */
function keyed<T>(entries: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, entries);
}

const empty = (): StoreFile => ({ version: 1, saved_tabs: keyed({}), sites: keyed({}) });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSavedTab(value: unknown): value is SavedTab {
  return isRecord(value)
    && typeof value.name === 'string' && typeof value.url === 'string'
    && typeof value.notes === 'string' && typeof value.saved_at === 'string';
}

function isStoredSite(value: unknown): value is StoredSite {
  return isRecord(value)
    && typeof value.site === 'string' && typeof value.account_hint === 'string' && typeof value.noted_at === 'string';
}

function parse(text: string): StoreFile {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.saved_tabs) || !isRecord(raw.sites)) {
    throw new Error('the browser store is not in the expected shape');
  }
  for (const tabs of Object.values(raw.saved_tabs)) {
    if (!Array.isArray(tabs) || !tabs.every(isSavedTab)) throw new Error('the browser store has a malformed saved tab');
  }
  if (!Object.values(raw.sites).every(isStoredSite)) throw new Error('the browser store has a malformed site');
  return {
    version: 1,
    saved_tabs: keyed(raw.saved_tabs as Record<string, SavedTab[]>),
    sites: keyed(raw.sites as Record<string, StoredSite>),
  };
}

export class BrowserStore {
  constructor(private readonly file: string, private readonly now: () => Date = () => new Date()) {}

  static forAccountRoot(root: string): BrowserStore {
    return new BrowserStore(path.join(root, BROWSER_STORE_FILE));
  }

  private read(): StoreFile {
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
      throw error;
    }
    return parse(text);
  }

  private write(data: StoreFile): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      fs.chmodSync(temp, 0o600);
      fs.renameSync(temp, this.file);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
  }

  /** The project's saved tabs, newest first. */
  savedTabs(project: string): SavedTab[] {
    return [...(this.read().saved_tabs[project] ?? [])];
  }

  /** Saves a tab; the same name in the same project replaces the old one. A
      new name in a project that already keeps the most is refused. */
  saveTab(project: string, entry: { name: string; url: string; notes: string }): SavedTab {
    const data = this.read();
    const tab: SavedTab = { name: entry.name, url: entry.url, notes: entry.notes, saved_at: this.now().toISOString() };
    const others = (data.saved_tabs[project] ?? []).filter((t) => t.name !== entry.name);
    if (others.length >= MAX_SAVED_TABS_PER_PROJECT) {
      throw new BridgeError('too_many_saved_tabs', `a project keeps at most ${MAX_SAVED_TABS_PER_PROJECT} saved tabs; delete one first`);
    }
    data.saved_tabs[project] = [tab, ...others];
    this.write(data);
    return tab;
  }

  deleteSavedTab(project: string, name: string): void {
    const data = this.read();
    const tabs = data.saved_tabs[project];
    if (!tabs) return;
    const rest = tabs.filter((t) => t.name !== name);
    if (rest.length) data.saved_tabs[project] = rest;
    else delete data.saved_tabs[project];
    this.write(data);
  }

  sites(): StoredSite[] {
    return Object.values(this.read().sites).sort((a, b) => b.noted_at.localeCompare(a.noted_at));
  }

  noteSite(site: string, accountHint: string): StoredSite {
    const data = this.read();
    const record = { site, account_hint: accountHint, noted_at: this.now().toISOString() };
    data.sites[site] = record;
    this.write(data);
    return record;
  }

  /** Forgets one site's record; its cookies stay. */
  forgetSite(site: string): void {
    const data = this.read();
    if (!(site in data.sites)) return;
    delete data.sites[site];
    this.write(data);
  }

  /** Sign out of all sites forgets the records too. Saved tabs stay. */
  forgetSites(): void {
    const data = this.read();
    data.sites = {};
    this.write(data);
  }
}
