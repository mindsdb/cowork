import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:26866', getAccessToken: vi.fn(async () => 'kc-token'), isWeb: false },
}));
vi.mock('../lib/deployment', () => ({ PLATFORM_UI: true }));

import { fetchHubTeams, fetchSkillSharingCapabilities, setSkillAudience } from './api';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchSkillSharingCapabilities', () => {
  it('reads the capabilities', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      enabled: true, can_share_org: true, can_write_org: false, org_name: 'Kinaxis',
    }));

    expect(await fetchSkillSharingCapabilities()).toEqual({
      enabled: true, can_share_org: true, can_write_org: false, org_name: 'Kinaxis',
    });
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:26866/api/v1/skills/sharing-capabilities');
  });

  it('reads a server without the route as sharing off', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ detail: 'Not Found' }, 404));

    expect(await fetchSkillSharingCapabilities()).toMatchObject({ enabled: false, can_share_org: false, org_name: null });
  });
});

describe('setSkillAudience', () => {
  it('PUTs the audience to the skill\'s sharing route', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ label: 'weekly' }));

    await setSkillAudience('weekly report', { org: false, team_ids: ['t1'], emails: ['a@x.com'] });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/skills/weekly%20report/sharing');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ org: false, team_ids: ['t1'], emails: ['a@x.com'] });
  });

  it("throws a 403 with the server's sentence", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ detail: 'Only admins can share with the whole organization.' }, 403));

    const err = await setSkillAudience('weekly', { org: true }).catch((e) => e);

    expect(err.message).toBe('Only admins can share with the whole organization.');
    expect(err.status).toBe(403);
  });
});

describe('fetchHubTeams', () => {
  it('asks the hub route with the MindsHub credential', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true, teams: [{ id: 't1', display_name: 'Supply Planning' }, { bad: true }],
    }));

    expect(await fetchHubTeams()).toEqual({ reachable: true, teams: [{ id: 't1', display_name: 'Supply Planning' }] });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/hub/teams/');
    expect(init.headers['X-MindsHub-Authorization']).toBe('Bearer kc-token');
  });

  it.each([
    ['an unreachable hub', () => jsonRes({ reachable: false, teams: [] })],
    ['a failed request', () => jsonRes({ detail: 'boom' }, 500)],
  ])('reports %s as unreachable', async (_, response) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    expect(await fetchHubTeams()).toEqual({ reachable: false, teams: [] });
  });
});
