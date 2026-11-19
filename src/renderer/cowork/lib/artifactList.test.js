import { describe, expect, it, vi } from 'vitest';

import {
  createLatestLoader,
  withArtifactChange,
  withoutArtifact,
  withoutProjectArtifacts,
} from './artifactList';

const a = { path: '/p1/.anton/artifacts/a/index.html', projectId: 'p1', publishedUrl: '' };
const b = { path: '/p2/.anton/artifacts/b/index.html', projectId: 'p2', publishedUrl: '' };
const p1 = { id: 'p1', path: '/p1' };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('list updates', () => {
  it('drops the card with the exact path', () => {
    expect(withoutArtifact([a, b], b.path)).toEqual([a]);
  });

  it('returns the same list when nothing matches, so React skips the update', () => {
    const list = [a, b];
    expect(withoutArtifact(list, '/p2/.anton/artifacts/b/static/index.html')).toBe(list);
    expect(withoutArtifact(list, undefined)).toBe(list);
    expect(withoutProjectArtifacts(list, { id: 'p3', path: '/p3' })).toBe(list);
    expect(withoutProjectArtifacts(list, undefined)).toBe(list);
    expect(withArtifactChange(list, { path: '/elsewhere', publishedUrl: 'x' })).toBe(list);
  });

  it('drops every card of a project, by id or under its path', () => {
    const byPath = { path: '/p1/.anton/artifacts/c/index.html' };
    expect(withoutProjectArtifacts([a, b, byPath], p1)).toEqual([b]);
  });

  it('merges a change into the card with the same path', () => {
    const next = withArtifactChange([a, b], { path: a.path, publishedUrl: 'https://x' });
    expect(next).toEqual([{ ...a, publishedUrl: 'https://x' }, b]);
  });
});

describe('createLatestLoader', () => {
  it('applies a loaded list', async () => {
    const apply = vi.fn();
    await createLatestLoader(async () => [a], apply).reload();
    expect(apply).toHaveBeenCalledWith([a]);
  });

  it('drops a response that a newer reload superseded, whatever order they land in', async () => {
    const first = deferred();
    const second = deferred();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const apply = vi.fn();
    const loader = createLatestLoader(load, apply);

    const r1 = loader.reload();
    const r2 = loader.reload();
    second.resolve([a]);
    await r2;
    first.resolve([a, b]);
    await r1;

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith([a]);
  });

  it('leaves the list alone when the load fails', async () => {
    const apply = vi.fn();
    await createLatestLoader(async () => { throw new Error('offline'); }, apply).reload();
    expect(apply).not.toHaveBeenCalled();
  });

  it('supersedes a reload in flight when a local change runs', async () => {
    const stale = deferred();
    const fresh = deferred();
    const load = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    const apply = vi.fn();
    const loader = createLatestLoader(load, apply);
    const change = vi.fn();

    const r1 = loader.reload();
    await Promise.resolve();
    loader.change(change);
    expect(change).toHaveBeenCalled();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    stale.resolve([a, b]);
    await r1;
    fresh.resolve([a]);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith([a]));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('does not load for a local change when nothing is in flight', async () => {
    const load = vi.fn(async () => [a]);
    const loader = createLatestLoader(load, () => {});
    await loader.reload();

    loader.change(() => {});

    expect(load).toHaveBeenCalledTimes(1);
  });
});
