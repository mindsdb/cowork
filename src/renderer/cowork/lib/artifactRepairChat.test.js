import { describe, expect, it, vi } from 'vitest';
import { resolveRepairConversation } from './artifactRepairChat';

const ORIGIN = '3f6a1c8e-6b1d-4a2f-9a1e-2c7d5b0e4a11';

function artifactFrom(originConversationId) {
  return { id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa', originConversationId };
}

describe('resolveRepairConversation', () => {
  it('reuses the origin chat already in the recents list without a fetch', async () => {
    const local = { id: ORIGIN, messages: [{ role: 'user', content: 'build it' }] };
    const fetchConversation = vi.fn();

    const target = await resolveRepairConversation({
      artifact: artifactFrom(ORIGIN),
      tasks: [{ id: 'other' }, local],
      fetchConversation,
    });

    expect(target).toEqual({ id: ORIGIN, task: local });
    expect(fetchConversation).not.toHaveBeenCalled();
  });

  it('fetches an origin chat that fell off the capped recents list', async () => {
    const task = { id: ORIGIN, messages: [] };
    const fetchConversation = vi.fn(async () => ({ status: 'ok', task }));

    const target = await resolveRepairConversation({
      artifact: artifactFrom(ORIGIN),
      tasks: [],
      fetchConversation,
    });

    expect(fetchConversation).toHaveBeenCalledWith(ORIGIN);
    expect(target).toEqual({ id: ORIGIN, task });
  });

  it('gives up on a deleted origin chat so the caller opens a new one', async () => {
    const target = await resolveRepairConversation({
      artifact: artifactFrom(ORIGIN),
      tasks: [],
      fetchConversation: async () => ({ status: 'not_found' }),
    });

    expect(target).toEqual({ id: '', task: null });
  });

  it('gives up when the lookup fails — a repair bound to an unopened chat never runs', async () => {
    for (const fetchConversation of [
      async () => ({ status: 'unavailable', code: 500 }),
      async () => { throw new Error('offline'); },
      async () => ({ status: 'ok' }), // ok without a record is unusable
    ]) {
      const target = await resolveRepairConversation({
        artifact: artifactFrom(ORIGIN),
        tasks: [],
        fetchConversation,
      });
      expect(target).toEqual({ id: '', task: null });
    }
  });

  it('does not resume an origin chat that has moved to another project', async () => {
    // The turn would scan its own project's artifacts root and never find this
    // artifact, leaving the handoff queued.
    const artifact = { ...artifactFrom(ORIGIN), projectId: 'project-a' };
    const local = { id: ORIGIN, projectId: 'project-b' };

    const target = await resolveRepairConversation({
      artifact,
      tasks: [local],
      fetchConversation: async () => ({ status: 'ok', task: local }),
    });

    expect(target).toEqual({ id: '', task: null });
  });

  it('resumes across an unknown project — a missing id is not a mismatch', async () => {
    const artifact = { ...artifactFrom(ORIGIN), projectId: '', projectName: 'general' };
    const local = { id: ORIGIN, projectId: null, projectName: 'general' };

    const target = await resolveRepairConversation({
      artifact,
      tasks: [local],
      fetchConversation: async () => ({ status: 'ok', task: local }),
    });

    expect(target).toEqual({ id: ORIGIN, task: local });
  });

  it('does not look anything up for an artifact with no recorded origin', async () => {
    const fetchConversation = vi.fn();

    for (const artifact of [artifactFrom(''), artifactFrom(undefined), null]) {
      // eslint-disable-next-line no-await-in-loop
      const target = await resolveRepairConversation({ artifact, tasks: [], fetchConversation });
      expect(target).toEqual({ id: '', task: null });
    }
    expect(fetchConversation).not.toHaveBeenCalled();
  });
});
