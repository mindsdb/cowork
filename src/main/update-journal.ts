// Durable journal of UI and server update outcomes, drained by the renderer.
//
// An apply outcome happens in main, and the window reloads in the middle of
// it. A renderer-side capture would be lost with the old renderer, so main
// writes each outcome here first (next to `shell-update-target.json`, the
// shell's own relaunch evidence) and the next renderer to boot drains it over
// IPC, sends one PostHog `update_phase` event per entry, and acks the ids that
// landed. An entry that is not acked is handed out again after its lease
// expires, normally at the next launch. Events therefore arrive one launch
// late, which is the price of surviving the mid-apply reload.
//
// The journal is capped, so a build that never acks (no PostHog key, say)
// cannot grow it without bound.

import { app, ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IPC } from '../shared/ipc-channels';
import { buildKindStrict } from './cowork-home';
import type { UpdateJournalTrigger, UpdatePhaseEntry, UpdatePhaseRecord } from '../shared/update-journal-types';

export const UPDATE_JOURNAL_FILE = 'update-journal.json';
/** How long a drained entry stays out of the next drain. A renderer that
 *  reloads mid-drain gets the entry again only once this has passed, so a
 *  slow POST is not sent twice by two renderers in the same minute. */
export const UPDATE_JOURNAL_LEASE_MS = 60_000;
/** Oldest entries are dropped past this. */
export const UPDATE_JOURNAL_CAP = 200;

/** The outcome set. Kept small on purpose; see docs/update-behavior.md.
 *  - `applied`: the new version is live and passed its health check.
 *  - `rolled-back`: the apply ran, the health check failed, the previous
 *    version is back. On the `ui` channel the failed bundle is quarantined.
 *  - `failed`: nothing changed, or the rollback itself failed; `errorCode`
 *    says which.
 *  - `repaired`: a reinstall that was not a version move: the server stream
 *    repair, or a venv rebuilt at boot.
 *  - `skipped`: an offered UI this pass did not download. */
export type {
  UpdateJournalChannel,
  UpdateJournalPhase,
  UpdateJournalTrigger,
  UpdatePhaseEntry,
  UpdatePhaseRecord,
} from '../shared/update-journal-types';

interface StoredEntry extends UpdatePhaseEntry {
  /** Epoch ms of the last drain that handed this entry out. */
  leasedAt?: number;
}

// ---- pure core -------------------------------------------------------------

export function appendEntry(entries: StoredEntry[], entry: StoredEntry, cap = UPDATE_JOURNAL_CAP): StoredEntry[] {
  const next = [...entries, entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Entries not under a live lease, and the list with those leases stamped. */
export function leaseEntries(
  entries: StoredEntry[],
  now: number,
  leaseMs = UPDATE_JOURNAL_LEASE_MS,
): { leased: UpdatePhaseEntry[]; next: StoredEntry[] } {
  const leased: UpdatePhaseEntry[] = [];
  const next = entries.map((entry) => {
    if (entry.leasedAt !== undefined && now - entry.leasedAt < leaseMs) return entry;
    const { leasedAt: _leasedAt, ...visible } = entry;
    leased.push(visible);
    return { ...entry, leasedAt: now };
  });
  return { leased, next };
}

export function ackEntries(entries: StoredEntry[], ids: readonly string[]): StoredEntry[] {
  const gone = new Set(ids);
  return entries.filter((entry) => !gone.has(entry.id));
}

function isStoredEntry(value: unknown): value is StoredEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string'
    && typeof entry.at === 'string'
    && (entry.channel === 'ui' || entry.channel === 'server')
    && typeof entry.phase === 'string'
    && typeof entry.trigger === 'string';
}

// ---- outcome mapping -------------------------------------------------------

export interface ServerApplyResult {
  updated: boolean;
  previousVersion?: string;
  newVersion?: string;
  error?: string;
  outcome?: 'rolled-back' | 'rollback-failed' | 'restore-failed';
  repair?: boolean;
  component?: 'anton-agent';
}

/** A git install names its versions by commit. The success path reports the
 *  short sha and the failure paths the full one, so both are shortened here
 *  and one commit is one value in PostHog. */
function shortCommit(version: string | undefined): string | null {
  if (!version) return null;
  return /^[0-9a-f]{40}$/i.test(version) ? version.slice(0, 7) : version;
}

/** The journal entry for one server apply, or null when there was nothing to
 *  apply (already current, or auto-update disabled). */
export function serverOutcomeRecord(
  result: ServerApplyResult,
  trigger: UpdateJournalTrigger,
  durationMs: number,
): UpdatePhaseRecord | null {
  const common = {
    channel: 'server' as const,
    trigger,
    durationMs,
    from: shortCommit(result.previousVersion),
    to: shortCommit(result.newVersion),
    ...(result.component ? { component: result.component } : {}),
    ...(result.repair ? { repair: true } : {}),
  };
  if (result.updated) return { ...common, phase: result.repair ? 'repaired' : 'applied' };
  if (!result.error) return null;
  if (result.outcome === 'rolled-back') return { ...common, phase: 'rolled-back', errorCode: 'health-check' };
  const errorCode = result.outcome
    ?? (result.error === 'uv not found' ? 'uv-missing'
      : result.error === 'could not determine installed version' ? 'unknown-installed-version'
        : 'install');
  return { ...common, phase: 'failed', errorCode };
}

/** `unverified`: the bundle was activated but there was no window to load
 *  it into, so the health check never ran. It serves at the next boot. */
export type UiReloadOutcome = 'applied' | 'unverified' | 'rolled-back' | 'rollback-failed';

/** The journal entry for one UI bundle swap and its health-checked reload. */
export function uiOutcomeRecord(
  outcome: UiReloadOutcome,
  versions: { from: string | null; to: string | null },
  trigger: UpdateJournalTrigger,
  durationMs: number,
): UpdatePhaseRecord {
  if (outcome === 'applied') return { channel: 'ui', phase: 'applied', trigger, durationMs, ...versions };
  if (outcome === 'unverified') return { channel: 'ui', phase: 'applied', trigger, durationMs, errorCode: 'unverified-no-window', ...versions };
  if (outcome === 'rolled-back') {
    return { channel: 'ui', phase: 'rolled-back', trigger, durationMs, errorCode: 'renderer-load', ...versions };
  }
  return { channel: 'ui', phase: 'failed', trigger, durationMs, errorCode: 'rollback-failed', ...versions };
}

// ---- file-backed journal ---------------------------------------------------

export interface UpdateJournal {
  /** Append one outcome. Never throws: a journal that cannot be written
   *  must not fail the update it describes. */
  record(record: UpdatePhaseRecord): void;
  /** Hand out every entry not under a live lease, and lease them. */
  drain(): UpdatePhaseEntry[];
  /** Forget entries the renderer has delivered. */
  ack(ids: readonly string[]): void;
}

export function createUpdateJournal(options: {
  filePath: string;
  now?: () => number;
  buildKind?: () => string | null;
  leaseMs?: number;
  cap?: number;
}): UpdateJournal {
  const now = options.now ?? Date.now;
  const buildKind = options.buildKind ?? (() => { try { return buildKindStrict(); } catch { return null; } });
  const leaseMs = options.leaseMs ?? UPDATE_JOURNAL_LEASE_MS;
  const cap = options.cap ?? UPDATE_JOURNAL_CAP;

  function read(): StoredEntry[] {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(options.filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter(isStoredEntry) : [];
    } catch {
      return [];
    }
  }

  function write(entries: StoredEntry[]): void {
    // Write beside, then rename: a crash mid-write leaves the old journal, not
    // a torn one that the next read would throw away.
    const tmp = `${options.filePath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, options.filePath);
  }

  return {
    record(record) {
      try {
        const entry: StoredEntry = {
          ...record,
          id: randomUUID(),
          at: new Date(now()).toISOString(),
          buildKind: buildKind(),
        };
        write(appendEntry(read(), entry, cap));
      } catch (error) {
        console.warn('[update-journal] could not record an update outcome:', error);
      }
    },
    drain() {
      try {
        const { leased, next } = leaseEntries(read(), now(), leaseMs);
        if (leased.length > 0) write(next);
        return leased;
      } catch (error) {
        console.warn('[update-journal] could not drain the journal:', error);
        return [];
      }
    },
    ack(ids) {
      if (!Array.isArray(ids) || ids.length === 0) return;
      try {
        const entries = read();
        const next = ackEntries(entries, ids.filter((id): id is string => typeof id === 'string'));
        if (next.length !== entries.length) write(next);
      } catch (error) {
        console.warn('[update-journal] could not ack journal entries:', error);
      }
    },
  };
}

let defaultJournal: UpdateJournal | null = null;

function journal(): UpdateJournal {
  if (!defaultJournal) {
    defaultJournal = createUpdateJournal({ filePath: path.join(app.getPath('userData'), UPDATE_JOURNAL_FILE) });
  }
  return defaultJournal;
}

/** Record one UI or server update outcome for the renderer to report. */
export function recordUpdatePhase(record: UpdatePhaseRecord): void {
  journal().record(record);
}

export function registerUpdateJournalHandlers(): void {
  ipcMain.handle(IPC.UPDATE_JOURNAL_DRAIN, () => journal().drain());
  ipcMain.handle(IPC.UPDATE_JOURNAL_ACK, (_event: unknown, ids: unknown) => {
    journal().ack(Array.isArray(ids) ? ids : []);
  });
}

/** Test seam: route the default journal elsewhere. */
export function setUpdateJournalForTests(instance: UpdateJournal | null): void {
  defaultJournal = instance;
}
