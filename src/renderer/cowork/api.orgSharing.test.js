import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:26866', getAccessToken: vi.fn(async () => 'kc-token'), isWeb: false },
}));
vi.mock('../lib/deployment', () => ({ PLATFORM_UI: true }));

import {
  fetchHubDirectory, fetchHubPeopleByEmails, fetchHubPeopleByIds, fetchHubTeams, fetchSkillSharingCapabilities,
  setSkillAccess,
} from './api';

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
      enabled: true, canShareOrg: true, canWriteOrg: false, orgName: 'Acme',
    }));

    expect(await fetchSkillSharingCapabilities()).toEqual({
      enabled: true, can_share_org: true, can_write_org: false, org_name: 'Acme',
    });
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:26866/api/v1/skills/sharing-capabilities');
  });

  it('reads the camelCase capabilities the server sends', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      enabled: true, canShareOrg: true, canWriteOrg: true, orgName: ' Acme ',
    }));

    expect(await fetchSkillSharingCapabilities()).toEqual({
      enabled: true, can_share_org: true, can_write_org: true, org_name: 'Acme',
    });
  });

  it('reads camelCase false as false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      enabled: true, canShareOrg: false, canWriteOrg: false, orgName: null,
    }));

    expect(await fetchSkillSharingCapabilities()).toEqual({
      enabled: true, can_share_org: false, can_write_org: false, org_name: null,
    });
  });

  it('reads a server without the route as sharing off', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ detail: 'Not Found' }, 404));

    expect(await fetchSkillSharingCapabilities()).toMatchObject({ enabled: false, can_share_org: false, org_name: null });
  });
});

describe('setSkillAccess', () => {
  it('PUTs the audience to the skill\'s sharing route', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ label: 'weekly' }));

    await setSkillAccess('weekly report', {
      org_allowed: false, allowed_team_ids: ['t1'], allowed_user_ids: ['u1'], always_on: true,
    });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/skills/weekly%20report/sharing');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({
      org_allowed: false, allowed_team_ids: ['t1'], allowed_user_ids: ['u1'], always_on: true,
    });
  });

  it('sends only the fields it is given, which the route changes and keeps the rest', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ label: 'weekly' }));

    await setSkillAccess('weekly', { always_on: true });

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ always_on: true });
  });

  it("throws a 403 with the server's sentence", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ detail: 'Only admins can share with the whole organization.' }, 403));

    const err = await setSkillAccess('weekly', { org_allowed: true }).catch((e) => e);

    expect(err.message).toBe('Only admins can share with the whole organization.');
    expect(err.status).toBe(403);
  });
});

describe('fetchHubTeams', () => {
  it('asks the hub route with no X-MindsHub-Authorization, which it does not read', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true, teams: [{ id: 't1', displayName: 'Platform' }, { bad: true }],
    }));

    expect(await fetchHubTeams()).toEqual({ reachable: true, teams: [{ id: 't1', display_name: 'Platform', is_default: false }] });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/hub/teams/');
    expect(init.headers).not.toHaveProperty('X-MindsHub-Authorization');
  });

  it('keeps which team is the org default', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true,
      teams: [
        { id: 't0', displayName: 'All members', isDefault: true },
        { id: 't1', displayName: 'Platform', isDefault: false },
      ],
    }));

    expect((await fetchHubTeams()).teams.map((t) => [t.id, t.is_default])).toEqual([['t0', true], ['t1', false]]);
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

describe('fetchHubDirectory', () => {
  it('reads the whole directory without params, and with no X-MindsHub-Authorization', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true,
      truncated: true,
      people: [
        { id: 'u1', name: 'Ana López', email: 'Ana@Acme.com' },
        { id: 'u2', email: 'bo@acme.com' },
        { id: 'u1', name: 'Dup', email: 'ana@acme.com' },
        { id: 'u3' },
        { name: 'No Id', email: 'x@acme.com' },
      ],
    }));

    expect(await fetchHubDirectory()).toEqual({
      reachable: true,
      truncated: true,
      people: [
        { id: 'u1', name: 'Ana López', email: 'ana@acme.com' },
        { id: 'u2', name: null, email: 'bo@acme.com' },
      ],
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/hub/people/');
    expect(init.headers).not.toHaveProperty('X-MindsHub-Authorization');
  });

  it('takes a bare array and reads a missing truncated as false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes([{ id: 'u1', name: 'Ana', email: 'ana@acme.com' }]));
    expect(await fetchHubDirectory()).toEqual({
      reachable: true, truncated: false, people: [{ id: 'u1', name: 'Ana', email: 'ana@acme.com' }],
    });
  });

  it.each([
    ['an unreachable hub', () => jsonRes({ reachable: false, people: [] })],
    ['a failed request', () => jsonRes({ detail: 'boom' }, 500)],
    ['a body without people', () => jsonRes({ ok: true })],
  ])('reports %s as unreachable', async (_, response) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    expect(await fetchHubDirectory()).toEqual({ reachable: false, people: [], truncated: false });
  });
});

describe('fetchHubPeopleByIds', () => {
  it('names stored user ids through the people route', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true,
      people: [
        { id: 'u1', name: 'Ana Ruiz', email: 'Ana@Acme.com' },
        { id: 'u-other', name: 'Not Asked', email: 'x@acme.com' },
        { name: 'No Id' },
      ],
    }));

    expect(await fetchHubPeopleByIds(['u1', 'u2', 'u1', ''])).toEqual({
      reachable: true,
      people: [{ id: 'u1', name: 'Ana Ruiz', email: 'ana@acme.com' }],
      unanswered: [],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/hub/people/?ids=u1%2Cu2');
    expect(init.headers).not.toHaveProperty('X-MindsHub-Authorization');
  });

  it('asks in batches of at most 50 ids', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `u${i}`);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const asked = new URL(url).searchParams.get('ids').split(',');
      return jsonRes({ reachable: true, people: asked.map((id) => ({ id, name: id, email: `${id}@acme.com` })) });
    });

    const result = await fetchHubPeopleByIds(ids);

    expect(fetch.mock.calls.map(([url]) => new URL(url).searchParams.get('ids').split(',').length)).toEqual([50, 50, 20]);
    expect(result.reachable).toBe(true);
    expect(result.people.map((p) => p.id)).toEqual(ids);
  });

  it('keeps what the other batches named when one fails, and lists the ids it could not ask', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `u${i}`);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ detail: 'boom' }, 500))
      .mockResolvedValueOnce(jsonRes({ reachable: true, people: [{ id: 'u55', name: 'Bo', email: 'bo@acme.com' }] }));

    expect(await fetchHubPeopleByIds(ids)).toEqual({
      reachable: false,
      people: [{ id: 'u55', name: 'Bo', email: 'bo@acme.com' }],
      unanswered: ids.slice(0, 50),
    });
  });

  it('asks nothing for no ids', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await fetchHubPeopleByIds([])).toEqual({ reachable: true, people: [], unanswered: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('fetchHubPeopleByEmails', () => {
  it('asks the people route which members hold the addresses, lowercased', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true,
      people: [
        { id: 'u2', name: 'Bo Chen', email: 'Bo@Acme.com' },
        { id: 'u-other', name: 'Not Asked', email: 'x@acme.com' },
      ],
    }));

    expect(await fetchHubPeopleByEmails([' Bo@Acme.com', 'zed@partner.io', 'bo@acme.com', ''])).toEqual({
      reachable: true,
      people: [{ id: 'u2', name: 'Bo Chen', email: 'bo@acme.com' }],
      unanswered: [],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:26866/api/v1/hub/people/?emails=bo%40acme.com%2Czed%40partner.io');
    expect(init.headers).not.toHaveProperty('X-MindsHub-Authorization');
  });

  it('asks in batches of at most 50 addresses, and lists the ones a failed batch could not ask', async () => {
    const emails = Array.from({ length: 60 }, (_, i) => `p${i}@acme.com`);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ detail: 'boom' }, 500))
      .mockResolvedValueOnce(jsonRes({ reachable: true, people: [{ id: 'u55', name: 'P55', email: 'p55@acme.com' }] }));

    expect(await fetchHubPeopleByEmails(emails)).toEqual({
      reachable: false,
      people: [{ id: 'u55', name: 'P55', email: 'p55@acme.com' }],
      unanswered: emails.slice(0, 50),
    });
  });
});
