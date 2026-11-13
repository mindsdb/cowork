/*
 * The in-app host against anton's contract fixtures: every request example
 * goes through the real bridge, and every answer must fit the shape anton
 * reads it with (tests/browser-contract-shapes.ts, which the fixture test
 * proves against anton's own response examples). action.json's focused type
 * also runs through the real step code (runStep) over a fake debugger
 * (tests/browser-fake-cdp.ts), so a focus that leaves its field mid-type
 * answers the codes and statuses action.json and error.json name.
 */

import * as http from 'http';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeError, type BridgeErrorCode, MAX_SAVED_TABS_PER_PROJECT, type StepRequest } from '../shared/browser-contract';
import { type Bridge, startBridge } from './browser-bridge';
import { type Navigation, type PageReader, runStep, type StepHost, withAgentInput } from './browser-input';
import { MAX_LIVE_SESSIONS } from './browser-sessions';
import { fakeCdpDebugger, type FakeCdpDebugger, type FakeFrame } from '../../tests/browser-fake-cdp';
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

const errorStatus = Object.fromEntries(examples('error.json').map(([name, e]) => [name, e.status]));

describe('the in-app host against the contract fixtures', () => {
  it.each(requests)('%s "%s": the host answers in the contract', async (file, _name, example) => {
    const [method, route] = concrete(example.where);
    const reply = await call(method, route, example.body);
    if (example.refused) {
      expect(reply.status).toBeGreaterThanOrEqual(400);
      expect(problems(errorShape, reply.body)).toEqual([]);
      // action.json refuses each step it marks refused with 400 bad_request.
      if (file === 'action.json') {
        expect(reply.status).toBe(errorStatus.bad_request);
        expect((reply.body as { error: string }).error).toBe('bad_request');
        expect(host.factory.tabs[0].actions).toEqual([]);
      }
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

  it.each(hostErrors)('answers %s with the fixture\'s status and shape', async (code, raise) => {
    const reply = await raise();
    expect(reply.status).toBe(errorStatus[code]);
    expect(problems(errorShape, reply.body)).toEqual([]);
    expect((reply.body as { error: string }).error).toBe(code);
  });
});

/* A type with focused true reads the focus through the debugger alone
   (FrameReads.focusedField), so its step host's page reader and navigation
   are never asked. */
const neverAsked = async (): Promise<never> => {
  throw new Error('a focused type reads the focus through the debugger alone');
};
const NO_PAGE_READER: PageReader = {
  locate: neverAsked, focusedSecret: neverAsked, typingFocus: neverAsked, focusField: neverAsked,
  focus: neverAsked, select: neverAsked, viewport: neverAsked, hitTest: neverAsked, secretAt: neverAsked,
};
const NO_NAVIGATION: Navigation = { load: neverAsked, back: neverAsked, forward: neverAsked, reload: neverAsked };

/* The text the page's keys typed, in order. */
const typedText = (dbg: FakeCdpDebugger): string => dbg.sent
  .filter(([method, params]) => method === 'Input.dispatchKeyEvent' && params.type === 'keyDown')
  .map(([, params]) => params.text).join('');

describe("a focused type whose focus leaves its field before it is all typed (action.json's focused type, error.json's codes)", () => {
  const focusedType = examples('action.json').find(([name]) => name === 'type into the focused field')![1].body as Record<string, unknown>;

  /* The open session's tab runs each step through the real runStep over a
     fake debugger whose page holds the focus on text entry 3 of its main
     frame, and moves it as `to` says once `after` keys are in. */
  function focusMovesAfter(after: number, to: Partial<FakeFrame>): FakeCdpDebugger {
    const dbg = fakeCdpDebugger({ main: { entry: 3 } });
    const send = dbg.sendCommand;
    dbg.sendCommand = async (method, params, sessionId) => {
      if (typedText(dbg).length >= after) Object.assign(dbg.page.frames[0], to);
      return send(method, params, sessionId);
    };
    const pacing = { sleep: async () => {}, random: () => 0.5 };
    const stepHost: StepHost = {
      page: NO_PAGE_READER,
      nav: NO_NAVIGATION,
      pacing,
      withInput: async (run) => (await withAgentInput(dbg, { x: 0, y: 0 }, pacing, run)).result,
    };
    vi.mocked(host.factory.tabs[0].act).mockImplementation(async (request: StepRequest) => {
      await runStep(stepHost, request);
      return { changed: null };
    });
    return dbg;
  }

  it.each([
    ['another text field', 'stale_element', { entry: 4 }],
    ['an element that takes no text', 'stale_element', { entry: undefined }],
    ['a secret field', 'password_field', { entry: undefined, focus: { secret: true, otherSite: false, sealed: false } }],
    ['a field named for a card', 'password_field', { entry: undefined, cardNamed: true }],
  ] as const)('stops once the focus moves to %s, keeps what it typed and answers the fixture\'s %s', async (_where, code, to) => {
    const dbg = focusMovesAfter(3, to);
    const reply = await call('POST', `/sessions/${SESSION}/action`, focusedType);
    expect(reply.status, JSON.stringify(reply.body)).toBe(errorStatus[code]);
    expect(problems(errorShape, reply.body)).toEqual([]);
    expect((reply.body as { error: string }).error).toBe(code);
    // The first three keys stay typed, and nothing is deleted.
    expect(typedText(dbg)).toBe(String(focusedType.text).slice(0, 3));
    expect(dbg.sent.some(([method, params]) => method === 'Input.dispatchKeyEvent' && params.key === 'Backspace')).toBe(false);
  });

  it('reads the focus again before the Enter submit adds, and presses no Enter once it left the field', async () => {
    const text = String(focusedType.text);
    const dbg = focusMovesAfter(text.length, { entry: 4 });
    const reply = await call('POST', `/sessions/${SESSION}/action`, { ...focusedType, submit: true });
    expect(reply.status, JSON.stringify(reply.body)).toBe(errorStatus.stale_element);
    expect((reply.body as { error: string }).error).toBe('stale_element');
    expect(typedText(dbg)).toBe(text);
    expect(dbg.sent.some(([method, params]) => method === 'Input.dispatchKeyEvent' && params.key === 'Enter')).toBe(false);
  });

  it('types the whole text when the focus stays in the field', async () => {
    const dbg = focusMovesAfter(Number.POSITIVE_INFINITY, {});
    const reply = await call('POST', `/sessions/${SESSION}/action`, focusedType);
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    expect(typedText(dbg)).toBe(String(focusedType.text));
  });
});

function requestBodyFor(where: string): unknown {
  const request = [...requests].find(([, , e]) => e.where === where && !e.refused);
  return request ? request[2].body : {};
}
