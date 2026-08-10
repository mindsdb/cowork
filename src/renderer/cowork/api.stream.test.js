import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamNewSession } from './api';

// Project names are mutable (rename) while ids are not, so the composer
// sends project_id whenever it has one (ENG-1028). The name stays in the
// payload for older servers that only understand `project`.

describe('streamNewSession project identity', () => {
  let bodies;

  beforeEach(() => {
    bodies = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const send = (opts) => new Promise((resolve) => {
    streamNewSession('hi', { ...opts, onDone: resolve, onError: resolve });
  });

  it('sends project_id alongside the project name when known', async () => {
    await send({ projectName: 'docs', projectId: 'a4f7e0d2-1111-2222-3333-444455556666' });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].project).toBe('docs');
    expect(bodies[0].project_id).toBe('a4f7e0d2-1111-2222-3333-444455556666');
  });

  it('omits project_id when the renderer has none', async () => {
    await send({ projectName: 'docs' });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].project).toBe('docs');
    expect(bodies[0]).not.toHaveProperty('project_id');
  });
});
