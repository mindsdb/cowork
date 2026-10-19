import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:26866', getAccessToken: vi.fn(async () => null), isWeb: false },
}));

import { setSkillSharing, uploadSkillFile } from './api';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setSkillSharing', () => {
  it.each([true, false])('PUTs {"shared": %s} to the skill\'s sharing route', async (shared) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ label: 'weekly report', shared }));

    const saved = await setSkillSharing('weekly report', shared);

    expect(saved).toEqual({ label: 'weekly report', shared });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/skills/weekly%20report/sharing');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ shared });
  });

  it("surfaces the server's refusal sentence and status", async () => {
    const refusal = 'Someone else already shares a skill named weekly-report. Rename your skill before you share it.';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ detail: refusal }, 409));

    const err = await setSkillSharing('weekly-report', true).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(refusal);
    expect(err.status).toBe(409);
  });
});

describe('uploadSkillFile', () => {
  const file = new File(['---\nname: x\n---'], 'SKILL.md', { type: 'text/markdown' });

  async function sentForm(options) {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ label: 'x' }));
    await uploadSkillFile(file, options);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/skills/upload');
    expect(init.method).toBe('POST');
    return init.body;
  }

  it.each([[true, 'true'], [false, 'false']])('sends the shared field for shared %s', async (shared, sent) => {
    const form = await sentForm({ shared });

    expect(form.get('shared')).toBe(sent);
    expect(form.get('file')).toBeInstanceOf(File);
  });

  it('sends no shared field when the caller never asked', async () => {
    const form = await sentForm(undefined);

    expect(form.has('shared')).toBe(false);
    expect(form.get('file')).toBeInstanceOf(File);
  });
});
