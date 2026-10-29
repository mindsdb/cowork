import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:26866', getAccessToken: vi.fn(async () => 'kc-token'), isWeb: false },
}));
vi.mock('../lib/deployment', () => ({ PLATFORM_UI: true }));

import { fetchHubTeams, fetchSkillSharingCapabilities, searchHubPeople, setSkillAudience } from './api';

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

    await setSkillAudience('weekly report', { org: false, team_ids: ['t1'], emails: ['a@x.com'], always_on: true });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/skills/weekly%20report/sharing');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ org: false, team_ids: ['t1'], emails: ['a@x.com'], always_on: true });
  });

  it('sends always_on false when it is left out', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ label: 'weekly' }));

    await setSkillAudience('weekly', { org: true });

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ org: true, team_ids: [], emails: [], always_on: false });
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

  it('reads the camelCase displayName cowork-server sends', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true, teams: [{ id: 't1', displayName: 'Supply Planning' }, { id: 't2', display_name: 'Finance' }],
    }));

    expect((await fetchHubTeams()).teams).toEqual([
      { id: 't1', display_name: 'Supply Planning' },
      { id: 't2', display_name: 'Finance' },
    ]);
  });

  it('never shows a raw id for a team without a name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true, teams: [{ id: '5f1c2e9a-uuid', displayName: '  ' }, { id: '7a2b-uuid' }],
    }));

    expect((await fetchHubTeams()).teams.map((t) => t.display_name)).toEqual(['Unnamed team', 'Unnamed team']);
  });

  it.each([
    ['an unreachable hub', () => jsonRes({ reachable: false, teams: [] })],
    ['a failed request', () => jsonRes({ detail: 'boom' }, 500)],
  ])('reports %s as unreachable', async (_, response) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    expect(await fetchHubTeams()).toEqual({ reachable: false, teams: [] });
  });
});

describe('searchHubPeople', () => {
  it('asks the people route with the query, limit and MindsHub credential', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true,
      people: [
        { id: 'u1', name: 'Ana Ruiz', email: 'Ana@Kinaxis.com' },
        { id: 'u2', name: '', email: 'bo@kinaxis.com' },
        { id: 'u3', name: 'No Email' },
        { id: 'u4', name: 'Dup', email: 'ana@kinaxis.com' },
        null,
      ],
    }));
    const controller = new AbortController();

    expect(await searchHubPeople(' an ', { signal: controller.signal })).toEqual({
      reachable: true,
      people: [
        { id: 'u1', name: 'Ana Ruiz', email: 'ana@kinaxis.com' },
        { id: 'u2', name: null, email: 'bo@kinaxis.com' },
      ],
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/hub/people/?q=an&limit=8');
    expect(init.headers['X-MindsHub-Authorization']).toBe('Bearer kc-token');
    expect(init.signal).toBeDefined();
  });

  it('does not ask for fewer than two characters', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await searchHubPeople('a')).toEqual({ reachable: true, people: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['an unreachable hub', () => jsonRes({ reachable: false, people: [] })],
    ['a failed request', () => jsonRes({ detail: 'boom' }, 500)],
    ['a body without people', () => jsonRes({ reachable: false })],
  ])('reports %s as unreachable', async (_, response) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    expect(await searchHubPeople('ana')).toEqual({ reachable: false, people: [] });
  });

  it('reads a malformed body as no people', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ people: 'nope' }));
    expect(await searchHubPeople('ana')).toEqual({ reachable: true, people: [] });
  });

  it('reports a network error as unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await searchHubPeople('ana')).toEqual({ reachable: false, people: [] });
  });
});
