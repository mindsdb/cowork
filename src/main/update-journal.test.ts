import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cowork-test-userdata' },
  ipcMain: { handle: vi.fn() },
}));

import {
  appendEntry,
  leaseEntries,
  ackEntries,
  serverOutcomeRecord,
  uiOutcomeRecord,
  createUpdateJournal,
  type UpdatePhaseEntry,
} from './update-journal';

const entry = (id: string, extra: Partial<UpdatePhaseEntry & { leasedAt?: number }> = {}) => ({
  id,
  at: '2026-10-07T00:00:00.000Z',
  channel: 'ui' as const,
  phase: 'applied' as const,
  trigger: 'boot' as const,
  buildKind: 'prod',
  ...extra,
});

describe('update journal core', () => {
  it('appends in order and drops the oldest past the cap', () => {
    const entries = appendEntry(appendEntry([], entry('a'), 2), entry('b'), 2);
    expect(appendEntry(entries, entry('c'), 2).map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('leases every unleased entry and hides the lease from the renderer', () => {
    const { leased, next } = leaseEntries([entry('a'), entry('b')], 1_000);
    expect(leased.map((e) => e.id)).toEqual(['a', 'b']);
    expect(leased[0]).not.toHaveProperty('leasedAt');
    expect(next.every((e) => e.leasedAt === 1_000)).toBe(true);
  });

  it('withholds an entry under a live lease and hands it out once the lease expires', () => {
    const stored = leaseEntries([entry('a')], 1_000, 60_000).next;
    expect(leaseEntries(stored, 30_000, 60_000).leased).toEqual([]);
    expect(leaseEntries(stored, 61_000, 60_000).leased.map((e) => e.id)).toEqual(['a']);
  });

  it('acks by id and ignores unknown ids', () => {
    expect(ackEntries([entry('a'), entry('b')], ['b', 'zzz']).map((e) => e.id)).toEqual(['a']);
  });
});

describe('serverOutcomeRecord', () => {
  it('reports an applied update with both versions', () => {
    expect(serverOutcomeRecord({ updated: true, previousVersion: '0.3.1', newVersion: '0.3.2' }, 'boot', 1200))
      .toEqual({ channel: 'server', phase: 'applied', trigger: 'boot', durationMs: 1200, from: '0.3.1', to: '0.3.2' });
  });

  it('reports the stream repair as repaired, not applied', () => {
    expect(serverOutcomeRecord({ updated: true, previousVersion: '0.3.2rc1', newVersion: '0.3.1', repair: true }, 'boot', 5)?.phase)
      .toBe('repaired');
  });

  it('reports nothing when the server was already current', () => {
    expect(serverOutcomeRecord({ updated: false }, 'periodic', 5)).toBeNull();
  });

  it('tells a rollback from a failed install and a failed rollback', () => {
    const base = { updated: false, previousVersion: '0.3.1', newVersion: '0.3.2', error: 'New version failed to start: x' };
    expect(serverOutcomeRecord({ ...base, outcome: 'rolled-back' }, 'manual', 9))
      .toMatchObject({ phase: 'rolled-back', errorCode: 'health-check', from: '0.3.1', to: '0.3.2' });
    expect(serverOutcomeRecord({ ...base, outcome: 'rollback-failed' }, 'manual', 9))
      .toMatchObject({ phase: 'failed', errorCode: 'rollback-failed' });
    expect(serverOutcomeRecord({ ...base, outcome: 'restore-failed' }, 'manual', 9))
      .toMatchObject({ phase: 'failed', errorCode: 'restore-failed' });
    expect(serverOutcomeRecord({ updated: false, error: 'uv tool install exploded' }, 'boot', 9))
      .toMatchObject({ phase: 'failed', errorCode: 'install' });
    expect(serverOutcomeRecord({ updated: false, error: 'uv not found' }, 'boot', 9))
      .toMatchObject({ phase: 'failed', errorCode: 'uv-missing' });
  });
});

describe('uiOutcomeRecord', () => {
  const versions = { from: '2.26.10.1.1', to: '2.26.10.7.1' };
  it('maps the health-checked reload outcome', () => {
    expect(uiOutcomeRecord('applied', versions, 'boot', 300)).toEqual({ channel: 'ui', phase: 'applied', trigger: 'boot', durationMs: 300, ...versions });
    expect(uiOutcomeRecord('rolled-back', versions, 'manual', 300)).toMatchObject({ phase: 'rolled-back', errorCode: 'renderer-load' });
    expect(uiOutcomeRecord('rollback-failed', versions, 'manual', 300)).toMatchObject({ phase: 'failed', errorCode: 'rollback-failed' });
  });
});

describe('file-backed journal', () => {
  let dir: string;
  let now = 1_000;
  const clock = () => now;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-journal-'));
    now = 1_000;
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const make = () => createUpdateJournal({ filePath: path.join(dir, 'update-journal.json'), now: clock, buildKind: () => 'prod', leaseMs: 60_000, cap: 3 });

  it('records, drains once per lease, and forgets acked entries', () => {
    const journal = make();
    journal.record({ channel: 'ui', phase: 'applied', trigger: 'boot', from: '1', to: '2' });
    journal.record({ channel: 'server', phase: 'failed', trigger: 'manual', errorCode: 'install' });

    const first = journal.drain();
    expect(first.map((e) => [e.channel, e.phase, e.buildKind])).toEqual([['ui', 'applied', 'prod'], ['server', 'failed', 'prod']]);
    expect(first[0]).not.toHaveProperty('leasedAt');
    expect(first[0].at).toBe(new Date(1_000).toISOString());

    // A second drain inside the lease (a reload mid-drain) gets nothing.
    expect(make().drain()).toEqual([]);

    // The renderer delivered the first and not the second.
    journal.ack([first[0].id]);
    now += 61_000;
    expect(make().drain().map((e) => e.id)).toEqual([first[1].id]);
  });

  it('survives a missing or corrupt file and a crash mid-write', () => {
    const journal = make();
    expect(journal.drain()).toEqual([]);
    fs.writeFileSync(path.join(dir, 'update-journal.json'), '{not json', 'utf8');
    expect(journal.drain()).toEqual([]);
    journal.record({ channel: 'ui', phase: 'applied', trigger: 'boot' });
    expect(journal.drain()).toHaveLength(1);
    // No temp file left behind by the rename.
    expect(fs.readdirSync(dir)).toEqual(['update-journal.json']);
  });

  it('keeps the newest entries when over the cap', () => {
    const journal = make();
    for (const to of ['1', '2', '3', '4']) journal.record({ channel: 'ui', phase: 'applied', trigger: 'boot', to });
    expect(journal.drain().map((e) => e.to)).toEqual(['2', '3', '4']);
  });
});
