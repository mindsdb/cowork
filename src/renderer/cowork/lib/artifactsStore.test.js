// The store's job is to be careful. Every test here is about a way it could
// wrongly conclude "deleted": a failed request read as an empty list, an index
// that predates the artifact, a scope it was never fetched for.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({
  fetchArtifactsStrict: vi.fn(),
  deleteArtifact: vi.fn(),
}));

import { deleteArtifact, fetchArtifactsStrict } from '../api';
import {
  __resetForTests,
  artifactDeletedNow,
  deleteArtifactAndSync,
  noteArtifactCreated,
  noteArtifactsFromSteps,
  revalidate,
  scopeKeyOf,
  setArtifactsScope,
} from './artifactsStore';

const serverCard = (o = {}) => ({
  id: '7db94eb8',
  slug: 'clock-7db94eb8',
  projectId: 'proj-1',
  folder: '/proj/.anton/artifacts/clock-7db94eb8',
  path: '/proj/.anton/artifacts/clock-7db94eb8/index.html',
  ...o,
});

const chatCard = (o = {}) => ({
  id: '7db94eb8',
  slug: 'clock-7db94eb8',
  projectId: 'proj-1',
  canonicalPath: '/proj/.anton/artifacts/clock-7db94eb8/index.html',
  ...o,
});

const SCOPE = { projectId: 'proj-1', projectPath: '/proj' };

// A deferred promise so a test can observe the store mid-load.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  __resetForTests();
  vi.mocked(fetchArtifactsStrict).mockReset();
  vi.mocked(deleteArtifact).mockReset();
});

describe('scopeKeyOf', () => {
  it('prefers projectId, falls back to projectPath, then global', () => {
    expect(scopeKeyOf({ projectId: 'a', projectPath: '/p' })).toBe('p:a');
    expect(scopeKeyOf({ projectPath: '/p' })).toBe('d:/p');
    expect(scopeKeyOf({})).toBe('g:');
    expect(scopeKeyOf(null)).toBe('g:');
  });
});

describe('loading the index', () => {
  it('reports a card the loaded list omits', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    setArtifactsScope(SCOPE);
    await revalidate();

    expect(artifactDeletedNow(chatCard())).toBe(true);
  });

  it('does not report a card the loaded list contains', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([serverCard()]);
    setArtifactsScope(SCOPE);
    await revalidate();

    expect(artifactDeletedNow(chatCard())).toBe(false);
  });

  it('passes the scope through to the fetcher', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    setArtifactsScope(SCOPE);
    await revalidate();

    expect(fetchArtifactsStrict).toHaveBeenCalledWith({ projectId: 'proj-1', projectPath: '/proj' });
  });

  it('does not read a failed request as an empty list', async () => {
    // fetchArtifacts() (the non-strict sibling) swallows and returns [], which
    // would mark every card in the conversation deleted. This is why the store
    // has its own fetcher.
    vi.mocked(fetchArtifactsStrict).mockRejectedValue(new Error('offline'));
    setArtifactsScope(SCOPE);
    await revalidate();

    expect(artifactDeletedNow(chatCard())).toBe(false);
  });

  it('keeps a previously loaded index when a later load fails', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    setArtifactsScope(SCOPE);
    await revalidate();
    vi.mocked(fetchArtifactsStrict).mockRejectedValue(new Error('offline'));
    await revalidate();

    expect(artifactDeletedNow(chatCard())).toBe(true);
  });

  it('coalesces concurrent loads into one request', async () => {
    const gate = deferred();
    vi.mocked(fetchArtifactsStrict).mockReturnValue(gate.promise);
    setArtifactsScope(SCOPE);
    const a = revalidate();
    const b = revalidate();
    gate.resolve([]);
    await Promise.all([a, b]);

    expect(fetchArtifactsStrict).toHaveBeenCalledTimes(1);
  });
});

describe('scope', () => {
  it('drops the index on a scope change', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    setArtifactsScope(SCOPE);
    await revalidate();
    expect(artifactDeletedNow(chatCard())).toBe(true);

    setArtifactsScope({ projectId: 'proj-2', projectPath: '/other' });

    expect(artifactDeletedNow(chatCard())).toBe(false);
  });

  it('ignores a scope object with the same values', async () => {
    // ChatView rebuilds `{ projectId, projectPath }` on every render, so a
    // by-reference comparison would reload forever.
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    setArtifactsScope({ ...SCOPE });
    await revalidate();
    setArtifactsScope({ ...SCOPE });
    setArtifactsScope({ ...SCOPE });

    expect(fetchArtifactsStrict).toHaveBeenCalledTimes(1);
    expect(artifactDeletedNow(chatCard())).toBe(true);
  });
});

describe('tombstones', () => {
  it('reports a deleted artifact without waiting for a refetch', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([serverCard()]);
    vi.mocked(deleteArtifact).mockResolvedValue({ status: 'deleted' });
    setArtifactsScope(SCOPE);
    await revalidate();
    expect(artifactDeletedNow(chatCard())).toBe(false);

    // The list still contains it — only the tombstone can be the reason.
    await deleteArtifactAndSync(serverCard());

    expect(artifactDeletedNow(chatCard())).toBe(true);
  });

  it('does not tombstone when the DELETE fails, and rethrows', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([serverCard()]);
    vi.mocked(deleteArtifact).mockRejectedValue(new Error('Delete failed (500)'));
    setArtifactsScope(SCOPE);
    await revalidate();

    await expect(deleteArtifactAndSync(serverCard())).rejects.toThrow('Delete failed (500)');
    expect(artifactDeletedNow(chatCard())).toBe(false);
  });

  it('survives a load, unlike born', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([serverCard()]);
    vi.mocked(deleteArtifact).mockResolvedValue({ status: 'deleted' });
    setArtifactsScope(SCOPE);
    await revalidate();
    await deleteArtifactAndSync(serverCard());
    await revalidate();

    expect(artifactDeletedNow(chatCard())).toBe(true);
  });
});

describe('born', () => {
  it('shields an artifact created after the index was loaded', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    setArtifactsScope(SCOPE);
    await revalidate();
    expect(artifactDeletedNow(chatCard())).toBe(true);

    noteArtifactCreated(chatCard());

    expect(artifactDeletedNow(chatCard())).toBe(false);
  });

  it('expires once a load started after it completes', async () => {
    // Otherwise born would permanently mask an out-of-app deletion (§8.7),
    // which is the very symptom this ticket is about.
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    setArtifactsScope(SCOPE);
    await revalidate();
    noteArtifactCreated(chatCard());
    await revalidate();

    expect(artifactDeletedNow(chatCard())).toBe(true);
  });

  it('does not expire an entry added while a load was already in flight', async () => {
    // That load's snapshot cannot possibly contain it.
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    setArtifactsScope(SCOPE);
    await revalidate();

    const gate = deferred();
    vi.mocked(fetchArtifactsStrict).mockReturnValue(gate.promise);
    const inFlight = revalidate();
    noteArtifactCreated(chatCard());
    gate.resolve([]);
    await inFlight;

    expect(artifactDeletedNow(chatCard())).toBe(false);
  });

  it('keeps its cover when the load that promised to replace it fails', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    setArtifactsScope(SCOPE);
    await revalidate();
    noteArtifactCreated(chatCard());
    vi.mocked(fetchArtifactsStrict).mockRejectedValue(new Error('offline'));
    await revalidate();

    expect(artifactDeletedNow(chatCard())).toBe(false);
  });

  it('loses to a tombstone', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    vi.mocked(deleteArtifact).mockResolvedValue({ status: 'deleted' });
    setArtifactsScope(SCOPE);
    await revalidate();
    noteArtifactCreated(chatCard());
    await deleteArtifactAndSync(serverCard());

    expect(artifactDeletedNow(chatCard())).toBe(true);
  });
});

describe('noteArtifactsFromSteps', () => {
  it('takes the data of Artifact steps and ignores the rest', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    setArtifactsScope(SCOPE);
    await revalidate();

    noteArtifactsFromSteps([
      { badge: 'Tool', data: { id: 'nope' } },
      { badge: 'Artifact' },
      { badge: 'Artifact', data: chatCard() },
    ]);

    expect(artifactDeletedNow(chatCard())).toBe(false);
    // The Tool step's data must NOT have entered born. Had it, the miss on the
    // empty index would be shielded and this would read false — so `true` is
    // what proves the badge filter held.
    expect(artifactDeletedNow(chatCard({ id: 'nope', slug: '', canonicalPath: '' }))).toBe(true);
  });

  it('tolerates a non-array', () => {
    expect(() => noteArtifactsFromSteps(undefined)).not.toThrow();
  });
});

describe('live cards', () => {
  it('are never reported, whatever the index says', async () => {
    vi.mocked(fetchArtifactsStrict).mockResolvedValue([]);
    setArtifactsScope(SCOPE);
    await revalidate();

    expect(artifactDeletedNow(chatCard(), { live: true })).toBe(false);
  });
});
