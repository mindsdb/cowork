import { describe, it, expect } from 'vitest';
import linear from './__fixtures__/mcp-oauth/linear.json';
import notion from './__fixtures__/mcp-oauth/notion.json';
import github from './__fixtures__/mcp-oauth/github.json';
import deepwiki from './__fixtures__/mcp-oauth/deepwiki.json';
import { GuardedFetchError, type GuardedFetch, type GuardedRequestInit } from './guarded-fetch';
import {
  discoverMcpAuth,
  exchangeCode,
  givenClient,
  McpOAuthError,
  refreshTokens,
  registerClient,
  revokeToken,
  type AuthorizationServer,
} from './mcp-oauth';

interface Recorded {
  url: string;
  method?: string;
  status?: number;
  headers?: Record<string, string | undefined>;
  json?: unknown;
  text?: string | null;
}

interface Recording {
  server_url: string;
  steps: Recorded[];
}

type Answer = { status: number; headers?: Record<string, string>; json?: unknown; text?: string };

/* A fetch that answers from a table keyed by "METHOD url", recording every
   request; anything not in the table is a 404. */
function replay(table: Record<string, Answer>) {
  const requests: Array<{ url: string; init: GuardedRequestInit }> = [];
  const fetchFn: GuardedFetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    const answer = table[`${init.method ?? 'GET'} ${url}`] ?? { status: 404, text: 'not found' };
    const body = answer.json !== undefined ? JSON.stringify(answer.json) : answer.text ?? '';
    return new Response(body, { status: answer.status, headers: answer.headers });
  };
  return { fetchFn, requests };
}

function tableOf(recording: Recording): Record<string, Answer> {
  const table: Record<string, Answer> = {};
  for (const step of recording.steps) {
    if (step.status === undefined) continue;
    const headers = Object.fromEntries(
      Object.entries(step.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    table[`${step.method ?? 'GET'} ${step.url}`] = {
      status: step.status,
      headers,
      ...(step.json !== null && step.json !== undefined ? { json: step.json } : { text: step.text ?? '' }),
    };
  }
  return table;
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof McpOAuthError || err instanceof GuardedFetchError) return err.code;
    throw err;
  }
  throw new Error('expected a failure');
}

const SERVER = 'https://mcp.example.com/mcp';
const CHALLENGE = { 'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"' };

function hostile(overrides: { resource?: unknown; servers?: unknown; asMetadata?: Record<string, unknown> }) {
  return {
    [`POST ${SERVER}`]: { status: 401, headers: CHALLENGE },
    'GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp': {
      status: 200,
      json: { resource: overrides.resource ?? SERVER, authorization_servers: overrides.servers ?? ['https://auth.example.com'] },
    },
    'GET https://auth.example.com/.well-known/oauth-authorization-server': {
      status: 200,
      json: {
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        code_challenge_methods_supported: ['S256'],
        ...overrides.asMetadata,
      },
    },
  } satisfies Record<string, Answer>;
}

describe('discoverMcpAuth on recorded servers', () => {
  it('Linear: automatic registration, resource is the server, scope from the challenge', async () => {
    const { fetchFn } = replay(tableOf(linear as Recording));
    const found = await discoverMcpAuth('https://mcp.linear.app/mcp', fetchFn);
    expect(found).toMatchObject({
      needsLogin: true,
      resource: 'https://mcp.linear.app/mcp',
      scope: 'read write',
      authorizationServer: {
        issuer: 'https://mcp.linear.app',
        registrationEndpoint: expect.stringMatching(/^https:\/\/mcp\.linear\.app\//),
        tokenEndpointAuthMethods: expect.arrayContaining(['none']),
      },
    });
  });

  it('Notion: automatic registration', async () => {
    const { fetchFn } = replay(tableOf(notion as Recording));
    const found = await discoverMcpAuth('https://mcp.notion.com/mcp', fetchFn);
    expect(found).toMatchObject({ needsLogin: true, resource: 'https://mcp.notion.com/mcp', scope: 'default' });
  });

  it('GitHub: login on another host through RFC 8414 path insertion, no registration, scopes from the metadata', async () => {
    const { fetchFn } = replay(tableOf(github as Recording));
    const found = await discoverMcpAuth('https://api.githubcopilot.com/mcp/', fetchFn);
    if (!found.needsLogin) throw new Error('expected a login');
    expect(found.resource).toBe('https://api.githubcopilot.com/mcp/');
    expect(found.authorizationServer.issuer).toBe('https://github.com/login/oauth');
    expect(new URL(found.authorizationServer.authorizationEndpoint).host).toBe('github.com');
    expect(found.authorizationServer.registrationEndpoint).toBeUndefined();
    expect(found.scope?.split(' ')).toContain('repo');
    expect(await failure(registerClient(found.authorizationServer, 'http://127.0.0.1:47295/callback', fetchFn))).toBe('needs_client_id');
  });

  it('DeepWiki: no login needed', async () => {
    const { fetchFn } = replay(tableOf(deepwiki as Recording));
    expect(await discoverMcpAuth('https://mcp.deepwiki.com/mcp', fetchFn)).toEqual({ needsLogin: false });
  });
});

describe('discoverMcpAuth against hostile answers', () => {
  it('refuses a server asking for access to another service', async () => {
    const { fetchFn } = replay(hostile({ resource: 'https://mcp.notion.com/mcp' }));
    expect(await failure(discoverMcpAuth(SERVER, fetchFn))).toBe('resource_mismatch');
  });

  it.each([
    ['a sibling path that only shares a prefix', 'https://mcp.example.com/mc'],
    ['the same path on another origin', 'https://other.example.com/mcp'],
    ['another port', 'https://mcp.example.com:8443/mcp'],
    ['a path above the server with a query', 'https://mcp.example.com/?tenant=x'],
    ['a path above the server with a user part', 'https://user@mcp.example.com/'],
    ['a path above the server with a password only', 'https://:pw@mcp.example.com/'],
    ['not a URL', 'mcp'],
  ])('refuses a resource that is %s', async (_label, resource) => {
    const { fetchFn } = replay(hostile({ resource }));
    expect(await failure(discoverMcpAuth(SERVER, fetchFn))).toBe('resource_mismatch');
  });

  it('accepts a resource that is a path above the server, ending at a segment', async () => {
    const { fetchFn } = replay(hostile({ resource: 'https://mcp.example.com/' }));
    await expect(discoverMcpAuth(SERVER, fetchFn)).resolves.toMatchObject({ resource: 'https://mcp.example.com/' });
  });

  it('refuses metadata whose issuer differs from the server named', async () => {
    const { fetchFn } = replay(hostile({ asMetadata: { issuer: 'https://evil.example.com' } }));
    expect(await failure(discoverMcpAuth(SERVER, fetchFn))).toBe('issuer_mismatch');
  });

  it.each([[{ code_challenge_methods_supported: ['plain'] }], [{ code_challenge_methods_supported: undefined }]])(
    'refuses an authorization server without S256 (%j)',
    async (asMetadata) => {
      const { fetchFn } = replay(hostile({ asMetadata }));
      expect(await failure(discoverMcpAuth(SERVER, fetchFn))).toBe('no_pkce');
    },
  );

  it.each(['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint'])(
    'refuses an http %s',
    async (field) => {
      const { fetchFn } = replay(hostile({ asMetadata: { [field]: 'http://auth.example.com/x' } }));
      expect(await failure(discoverMcpAuth(SERVER, fetchFn))).toBe('insecure_endpoint');
    },
  );

  it.each(['authorization_endpoint', 'token_endpoint'])('refuses a %s with a fragment', async (field) => {
    const { fetchFn } = replay(hostile({ asMetadata: { [field]: 'https://auth.example.com/x#frag' } }));
    expect(await failure(discoverMcpAuth(SERVER, fetchFn))).toBe('invalid_response');
  });

  it('refuses an http authorization server', async () => {
    const { fetchFn } = replay(hostile({ servers: ['http://auth.example.com'] }));
    expect(await failure(discoverMcpAuth(SERVER, fetchFn))).toBe('insecure_endpoint');
  });

  it('lets a guard refusal through, so a private endpoint is never reached', async () => {
    const recorded = replay(hostile({ servers: ['https://auth.internal'] })).fetchFn;
    const fetchFn: GuardedFetch = async (input, init) => {
      if (String(input).includes('auth.internal')) throw new GuardedFetchError('not_public', 'private');
      return recorded(input, init);
    };
    expect(await failure(discoverMcpAuth(SERVER, fetchFn))).toBe('not_public');
  });

  it('ignores a malformed challenge and finds the metadata at the path-inserted well-known URL', async () => {
    const table = hostile({});
    table[`POST ${SERVER}`] = { status: 401, headers: { 'www-authenticate': 'Bearer ,,= "unterminated' } };
    const { fetchFn } = replay(table);
    await expect(discoverMcpAuth(SERVER, fetchFn)).resolves.toMatchObject({
      resource: SERVER,
      authorizationServer: { issuer: 'https://auth.example.com' },
    });
  });

  it("takes the challenge's scope over the metadata's list", async () => {
    const table: Record<string, Answer> = hostile({});
    table[`POST ${SERVER}`] = { status: 401, headers: { 'www-authenticate': `${CHALLENGE['www-authenticate']}, scope="read"` } };
    table['GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp'] = {
      status: 200,
      json: { resource: SERVER, authorization_servers: ['https://auth.example.com'], scopes_supported: ['read', 'write', 'admin'] },
    };
    const { fetchFn } = replay(table);
    await expect(discoverMcpAuth(SERVER, fetchFn)).resolves.toMatchObject({ scope: 'read' });
  });

  it('treats a redirected metadata document as missing and falls back to the server origin', async () => {
    const { fetchFn, requests } = replay({
      [`POST ${SERVER}`]: { status: 401 },
      // Bodies that would be valid metadata, so only the status refuses them.
      'GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp': {
        status: 302,
        headers: { location: 'https://10.0.0.5/' },
        json: { resource: SERVER, authorization_servers: ['https://evil.example.com'] },
      },
      'GET https://mcp.example.com/.well-known/oauth-protected-resource': {
        status: 302,
        headers: { location: 'https://evil.example.com/' },
        json: { resource: SERVER, authorization_servers: ['https://evil.example.com'] },
      },
    });
    const found = await discoverMcpAuth(SERVER, fetchFn);
    expect(found).toMatchObject({
      needsLogin: true,
      resource: SERVER,
      authorizationServer: { issuer: 'https://mcp.example.com', tokenEndpoint: 'https://mcp.example.com/token' },
    });
    expect(requests.every((r) => r.url.startsWith('https://mcp.example.com/'))).toBe(true);
  });

  it.each([500, 502, 503, 599])('reports a server that answers %i as unreachable, not as a non-MCP address', async (status) => {
    const { fetchFn } = replay({ [`POST ${SERVER}`]: { status, text: 'oops' } });
    expect(await failure(discoverMcpAuth(SERVER, fetchFn))).toBe('unreachable');
  });
});

describe('discoverMcpAuth on a 200 answer', () => {
  const RESULT = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Example', version: '1' } };
  const answer = { jsonrpc: '2.0', id: 1, result: RESULT };
  const JSON_TYPE = { 'content-type': 'application/json' };
  const SSE_TYPE = { 'content-type': 'text/event-stream' };

  it.each([
    ['JSON', { status: 200, headers: JSON_TYPE, json: answer }],
    ['JSON with a charset', { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, json: answer }],
    ['an event stream', { status: 200, headers: SSE_TYPE, text: `event: message\r\ndata: ${JSON.stringify(answer)}\r\n\r\n` }],
    ['an event stream with a BOM', { status: 200, headers: SSE_TYPE, text: `\ufeffdata: ${JSON.stringify(answer)}\n\n` }],
    ['an event stream after a priming event and a comment', { status: 200, headers: SSE_TYPE, text: `: hi\n\nid: 0\ndata:\n\ndata: ${JSON.stringify(answer)}\n\n` }],
    ['an event stream with a notification before the reply', { status: 200, headers: SSE_TYPE, text: `data: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info"}}\n\ndata: ${JSON.stringify(answer)}\n\n` }],
    ['an event stream with mixed line endings', { status: 200, headers: SSE_TYPE, text: `data: ${JSON.stringify(answer)}\n\r\n` }],
    ['an event stream with the answer on two data lines', { status: 200, headers: SSE_TYPE, text: `data: {"jsonrpc":"2.0","id":1,\ndata: "result":${JSON.stringify(RESULT)}}\n\n` }],
  ] satisfies Array<[string, Answer]>)('accepts a server that answers as %s', async (_name, response) => {
    const { fetchFn } = replay({ [`POST ${SERVER}`]: response });
    expect(await discoverMcpAuth(SERVER, fetchFn)).toEqual({ needsLogin: false });
  });

  it('asks for an early settle and a decoded body', async () => {
    const { fetchFn, requests } = replay({ [`POST ${SERVER}`]: { status: 200, headers: JSON_TYPE, json: answer } });
    await discoverMcpAuth(SERVER, fetchFn);
    expect(requests[0].init).toMatchObject({ decodeBody: true });
    // It waits for the reply to its own request, not for the first event.
    const settle = requests[0].init.settleEarly as (data: string) => boolean;
    expect(settle(JSON.stringify(answer))).toBe(true);
    expect(settle('{"jsonrpc":"2.0","method":"notifications/message","params":{}}')).toBe(false);
    expect(settle('not json')).toBe(false);
  });

  it.each([
    ['HTML', { status: 200, headers: { 'content-type': 'text/html' }, text: '<!doctype html><title>Hi</title>' }],
    ['plain JSON', { status: 200, headers: JSON_TYPE, json: { ok: true } }],
    ['an empty body', { status: 200, headers: JSON_TYPE, text: '' }],
    ['a body that is not JSON', { status: 200, headers: JSON_TYPE, text: 'OK' }],
    ['a JSON-RPC error with no result', { status: 200, headers: JSON_TYPE, json: { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad' } } }],
    ['a result missing the server info', { status: 200, headers: JSON_TYPE, json: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {} } } }],
    ['a result that is not an object', { status: 200, headers: JSON_TYPE, json: { jsonrpc: '2.0', id: 1, result: 'ok' } }],
    ['a reply with no id', { status: 200, headers: JSON_TYPE, json: { jsonrpc: '2.0', result: RESULT } }],
    ['a reply with another id', { status: 200, headers: JSON_TYPE, json: { jsonrpc: '2.0', id: 2, result: RESULT } }],
    ['a reply with both a result and an error', { status: 200, headers: JSON_TYPE, json: { ...answer, error: { code: -1, message: 'x' } } }],
    ['an empty server info', { status: 200, headers: JSON_TYPE, json: { jsonrpc: '2.0', id: 1, result: { ...RESULT, serverInfo: {} } } }],
    ['a server info with no version', { status: 200, headers: JSON_TYPE, json: { jsonrpc: '2.0', id: 1, result: { ...RESULT, serverInfo: { name: 'x' } } } }],
    ['an event stream with a reply with another id', { status: 200, headers: SSE_TYPE, text: `data: ${JSON.stringify({ ...answer, id: 7 })}\n\n` }],
    ['an event stream with a reply that has both result and error', { status: 200, headers: SSE_TYPE, text: `data: ${JSON.stringify({ ...answer, error: {} })}\n\n` }],
    ['an event stream that ends before the event does', { status: 200, headers: SSE_TYPE, text: `data: ${JSON.stringify(answer)}\n` }],
    ['an event stream with no data', { status: 200, headers: SSE_TYPE, text: ': keep-alive\n\n' }],
    ['an event stream carrying an error', { status: 200, headers: SSE_TYPE, text: 'data: {"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"x"}}\n\n' }],
  ] satisfies Array<[string, Answer]>)('refuses a 200 with %s as not_mcp', async (_name, response) => {
    const { fetchFn } = replay({ [`POST ${SERVER}`]: response });
    expect(await failure(discoverMcpAuth(SERVER, fetchFn))).toBe('not_mcp');
  });

  it('sends the id its reply check accepts', async () => {
    const { fetchFn, requests } = replay({ [`POST ${SERVER}`]: { status: 200, headers: JSON_TYPE, json: answer } });
    await discoverMcpAuth(SERVER, fetchFn);
    const sent = JSON.parse(String(requests[0].init.body)) as { id: unknown };
    const settle = requests[0].init.settleEarly as (data: string) => boolean;
    expect(settle(JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: RESULT }))).toBe(true);
    expect(settle(JSON.stringify({ jsonrpc: '2.0', id: 'other', result: RESULT }))).toBe(false);
  });

  it('refuses a 403 or a 404 as not_mcp, and still starts a login on a 401', async () => {
    for (const status of [403, 404]) {
      expect(await failure(discoverMcpAuth(SERVER, replay({ [`POST ${SERVER}`]: { status, text: 'no' } }).fetchFn))).toBe('not_mcp');
    }
    const { fetchFn } = replay(hostile({}));
    expect(await discoverMcpAuth(SERVER, fetchFn)).toMatchObject({ needsLogin: true, resource: SERVER });
  });
});

const AS: AuthorizationServer = {
  issuer: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  registrationEndpoint: 'https://auth.example.com/register',
  revocationEndpoint: 'https://auth.example.com/revoke',
  tokenEndpointAuthMethods: ['none', 'client_secret_basic'],
};

describe('registerClient', () => {
  it('registers a public client for the redirect URI', async () => {
    const { fetchFn, requests } = replay({ 'POST https://auth.example.com/register': { status: 201, json: { client_id: 'abc' } } });
    const client = await registerClient(AS, 'http://127.0.0.1:47295/callback', fetchFn);
    expect(client).toEqual({ clientId: 'abc', authMethod: 'none' });
    const sent = JSON.parse(String(requests[0].init.body));
    expect(sent).toMatchObject({ redirect_uris: ['http://127.0.0.1:47295/callback'], token_endpoint_auth_method: 'none' });
  });

  it("asks for RFC 8414's default, client_secret_basic, when the server lists no methods", async () => {
    const { fetchFn, requests } = replay({
      'POST https://auth.example.com/register': { status: 201, json: { client_id: 'abc', client_secret: 's3' } },
    });
    const client = await registerClient({ ...AS, tokenEndpointAuthMethods: undefined }, 'http://127.0.0.1:47295/callback', fetchFn);
    expect(JSON.parse(String(requests[0].init.body)).token_endpoint_auth_method).toBe('client_secret_basic');
    expect(client).toEqual({ clientId: 'abc', clientSecret: 's3', authMethod: 'client_secret_basic' });
  });

  it('keeps an issued secret and its method', async () => {
    const { fetchFn } = replay({
      'POST https://auth.example.com/register': {
        status: 201,
        json: { client_id: 'abc', client_secret: 's3', token_endpoint_auth_method: 'client_secret_post' },
      },
    });
    await expect(registerClient(AS, 'http://127.0.0.1:47295/callback', fetchFn)).resolves.toEqual({
      clientId: 'abc', clientSecret: 's3', authMethod: 'client_secret_post',
    });
  });

  it.each([
    [{ status: 201, json: {} }],
    [{ status: 201, json: { client_id: '' } }],
    [{ status: 400, json: { error: 'invalid_redirect_uri' } }],
    [{ status: 201, text: 'not json' }],
  ])('refuses %j', async (answer) => {
    const { fetchFn } = replay({ 'POST https://auth.example.com/register': answer });
    expect(await failure(registerClient(AS, 'http://127.0.0.1:47295/callback', fetchFn))).toBe('registration_failed');
  });
});

describe('givenClient', () => {
  it('uses no client authentication without a secret', () => {
    expect(givenClient('id')).toEqual({ clientId: 'id', authMethod: 'none' });
  });
  it("defaults to RFC 7591's client_secret_basic with a secret", () => {
    expect(givenClient('id', 's', { ...AS, tokenEndpointAuthMethods: undefined })).toMatchObject({ authMethod: 'client_secret_basic' });
  });
  it('uses client_secret_post when that is all the server supports', () => {
    expect(givenClient('id', 's', { ...AS, tokenEndpointAuthMethods: ['client_secret_post'] })).toMatchObject({ authMethod: 'client_secret_post' });
  });
});

describe('token requests', () => {
  const GRANT = { code: 'c0de', codeVerifier: 'v3rifier', redirectUri: 'http://127.0.0.1:47295/callback', resource: SERVER };
  const NOW = () => 1_000_000;

  function tokenAnswer(json: unknown, status = 200) {
    return replay({ 'POST https://auth.example.com/token': { status, json } });
  }

  it('exchanges a code with PKCE, the resource and a public client', async () => {
    const { fetchFn, requests } = tokenAnswer({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'read' });
    const tokens = await exchangeCode(AS, { clientId: 'abc', authMethod: 'none' }, GRANT, fetchFn, NOW);
    expect(tokens).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1_000_000 + 3_600_000, scope: 'read' });
    const body = new URLSearchParams(String(requests[0].init.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'authorization_code', code: 'c0de', redirect_uri: GRANT.redirectUri,
      code_verifier: 'v3rifier', resource: SERVER, client_id: 'abc',
    });
  });

  it('sends Basic credentials form-encoded, and no secret in the body', async () => {
    const { fetchFn, requests } = tokenAnswer({ access_token: 'at' });
    await exchangeCode(AS, { clientId: 'a b:c', clientSecret: 's&t/u', authMethod: 'client_secret_basic' }, GRANT, fetchFn, NOW);
    const headers = requests[0].init.headers as Record<string, string>;
    expect(Buffer.from(headers.authorization.replace('Basic ', ''), 'base64').toString()).toBe('a+b%3Ac:s%26t%2Fu');
    const body = new URLSearchParams(String(requests[0].init.body));
    expect(body.has('client_secret')).toBe(false);
    expect(body.has('client_id')).toBe(false);
  });

  it('sends the secret in the body for client_secret_post', async () => {
    const { fetchFn, requests } = tokenAnswer({ access_token: 'at' });
    await exchangeCode(AS, { clientId: 'id', clientSecret: 'sec', authMethod: 'client_secret_post' }, GRANT, fetchFn, NOW);
    const body = new URLSearchParams(String(requests[0].init.body));
    expect([body.get('client_id'), body.get('client_secret')]).toEqual(['id', 'sec']);
  });

  it.each([
    [undefined, undefined],
    [0, undefined],
    [-5, undefined],
    ['abc', undefined],
    [null, undefined],
    [true, undefined],
    [[5], undefined],
    ['0x10', undefined],
    ['1e3', undefined],
    ['3600', 1_000_000 + 3_600_000],
    [60, 1_000_000 + 60_000],
    [1e300, 1_000_000 + 365 * 24 * 3_600_000],
  ])('expires_in %j gives expiresAt %j, never NaN', async (expiresIn, expected) => {
    const { fetchFn } = tokenAnswer({ access_token: 'at', expires_in: expiresIn });
    const tokens = await exchangeCode(AS, { clientId: 'id', authMethod: 'none' }, GRANT, fetchFn, NOW);
    expect(tokens.expiresAt).toBe(expected);
  });

  it('reports a refused exchange by its error code, without the answer body', async () => {
    const { fetchFn } = tokenAnswer({ error: 'invalid_grant', error_description: 'secret stuff' }, 400);
    try {
      await exchangeCode(AS, { clientId: 'id', authMethod: 'none' }, GRANT, fetchFn, NOW);
      throw new Error('expected a failure');
    } catch (err) {
      expect(err).toBeInstanceOf(McpOAuthError);
      expect((err as Error).message).toContain('invalid_grant');
      expect((err as Error).message).not.toContain('secret stuff');
    }
  });

  it.each([
    ['a line break and a secret', 'invalid_grant\nrefresh_token=rt-SECRET-VALUE client_secret=s3'],
    ['a space and a secret', 'invalid_grant refresh_token=rt-SECRET-VALUE'],
    ['an opaque value', 'a'.repeat(64)],
    ['a very long value', 'x'.repeat(3000)],
    ['a quote', 'bad"code'],
  ])('leaves out an error code holding %s', async (_label, error) => {
    const { fetchFn } = tokenAnswer({ error }, 400);
    try {
      await exchangeCode(AS, { clientId: 'id', authMethod: 'none' }, GRANT, fetchFn, NOW);
      throw new Error('expected a failure');
    } catch (err) {
      expect(err).toBeInstanceOf(McpOAuthError);
      expect((err as Error).message).toBe('the token endpoint answered 400');
    }
  });

  it.each(['Bearer', 'bearer', undefined])('accepts token_type %j', async (tokenType) => {
    const { fetchFn } = tokenAnswer({ access_token: 'at', token_type: tokenType });
    await expect(exchangeCode(AS, { clientId: 'id', authMethod: 'none' }, GRANT, fetchFn, NOW)).resolves.toMatchObject({ accessToken: 'at' });
  });

  it.each(['mac', 'DPoP', 7])('refuses token_type %j', async (tokenType) => {
    const { fetchFn } = tokenAnswer({ access_token: 'at', token_type: tokenType });
    expect(await failure(exchangeCode(AS, { clientId: 'id', authMethod: 'none' }, GRANT, fetchFn, NOW))).toBe('token_failed');
  });

  it.each([
    [400, { error: 'invalid_grant' }, 'grant_refused'],
    [400, { error: 'invalid_client' }, 'grant_refused'],
    [400, { error: 'unauthorized_client' }, 'grant_refused'],
    [401, {}, 'grant_refused'],
    [400, { error: 'invalid_request' }, 'token_failed'],
    [429, {}, 'token_failed'],
    [503, { error: 'temporarily_unavailable' }, 'token_failed'],
    [500, {}, 'token_failed'],
  ])('tells a refused grant (%i %j) from a failure worth retrying', async (status, body, code) => {
    const fetchFn: GuardedFetch = async () => new Response(JSON.stringify(body), { status });
    expect(await failure(refreshTokens(AS, { clientId: 'id', authMethod: 'none' }, { refreshToken: 'rt', resource: SERVER }, fetchFn, NOW))).toBe(code);
  });

  it('refuses an answer without an access token', async () => {
    const { fetchFn } = tokenAnswer({ token_type: 'Bearer' });
    expect(await failure(exchangeCode(AS, { clientId: 'id', authMethod: 'none' }, GRANT, fetchFn, NOW))).toBe('token_failed');
  });

  it('refreshes with the resource', async () => {
    const { fetchFn, requests } = tokenAnswer({ access_token: 'at2', refresh_token: 'rt2' });
    const tokens = await refreshTokens(AS, { clientId: 'id', authMethod: 'none' }, { refreshToken: 'rt', resource: SERVER }, fetchFn, NOW);
    expect(tokens).toEqual({ accessToken: 'at2', refreshToken: 'rt2' });
    expect(Object.fromEntries(new URLSearchParams(String(requests[0].init.body)))).toEqual({
      grant_type: 'refresh_token', refresh_token: 'rt', resource: SERVER, client_id: 'id',
    });
  });
});

describe('revokeToken', () => {
  it('revokes at the advertised endpoint', async () => {
    const { fetchFn, requests } = replay({ 'POST https://auth.example.com/revoke': { status: 200, text: '' } });
    expect(await revokeToken(AS, { clientId: 'id', authMethod: 'none' }, { token: 'rt', hint: 'refresh_token' }, fetchFn)).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(String(requests[0].init.body)))).toEqual({
      token: 'rt', token_type_hint: 'refresh_token', client_id: 'id',
    });
  });

  it('sends nothing when the server has no revocation endpoint', async () => {
    const { fetchFn, requests } = replay({});
    expect(await revokeToken({ ...AS, revocationEndpoint: undefined }, { clientId: 'id', authMethod: 'none' }, { token: 'rt', hint: 'refresh_token' }, fetchFn)).toBe(false);
    expect(requests).toEqual([]);
  });
});
