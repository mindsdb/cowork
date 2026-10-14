import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCodeFixtureApi } from './fixtures';

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('repository setup preview fixtures', () => {
  it('handles repository status, branches and diffs without reaching the sidecar', async () => {
    window.history.replaceState({}, '', '/?codeFixture=new');
    const fetch = vi.fn(() => { throw new Error('Fixture must not reach a real server'); });
    vi.stubGlobal('fetch', fetch);
    vi.resetModules();
    const { codingApi } = await import('./api');
    const { items: projects } = await codingApi.projects();
    const project = projects[0];
    const repository = project.resources![0];
    const { items: statuses } = await codingApi.repositoryStatus(project.id);
    expect(statuses).toEqual([expect.objectContaining({
      resource_id: repository.id, available: true, local: true,
      branch: 'staging', branches: ['staging', 'main'], changes: [], change_count: 0,
    })]);
    expect(await codingApi.repositoryBranches(project.id, repository.id)).toEqual({ items: ['staging', 'main'] });
    expect(await codingApi.repositoryDiff(project.id, repository.id)).toEqual({ files: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never activates preview APIs in production', () => {
    window.history.replaceState({}, '', '/?codeFixture=new');
    vi.stubEnv('DEV', false);
    expect(getCodeFixtureApi()).toBeNull();
  });
});
