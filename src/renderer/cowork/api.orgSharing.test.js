import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/host', () => ({
  host: { getApiOrigin: () => 'http://127.0.0.1:26866', getAccessToken: vi.fn(async () => 'kc-token'), isWeb: false },
}));
vi.mock('../lib/deployment', () => ({ PLATFORM_UI: true }));

import {
  fetchMindsHubDirectory, fetchMindsHubPeopleByEmails, fetchMindsHubPeopleByIds, fetchMindsHubTeams, fetchSkillSharingCapabilities,
  setSkillAccess,
} from './api';
import { SHARING_OFF } from './lib/orgSharing';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchSkillSharingCapabilities', () => {
  it('reads the capabilities under the names the server sends', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      enabled: true,
      canShareSkillsOrg: true,
      canWriteSkillsOrg: false,
      canShareArtifactsOrg: true,
      permissionsKnown: true,
      teamsKnown: true,
    }));

    expect(await fetchSkillSharingCapabilities()).toEqual({
      enabled: true,
      canShareSkillsOrg: true,
      canWriteSkillsOrg: false,
      canShareArtifactsOrg: true,
      permissionsKnown: true,
      teamsKnown: true,
    });
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:26866/api/v1/skills/sharing-capabilities');
  });

  it('keeps "MindsHub could not be asked" apart from "not allowed"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      enabled: true,
      canShareSkillsOrg: false,
      canWriteSkillsOrg: false,
      canShareArtifactsOrg: false,
      permissionsKnown: false,
      teamsKnown: false,
    }));

    expect(await fetchSkillSharingCapabilities()).toMatchObject({
      canShareSkillsOrg: false, canShareArtifactsOrg: false, permissionsKnown: false, teamsKnown: false,
    });
  });

  it('reads no other spelling of a capability', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      enabled: true, canShareOrg: true, canWriteOrg: true, can_share_org: true,
    }));

    expect(await fetchSkillSharingCapabilities()).toEqual({
      enabled: true,
      canShareSkillsOrg: false,
      canWriteSkillsOrg: false,
      canShareArtifactsOrg: false,
      permissionsKnown: true,
      teamsKnown: true,
    });
  });

  /* The organization's name comes from the app's own organization list
     (useSharingOrgName), never from this answer. */
  it('reads no organization name from the answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ enabled: true, orgName: 'Acme', org_name: 'Acme' }));

    const capabilities = await fetchSkillSharingCapabilities();
    expect(capabilities).not.toHaveProperty('orgName');
    expect(Object.values(capabilities)).not.toContain('Acme');
  });

  it('reads a server without the route as sharing off', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ detail: 'Not Found' }, 404));

    expect(await fetchSkillSharingCapabilities()).toEqual(SHARING_OFF);
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ detail: "Sharing a skill with everyone in the organization requires the skills.share_org permission and being the skill's owner, or an organization admin." }, 403));

    const err = await setSkillAccess('weekly', { org_allowed: true }).catch((e) => e);

    expect(err.message).toBe("Sharing a skill with everyone in the organization requires the skills.share_org permission and being the skill's owner, or an organization admin.");
    expect(err.status).toBe(403);
  });
});

/* The bodies cowork-server's MindsHubRefused and MindsHubUnreachable answer
   (cowork/services/mindshub_client.py there, which this app can't import):
   the code sits in `detail`, beside the sentence. */
const mindsHubRefused = (status = 403) => jsonRes({
  detail: {
    code: 'mindshub_refused',
    message: status === 403 ? 'MindsHub refused to answer for your organization.' : 'MindsHub refused this lookup.',
  },
}, status);
const mindsHubThrottled = () => jsonRes({
  detail: { code: 'mindshub_throttled', message: 'MindsHub is limiting how often this can be asked. Try again in a minute.' },
}, 429);
const mindsHubUnreachable = () => jsonRes({
  detail: { code: 'mindshub_unreachable', message: "Couldn't reach MindsHub to confirm who is in your organization. Try again in a moment." },
}, 503);

describe('fetchMindsHubTeams', () => {
  it('asks the teams route with no X-MindsHub-Authorization, which it does not read', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true, teams: [{ id: 't1', displayName: 'Platform' }, { bad: true }],
    }));

    expect(await fetchMindsHubTeams()).toEqual({ reachable: true, failure: null, teams: [{ id: 't1', display_name: 'Platform', is_default: false }] });
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

    expect((await fetchMindsHubTeams()).teams.map((t) => [t.id, t.is_default])).toEqual([['t0', true], ['t1', false]]);
  });

  it('never shows a raw id for a team without a name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true, teams: [{ id: '5f1c2e9a-uuid', displayName: '  ' }, { id: '7a2b-uuid' }],
    }));

    expect((await fetchMindsHubTeams()).teams.map((t) => t.display_name)).toEqual(['Unnamed team', 'Unnamed team']);
  });

  it.each([
    ['MindsHub unreachable', () => jsonRes({ reachable: false, teams: [] })],
    ['a failed request', () => jsonRes({ detail: 'boom' }, 500)],
    ['a 503 mindshub_unreachable', mindsHubUnreachable],
  ])('reports %s as unreachable', async (_, response) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    expect(await fetchMindsHubTeams()).toEqual({ reachable: false, failure: 'mindshub_unreachable', teams: [] });
  });

  it.each([
    ['a 403 mindshub_refused', () => mindsHubRefused(403), 'mindshub_refused'],
    ['a 400 mindshub_refused', () => mindsHubRefused(400), 'mindshub_refused'],
    ['a 429 mindshub_throttled', mindsHubThrottled, 'mindshub_throttled'],
  ])('tells %s apart from an outage', async (_, response, failure) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    expect(await fetchMindsHubTeams()).toEqual({ reachable: false, failure, teams: [] });
  });
});

describe('fetchMindsHubDirectory', () => {
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

    expect(await fetchMindsHubDirectory()).toEqual({
      reachable: true,
      failure: null,
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
    expect(await fetchMindsHubDirectory()).toEqual({
      reachable: true, failure: null, truncated: false, people: [{ id: 'u1', name: 'Ana', email: 'ana@acme.com' }],
    });
  });

  it.each([
    ['MindsHub unreachable', () => jsonRes({ reachable: false, people: [] })],
    ['a failed request', () => jsonRes({ detail: 'boom' }, 500)],
    ['a body without people', () => jsonRes({ ok: true })],
    ['a 503 mindshub_unreachable', mindsHubUnreachable],
  ])('reports %s as unreachable', async (_, response) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    expect(await fetchMindsHubDirectory()).toEqual({ reachable: false, failure: 'mindshub_unreachable', people: [], truncated: false });
  });

  /* MindsHub was asked and said no, or is limiting the caller: neither is
     "couldn't reach MindsHub". */
  it.each([
    ['a 403 mindshub_refused', () => mindsHubRefused(403), 'mindshub_refused'],
    ['a 400 mindshub_refused', () => mindsHubRefused(400), 'mindshub_refused'],
    ['a 429 mindshub_throttled', mindsHubThrottled, 'mindshub_throttled'],
  ])('tells %s apart from an outage', async (_, response, failure) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    expect(await fetchMindsHubDirectory()).toEqual({ reachable: false, failure, people: [], truncated: false });
  });
});

describe('fetchMindsHubPeopleByIds', () => {
  it('names stored user ids through the people route', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true,
      people: [
        { id: 'u1', name: 'Ana Ruiz', email: 'Ana@Acme.com' },
        { id: 'u-other', name: 'Not Asked', email: 'x@acme.com' },
        { name: 'No Id' },
      ],
    }));

    expect(await fetchMindsHubPeopleByIds(['u1', 'u2', 'u1', ''])).toEqual({
      reachable: true,
      failure: null,
      people: [{ id: 'u1', name: 'Ana Ruiz', email: 'ana@acme.com' }],
      unanswered: [],
      invalid: [],
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

    const result = await fetchMindsHubPeopleByIds(ids);

    expect(fetch.mock.calls.map(([url]) => new URL(url).searchParams.get('ids').split(',').length)).toEqual([50, 50, 20]);
    expect(result.reachable).toBe(true);
    expect(result.people.map((p) => p.id)).toEqual(ids);
  });

  it('keeps what the other batches named when one fails, and lists the ids it could not ask', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `u${i}`);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ detail: 'boom' }, 500))
      .mockResolvedValueOnce(jsonRes({ reachable: true, people: [{ id: 'u55', name: 'Bo', email: 'bo@acme.com' }] }));

    expect(await fetchMindsHubPeopleByIds(ids)).toEqual({
      reachable: false,
      failure: 'mindshub_unreachable',
      people: [{ id: 'u55', name: 'Bo', email: 'bo@acme.com' }],
      unanswered: ids.slice(0, 50),
      invalid: [],
    });
  });

  it('asks nothing for no ids', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await fetchMindsHubPeopleByIds([])).toEqual({ reachable: true, failure: null, people: [], unanswered: [], invalid: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a 403 mindshub_refused', () => mindsHubRefused(403), 'mindshub_refused'],
    ['a 429 mindshub_throttled', mindsHubThrottled, 'mindshub_throttled'],
  ])('says the ids it could not ask got %s, not an outage', async (_, response, failure) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    expect(await fetchMindsHubPeopleByIds(['u1', 'u2'])).toEqual({
      reachable: false, failure, people: [], unanswered: ['u1', 'u2'], invalid: [],
    });
  });

  /* Batches that failed differently report the failure that asking again
     can help: here the throttle, so the picker offers Retry. */
  it('reports a throttle over a refusal when its batches failed differently', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `u${i}`);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mindsHubRefused())
      .mockResolvedValueOnce(mindsHubThrottled());

    expect(await fetchMindsHubPeopleByIds(ids)).toMatchObject({
      reachable: false, failure: 'mindshub_throttled', unanswered: ids,
    });
  });

  /* cowork-server checks every id is a UUID before it asks MindsHub, and one
     bad id refuses its whole batch with 400 invalid_id. Read as "not asked",
     the batch would be asked again every few seconds, refused each time. */
  it('marks the ids a 400 invalid_id names as invalid, and asks again about the rest once', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({ code: 'invalid_id', detail: 'Each id must be a UUID.', ids: ['not-a-uuid'] }, 400))
      .mockResolvedValueOnce(jsonRes({ reachable: true, people: [{ id: 'u1', name: 'Ann', email: 'ann@acme.com' }] }));

    expect(await fetchMindsHubPeopleByIds(['u1', 'not-a-uuid', 'u2'])).toEqual({
      reachable: true,
      failure: null,
      people: [{ id: 'u1', name: 'Ann', email: 'ann@acme.com' }],
      unanswered: [],
      invalid: ['not-a-uuid'],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('ids')).toBe('u1,u2');
  });

  it('asks nothing again when every id of the batch is invalid', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      code: 'invalid_id', detail: 'Each id must be a UUID.', ids: ['bad-1', 'bad-2'],
    }, 400));

    expect(await fetchMindsHubPeopleByIds(['bad-1', 'bad-2'])).toEqual({
      reachable: true, failure: null, people: [], unanswered: [], invalid: ['bad-1', 'bad-2'],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  /* The ids lookup reads only its own code: an `invalid_email` body names
     no id, so the batch stays not asked. */
  it('reads an invalid_email answer to an ids lookup as not asked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'invalid_email', detail: 'x', ids: ['u1'], emails: ['u1'] }, 400));

    expect(await fetchMindsHubPeopleByIds(['u1'])).toEqual({
      reachable: false, failure: 'mindshub_unreachable', people: [], unanswered: ['u1'], invalid: [],
    });
  });
});

describe('fetchMindsHubPeopleByEmails', () => {
  it('asks the people route which members hold the addresses, lowercased', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      reachable: true,
      people: [
        { id: 'u2', name: 'Bo Chen', email: 'Bo@Acme.com' },
        { id: 'u-other', name: 'Not Asked', email: 'x@acme.com' },
      ],
    }));

    expect(await fetchMindsHubPeopleByEmails([' Bo@Acme.com', 'zed@partner.io', 'bo@acme.com', ''])).toEqual({
      reachable: true,
      failure: null,
      people: [{ id: 'u2', name: 'Bo Chen', email: 'bo@acme.com' }],
      unanswered: [],
      invalid: [],
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

    expect(await fetchMindsHubPeopleByEmails(emails)).toEqual({
      reachable: false,
      failure: 'mindshub_unreachable',
      people: [{ id: 'u55', name: 'P55', email: 'p55@acme.com' }],
      unanswered: emails.slice(0, 50),
      invalid: [],
    });
  });

  /* cowork-server checks every address before it asks MindsHub, and one bad
     address refuses its whole batch with 400 invalid_email. Read as
     "unreachable", every address beside it would read "couldn't check", and
     Retry would never help. */
  it('marks the addresses a 400 invalid_email names as invalid, and asks again about the rest', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonRes({
        code: 'invalid_email', detail: 'Some addresses are not valid.', emails: ['jo@acme.c', 'Bob..Smith@acme.com'],
      }, 400))
      .mockResolvedValueOnce(jsonRes({ reachable: true, people: [{ id: 'u1', name: 'Ann', email: 'ann@acme.com' }] }));

    expect(await fetchMindsHubPeopleByEmails(['ann@acme.com', 'jo@acme.c', 'bob..smith@acme.com'])).toEqual({
      reachable: true,
      failure: null,
      people: [{ id: 'u1', name: 'Ann', email: 'ann@acme.com' }],
      unanswered: [],
      invalid: ['jo@acme.c', 'bob..smith@acme.com'],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('emails')).toBe('ann@acme.com');
  });

  it('asks nothing again when every address of the batch is invalid', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({
      code: 'invalid_email', detail: 'Not valid.', emails: ['jo@acme.c'],
    }, 400));

    expect(await fetchMindsHubPeopleByEmails(['jo@acme.c'])).toEqual({
      reachable: true, failure: null, people: [], unanswered: [], invalid: ['jo@acme.c'],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads any other refusal as not asked, never as invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ code: 'too_many', detail: 'At most 200.', emails: ['a@acme.com'] }, 400));

    expect(await fetchMindsHubPeopleByEmails(['a@acme.com'])).toEqual({
      reachable: false, failure: 'mindshub_unreachable', people: [], unanswered: ['a@acme.com'], invalid: [],
    });
  });

  it.each([
    ['a 403 mindshub_refused', () => mindsHubRefused(403), 'mindshub_refused'],
    ['a 429 mindshub_throttled', mindsHubThrottled, 'mindshub_throttled'],
  ])('says the addresses it could not ask got %s, not an outage', async (_, response, failure) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    expect(await fetchMindsHubPeopleByEmails(['a@acme.com'])).toEqual({
      reachable: false, failure, people: [], unanswered: ['a@acme.com'], invalid: [],
    });
  });
});
