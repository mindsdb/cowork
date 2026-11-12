/*
 * The in-app host against anton's contract fixtures: every request example
 * goes through the real bridge, and every answer must fit the shape anton
 * reads it with (tests/browser-contract-shapes.ts, which the fixture test
 * proves against anton's own response examples).
 */

import * as http from 'http';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BridgeError, type BridgeErrorCode, MAX_SAVED_TABS_PER_PROJECT } from '../shared/browser-contract';
import { type Bridge, startBridge } from './browser-bridge';
import { MAX_LIVE_SESSIONS } from './browser-sessions';
import { fakeHost } from '../../tests/browser-fake-tabs';
import {
  errorShape,
  type FixtureExample,
  type FixtureFile,
  problems,
  RESPONSE_SHAPES,
} from '../../tests/browser-contract-shapes';

const FIXTURES = path.resolve(__dirname, '__fixtures__/browser-contract');
const SESSION = 't-0123456789abcdef01234567';
const PROJECT = 'p-89abcdef0123456789abcdef';

function examples(file: string): Array<[string, FixtureExample]> {
  const parsed = JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf-8')) as FixtureFile;
  return Object.entries(parsed.examples);
}

let bridge: Bridge;
let token: string;
let host: ReturnType<typeof fakeHost>;

function call(method: string, route: string, body?: unknown, key = token): Promise<{ status: number; body: unknown }> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: bridge.port,
      method,
      path: route,
      headers: { authorization: `Bearer ${key}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode ?? 0, body: res.headers['content-type']?.startsWith('application/json') ? JSON.parse(text) : text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* A concrete call for each `where` the fixtures name. */
function concrete(where: string): [string, string] {
  const [method, template] = where.split(' ');
  const route = template
    .replace('{id}', SESSION)
    .replace('{tab}', 't1')
    .replace('{project}', PROJECT)
    .replace('{name}', encodeURIComponent('Q3 pipeline report'));
  return [method, route];
}

beforeEach(async () => {
  token = randomBytes(32).toString('base64url');
  host = fakeHost();
  bridge = await startBridge({ token: () => token, sessions: host.sessions, store: () => host.store });
  await call('POST', '/sessions', { session_id: SESSION, url: 'https://shop.example.test/' });
  await call('POST', '/saved-tabs', { project: PROJECT, name: 'Q3 pipeline report', url: 'https://crm.example.test/reports/q3', notes: '' });
});

afterEach(async () => {
  await bridge.close();
  host.cleanup();
});

const requests = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))
  .flatMap((file) => examples(file).map(([name, e]): [string, string, FixtureExample] => [file, name, e]))
  .filter(([, , e]) => e.kind === 'request');

const responses = readdirSync(FIXTURES).filter((f) => f.endsWith('.json') && f !== 'error.json')
  .flatMap((file) => examples(file).map(([name, e]): [string, string, FixtureExample] => [file, name, e]))
  .filter(([, , e]) => e.kind === 'response');

describe('the in-app host against the contract fixtures', () => {
  it.each(requests)('%s "%s": the host answers in the contract', async (_file, _name, example) => {
    const [method, route] = concrete(example.where);
    const reply = await call(method, route, example.body);
    if (example.refused) {
      expect(reply.status).toBeGreaterThanOrEqual(400);
      expect(problems(errorShape, reply.body)).toEqual([]);
      return;
    }
    // POST /sessions answers 201 for a new session and 200 for one already open.
    expect(example.where === 'POST /sessions' ? [200, 201] : [200], JSON.stringify(reply.body)).toContain(reply.status);
    expect(problems(RESPONSE_SHAPES[example.where], reply.body)).toEqual([]);
  });

  it.each(responses)('%s "%s": the host\'s own answer fits the same shape', async (_file, _name, example) => {
    const [method, route] = concrete(example.where);
    const body = method === 'POST' ? requestBodyFor(example.where) : undefined;
    const reply = await call(method, route, body);
    expect(example.where === 'POST /sessions' ? [200, 201] : [200], JSON.stringify(reply.body)).toContain(reply.status);
    expect(problems(RESPONSE_SHAPES[example.where], reply.body)).toEqual([]);
  });

  /* The error codes this host sends, each raised where the host raises it. */
  const hostErrors: Array<[BridgeErrorCode, () => Promise<{ status: number; body: unknown }>]> = [
    ['unauthorized', () => call('GET', `/sessions/${SESSION}`, undefined, randomBytes(32).toString('base64url'))],
    ['person_only', () => call('POST', `/sessions/${SESSION}/control`, { holder: 'agent', reason: '' })],
    ['bad_request', () => call('POST', `/sessions/${SESSION}/action`, { action: 'click' })],
    ['tab_not_found', () => call('POST', `/sessions/${SESSION}/tabs/t9/activate`)],
    ['human_in_control', async () => {
      await call('POST', `/sessions/${SESSION}/control`, { holder: 'human', reason: 'Please sign in' });
      return call('GET', `/sessions/${SESSION}/page`);
    }],
    ...(['password_field', 'not_a_text_field', 'focus_unreadable', 'stale_element', 'page_blocked', 'page_busy'] as const).map((code): [BridgeErrorCode, () => Promise<{ status: number; body: unknown }>] => [code, () => {
      (host.factory.tabs[0].act as unknown as { mockRejectedValueOnce(e: Error): void }).mockRejectedValueOnce(new BridgeError(code, 'refused'));
      return call('POST', `/sessions/${SESSION}/action`, { action: 'click', element: 3 });
    }]),
    ['too_many_saved_tabs', () => {
      for (let i = 0; i < MAX_SAVED_TABS_PER_PROJECT; i += 1) host.store.saveTab('full', { name: `tab ${i}`, url: 'https://shop.example.test/', notes: '' });
      return call('POST', '/saved-tabs', { project: 'full', name: 'one more', url: 'https://shop.example.test/', notes: '' });
    }],
    ['browser_unavailable', () => {
      host.sessions.setAvailable(false);
      return call('GET', `/sessions/${SESSION}/page`);
    }],
    ['at_capacity', async () => {
      for (let i = 0; i < MAX_LIVE_SESSIONS; i += 1) {
        await call('POST', `/sessions/t-held-${i}/control`, { holder: 'human', reason: 'Please sign in' });
      }
      return call('POST', '/sessions', { session_id: 't-one-more', url: null });
    }],
  ];

  const errorStatus = Object.fromEntries(examples('error.json').map(([name, e]) => [name, e.status]));

  it.each(hostErrors)('answers %s with the fixture\'s status and shape', async (code, raise) => {
    const reply = await raise();
    expect(reply.status).toBe(errorStatus[code]);
    expect(problems(errorShape, reply.body)).toEqual([]);
    expect((reply.body as { error: string }).error).toBe(code);
  });
});

function requestBodyFor(where: string): unknown {
  const request = [...requests].find(([, , e]) => e.where === where && !e.refused);
  return request ? request[2].body : {};
}
