import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { BeforeSendResponse, OnBeforeSendHeadersListenerDetails } from 'electron';
import yaml from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';

import { PREVIEW_FRAME_NAME } from '../shared/document-preview';
import { WINDOW_PROOF_HEADER } from '../shared/server-launch';
import { guardDocumentPreviewFrames, type DocumentPreviewGuard, type GuardedFrame } from './document-preview-guard';
import {
  gatesInOrder,
  holdWhileServerStarts,
  requireDirectRoute,
  serverTokenListener,
  type MainWindowContents,
  type RequestGate,
  type ServerTokenListener,
  type ServerTokenListenerDeps,
  type SettleHeldRequest,
  type TokenRequestDetails,
} from './server-token-listener';

const SERVER_PORT = 26866;
const RESPONSES_URL = `http://127.0.0.1:${SERVER_PORT}/api/v1/responses`;
const TOKEN = 'a1'.repeat(32);
const PROOF = 'b2'.repeat(32);
const FORGED = 'c3'.repeat(32);
const MAIN_CONTENTS_ID = 7;
const OTHER_CONTENTS_ID = 8;

type ResourceType = OnBeforeSendHeadersListenerDetails['resourceType'];
const RESOURCE_TYPES: ReadonlySet<string> = new Set<ResourceType>([
  'mainFrame', 'subFrame', 'stylesheet', 'script', 'image', 'font', 'object', 'xhr', 'ping', 'cspReport', 'media', 'webSocket', 'other',
]);

/* One request from server-token-listener.test.yaml. */
interface RequestCase {
  name: string;
  url: string;
  frame: 'main' | 'subframe' | 'preview' | 'unreadable' | 'none';
  resourceType?: ResourceType;
  webContents?: 'main' | 'other' | 'none';
  window?: 'open' | 'gone' | 'unreadable';
  bringsProof?: string;
  viteDevPort?: string;
  serverToken?: boolean;
  authorized: boolean;
  proved: boolean;
  keepsForged?: boolean;
}

const optional = (value: unknown, check: (v: unknown) => boolean): boolean => value === undefined || check(value);
const oneOf = (...values: unknown[]) => (v: unknown) => values.includes(v);
const isString = (v: unknown) => typeof v === 'string';
const isBoolean = (v: unknown) => typeof v === 'boolean';

function isRequestCase(value: unknown): value is RequestCase {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.name === 'string'
    && typeof entry.url === 'string'
    && oneOf('main', 'subframe', 'preview', 'unreadable', 'none')(entry.frame)
    && optional(entry.resourceType, (v) => typeof v === 'string' && RESOURCE_TYPES.has(v))
    && optional(entry.webContents, oneOf('main', 'other', 'none'))
    && optional(entry.window, oneOf('open', 'gone', 'unreadable'))
    && optional(entry.bringsProof, isString)
    && optional(entry.viteDevPort, isString)
    && optional(entry.serverToken, isBoolean)
    && isBoolean(entry.authorized)
    && isBoolean(entry.proved)
    && optional(entry.keepsForged, isBoolean);
}

/* Reads the requests list. Throws when it is missing or empty, or when an
   entry is not a RequestCase, so a bad file fails instead of running nothing. */
function loadRequestCases(): RequestCase[] {
  const file = resolve(__dirname, 'server-token-listener.test.yaml');
  const parsed: unknown = yaml.load(readFileSync(file, 'utf8'));
  const requests: unknown = typeof parsed === 'object' && parsed !== null && 'requests' in parsed ? parsed.requests : undefined;
  if (!Array.isArray(requests) || requests.length === 0 || !requests.every(isRequestCase)) {
    throw new Error(`${file} needs a non-empty requests list whose entries match RequestCase`);
  }
  return requests;
}

/* A frame whose every property throws, the way Electron answers once the
   frame's render frame is gone. */
function unreadableFrame(): GuardedFrame {
  const gone = (): never => { throw new Error('Render frame was disposed before WebFrameMain could be accessed'); };
  return {
    get frameTreeNodeId() { return gone(); },
    get name() { return gone(); },
    get url() { return gone(); },
    get parent() { return gone(); },
  };
}

interface Frames {
  guard: DocumentPreviewGuard;
  main: GuardedFrame;
  subframe: GuardedFrame;
  preview: GuardedFrame;
}

/* The real guard, with the main window's top-level frame, a frame inside it
   and the preview frame inside it, created where the guard sees them. */
function guardedFrames(): Frames {
  const contents = new EventEmitter();
  const guard = guardDocumentPreviewFrames(contents);
  const main: GuardedFrame = { frameTreeNodeId: 1, name: '', url: 'file:///app/index.html', parent: null };
  const preview: GuardedFrame = { frameTreeNodeId: 2, name: PREVIEW_FRAME_NAME, url: 'about:srcdoc', parent: main };
  const subframe: GuardedFrame = { frameTreeNodeId: 3, name: '', url: 'http://127.0.0.1:26866/api/v1/files/raw/page.html', parent: main };
  for (const frame of [main, preview, subframe]) contents.emit('frame-created', {}, { frame });
  return { guard, main, subframe, preview };
}

/* The main window's contents, whose top-level frame is `main` (frameTreeNodeId 1). */
const MAIN_WINDOW: MainWindowContents = { id: MAIN_CONTENTS_ID, mainFrame: { frameTreeNodeId: 1 } };

/* Contents whose top-level frame throws when read, as destroyed contents do. */
const UNREADABLE_WINDOW: MainWindowContents = {
  id: MAIN_CONTENTS_ID,
  get mainFrame(): { frameTreeNodeId: number } { throw new Error('Object has been destroyed'); },
};

/* The packaged app's listener: the server on SERVER_PORT with TOKEN and PROOF,
   the main window open, no Vite, and a gate that holds nothing. */
function listenerWith(overrides: Partial<ServerTokenListenerDeps> & Pick<ServerTokenListenerDeps, 'guard'>): ServerTokenListener {
  return serverTokenListener({
    serverPort: () => SERVER_PORT,
    token: () => TOKEN,
    windowProof: () => PROOF,
    mainWindow: () => MAIN_WINDOW,
    viteDevPort: null,
    gate: () => false,
    ...overrides,
  });
}

/* Sends one request and returns the list of responses the listener hands
   Electron, which a held request adds to when it settles. */
function send(listener: ServerTokenListener, request: TokenRequestDetails): BeforeSendResponse[] {
  const responses: BeforeSendResponse[] = [];
  listener(request, (response) => responses.push(response));
  return responses;
}

/* A fetch from the main window's top-level frame. */
function mainWindowFetch(frame: GuardedFrame, overrides: Partial<TokenRequestDetails> = {}): TokenRequestDetails {
  return { url: RESPONSES_URL, method: 'POST', frame, resourceType: 'xhr', webContentsId: MAIN_CONTENTS_ID, requestHeaders: {}, ...overrides };
}

const withToken = (token: string, proof?: string): BeforeSendResponse => ({
  requestHeaders: { Authorization: `Bearer ${token}`, ...(proof ? { [WINDOW_PROOF_HEADER]: proof } : {}) },
});
const withoutToken: BeforeSendResponse = { requestHeaders: {} };

/* A server start that has not settled yet, and the call that settles it. */
function pendingStart() {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => { settle = resolve; });
  return { settled, settle };
}

/* Lets every callback waiting on a settled promise run. */
const afterPendingCallbacks = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('the server token listener', () => {
  it.each(loadRequestCases())('$name', (request) => {
    const frames = guardedFrames();
    const listener = listenerWith({
      guard: frames.guard,
      viteDevPort: request.viteDevPort ?? null,
      token: () => (request.serverToken === false ? null : TOKEN),
      windowProof: () => (request.serverToken === false ? null : PROOF),
      mainWindow: () => ({ open: MAIN_WINDOW, gone: null, unreadable: UNREADABLE_WINDOW }[request.window ?? 'open']),
    });
    const frame = { main: frames.main, subframe: frames.subframe, preview: frames.preview, unreadable: unreadableFrame(), none: null }[request.frame];
    const webContentsId = { main: MAIN_CONTENTS_ID, other: OTHER_CONTENTS_ID, none: undefined }[request.webContents ?? 'main'];
    const brought = request.bringsProof ? { [request.bringsProof]: FORGED } : {};

    const responses = send(listener, {
      url: request.url,
      method: 'GET',
      frame,
      resourceType: request.resourceType ?? 'xhr',
      webContentsId,
      requestHeaders: { ...brought },
    });

    expect(responses).toEqual([{
      requestHeaders: {
        ...(request.keepsForged ? brought : {}),
        ...(request.authorized ? { Authorization: `Bearer ${TOKEN}` } : {}),
        ...(request.proved ? { [WINDOW_PROOF_HEADER]: PROOF } : {}),
      },
    }]);
  });

  it('leaves the headers alone when the URL does not parse', () => {
    const { guard, main } = guardedFrames();
    const request = mainWindowFetch(main, { url: 'not a url', requestHeaders: { [WINDOW_PROOF_HEADER]: FORGED } });

    expect(send(listenerWith({ guard }), request)).toEqual([{ requestHeaders: { [WINDOW_PROOF_HEADER]: FORGED } }]);
  });
});

describe('a request the gate holds', () => {
  /* A gate that holds every request and keeps what it was handed. */
  function holdingGate() {
    const held: { details: TokenRequestDetails; settle: SettleHeldRequest }[] = [];
    const gate = (details: TokenRequestDetails, settle: SettleHeldRequest): boolean => {
      held.push({ details, settle });
      return true;
    };
    return { gate, held };
  }

  /* A response-creation fetch from the main window whose frame reads null once
     `gone` is set, the way Electron answers after the frame has navigated or
     been destroyed. */
  function vanishingFrameRequest(frame: GuardedFrame) {
    const state = { gone: false };
    const request: TokenRequestDetails = {
      url: RESPONSES_URL,
      method: 'POST',
      resourceType: 'xhr',
      webContentsId: MAIN_CONTENTS_ID,
      requestHeaders: {},
      get frame() { return state.gone ? null : frame; },
    };
    return { request, state };
  }

  it.each([
    ['a main-window fetch keeps the token and the proof', 'main', withToken(TOKEN, PROOF)],
    ['a subframe fetch keeps the token and still goes without the proof', 'subframe', withToken(TOKEN)],
    ['a preview-frame request still goes without either', 'preview', withoutToken],
  ] as const)('asks about the frame before the wait, so %s after its frame is gone', (_label, which, expected) => {
    const frames = guardedFrames();
    const { gate, held } = holdingGate();
    const { request, state } = vanishingFrameRequest(frames[which]);
    const responses = send(listenerWith({ guard: frames.guard, gate }), request);
    expect(responses).toEqual([]);

    state.gone = true;
    held[0].settle(true);

    expect(responses).toEqual([expected]);
  });

  it('reads the token and the proof when the request goes out, so the ones a restart made during the wait are sent', () => {
    const { guard, main } = guardedFrames();
    const { gate, held } = holdingGate();
    let launch = { token: 'd4'.repeat(32), proof: 'e5'.repeat(32) };
    const listener = listenerWith({ guard, gate, token: () => launch.token, windowProof: () => launch.proof });
    const responses = send(listener, mainWindowFetch(main));

    launch = { token: 'f6'.repeat(32), proof: '07'.repeat(32) };
    held[0].settle(true);

    expect(responses).toEqual([withToken('f6'.repeat(32), '07'.repeat(32))]);
  });

  it('hands the gate the request and cancels it when the gate settles it as not ready', () => {
    const { guard, main } = guardedFrames();
    const { gate, held } = holdingGate();
    const token = vi.fn(() => TOKEN);
    const windowProof = vi.fn(() => PROOF);
    const request = mainWindowFetch(main);
    const responses = send(listenerWith({ guard, gate, token, windowProof }), request);
    expect(held).toHaveLength(1);
    expect(held[0].details).toBe(request);

    held[0].settle(false);

    expect(responses).toEqual([{ cancel: true }]);
    expect(token).not.toHaveBeenCalled();
    expect(windowProof).not.toHaveBeenCalled();
  });
});

describe('a request a pending server start holds', () => {
  it('waits for the start, then goes out with the values the start published', async () => {
    const { guard, main } = guardedFrames();
    const start = pendingStart();
    let launch: { token: string | null; proof: string | null } = { token: null, proof: null };
    const listener = listenerWith({
      guard,
      token: () => launch.token,
      windowProof: () => launch.proof,
      gate: holdWhileServerStarts(() => SERVER_PORT, () => start.settled),
    });
    const responses = send(listener, mainWindowFetch(main));
    expect(responses).toEqual([]);

    launch = { token: TOKEN, proof: PROOF };
    start.settle();
    await start.settled;

    expect(responses).toEqual([withToken(TOKEN, PROOF)]);
  });

  it('goes out with neither header, and is not canceled, when the start ends without trust', async () => {
    const { guard, main } = guardedFrames();
    const start = pendingStart();
    const listener = listenerWith({
      guard,
      token: () => null,
      windowProof: () => null,
      gate: holdWhileServerStarts(() => SERVER_PORT, () => start.settled),
    });
    const responses = send(listener, mainWindowFetch(main));

    start.settle();
    await start.settled;

    expect(responses).toEqual([withoutToken]);
  });

  it.each([
    ['localhost at the server\'s port', `http://localhost:${SERVER_PORT}/api/v1/conversations`],
    ['an /api/ call through Vite', 'http://localhost:5173/api/v1/conversations'],
    ['another loopback port', 'http://127.0.0.1:9999/api/v1/conversations'],
    ['a URL that does not parse', 'not a url'],
  ])('lets %s go at once', (_label, url) => {
    const { guard, main } = guardedFrames();
    const listener = listenerWith({
      guard,
      viteDevPort: '5173',
      gate: holdWhileServerStarts(() => SERVER_PORT, () => pendingStart().settled),
    });

    expect(send(listener, mainWindowFetch(main, { url }))).toHaveLength(1);
  });

  it('lets a request to the server go at once when no start is pending', () => {
    const { guard, main } = guardedFrames();
    const listener = listenerWith({ guard, gate: holdWhileServerStarts(() => SERVER_PORT, () => null) });

    expect(send(listener, mainWindowFetch(main))).toEqual([withToken(TOKEN, PROOF)]);
  });
});

describe('a request the route check holds', () => {
  /* A proxy lookup that answers when the test says so, and the URLs it was asked about. */
  function pendingLookup() {
    const asked: string[] = [];
    let answer!: (resolved: string) => void;
    let fail!: (err: Error) => void;
    const answered = new Promise<string>((resolve, reject) => { answer = resolve; fail = reject; });
    const resolveProxy = (url: string): Promise<string> => {
      asked.push(url);
      return answered;
    };
    return { resolveProxy, asked, answer, fail };
  }

  it.each([
    ['localhost at the server\'s port', `http://localhost:${SERVER_PORT}/api/v1/conversations`],
    ['another loopback port', 'http://127.0.0.1:9999/api/v1/conversations'],
    ['a URL that does not parse', 'not a url'],
  ])('lets %s go at once, without asking how it is routed', (_label, url) => {
    const { guard, main } = guardedFrames();
    const lookup = pendingLookup();
    const listener = listenerWith({ guard, gate: requireDirectRoute(() => SERVER_PORT, lookup.resolveProxy, () => {}) });

    expect(send(listener, mainWindowFetch(main, { url }))).toHaveLength(1);
    expect(lookup.asked).toEqual([]);
  });

  it('holds a request to the server until the session answers, and sends it with both headers on DIRECT', async () => {
    const { guard, main } = guardedFrames();
    const lookup = pendingLookup();
    const onFirstRefusal = vi.fn();
    const responses = send(
      listenerWith({ guard, gate: requireDirectRoute(() => SERVER_PORT, lookup.resolveProxy, onFirstRefusal) }),
      mainWindowFetch(main),
    );
    expect(lookup.asked).toEqual([RESPONSES_URL]);
    expect(responses).toEqual([]);

    lookup.answer('DIRECT');
    await afterPendingCallbacks();

    expect(responses).toEqual([withToken(TOKEN, PROOF)]);
    expect(onFirstRefusal).not.toHaveBeenCalled();
  });

  it.each(['PROXY x:1', 'PROXY a:1;DIRECT'])("cancels a request to the server routed '%s', and adds no header to it", async (resolved) => {
    const { guard, main } = guardedFrames();
    const lookup = pendingLookup();
    const token = vi.fn(() => TOKEN);
    const windowProof = vi.fn(() => PROOF);
    const onFirstRefusal = vi.fn();
    const responses = send(
      listenerWith({ guard, token, windowProof, gate: requireDirectRoute(() => SERVER_PORT, lookup.resolveProxy, onFirstRefusal) }),
      mainWindowFetch(main),
    );

    lookup.answer(resolved);
    await afterPendingCallbacks();

    expect(responses).toEqual([{ cancel: true }]);
    expect(token).not.toHaveBeenCalled();
    expect(windowProof).not.toHaveBeenCalled();
    expect(onFirstRefusal).toHaveBeenCalledTimes(1);
  });

  it('cancels a request to the server whose lookup fails, whether it rejects or throws', async () => {
    const { guard, main } = guardedFrames();
    const lookup = pendingLookup();
    const throwing = (): Promise<string> => { throw new Error('session gone'); };
    const rejected = send(listenerWith({ guard, gate: requireDirectRoute(() => SERVER_PORT, lookup.resolveProxy, () => {}) }), mainWindowFetch(main));
    const thrown = send(listenerWith({ guard, gate: requireDirectRoute(() => SERVER_PORT, throwing, () => {}) }), mainWindowFetch(main));

    lookup.fail(new Error('session gone'));
    await afterPendingCallbacks();

    expect(rejected).toEqual([{ cancel: true }]);
    expect(thrown).toEqual([{ cancel: true }]);
  });

  it('asks again for every request, so a proxy set while the app runs is refused, and reports the first refusal only', async () => {
    const { guard, main } = guardedFrames();
    const answers = ['DIRECT', 'PROXY x:1', 'PROXY x:1', 'DIRECT', 'PROXY a:1;DIRECT'];
    const resolveProxy = vi.fn(async () => answers.shift() ?? 'DIRECT');
    const onFirstRefusal = vi.fn();
    const listener = listenerWith({ guard, gate: requireDirectRoute(() => SERVER_PORT, resolveProxy, onFirstRefusal) });

    const sent = [0, 1, 2, 3, 4].map(() => send(listener, mainWindowFetch(main)));
    await afterPendingCallbacks();

    expect(resolveProxy).toHaveBeenCalledTimes(5);
    expect(sent).toEqual([
      [withToken(TOKEN, PROOF)],
      [{ cancel: true }],
      [{ cancel: true }],
      [withToken(TOKEN, PROOF)],
      [{ cancel: true }],
    ]);
    expect(onFirstRefusal).toHaveBeenCalledTimes(1);
  });

  it('runs after the gates before it, and is not asked about a request one of them cancels', () => {
    const { guard, main } = guardedFrames();
    const lookup = pendingLookup();
    const before: SettleHeldRequest[] = [];
    const holding: RequestGate = (_details, settle) => { before.push(settle); return true; };
    const listener = listenerWith({ guard, gate: gatesInOrder(holding, requireDirectRoute(() => SERVER_PORT, lookup.resolveProxy, () => {})) });

    const canceled = send(listener, mainWindowFetch(main));
    before[0](false);
    expect(canceled).toEqual([{ cancel: true }]);
    expect(lookup.asked).toEqual([]);

    const released = send(listener, mainWindowFetch(main));
    expect(lookup.asked).toEqual([]);
    before[1](true);
    expect(lookup.asked).toEqual([RESPONSES_URL]);
    expect(released).toEqual([]);
  });

  it('asks how a request is routed only once a pending server start lets it go, and cancels it when a proxy was set during the wait', async () => {
    const { guard, main } = guardedFrames();
    const start = pendingStart();
    let proxySetting = 'DIRECT';
    const resolveProxy = vi.fn(async (_url: string) => proxySetting);
    const token = vi.fn(() => TOKEN);
    const windowProof = vi.fn(() => PROOF);
    const onFirstRefusal = vi.fn();
    const listener = listenerWith({
      guard,
      token,
      windowProof,
      gate: gatesInOrder(
        holdWhileServerStarts(() => SERVER_PORT, () => start.settled),
        requireDirectRoute(() => SERVER_PORT, resolveProxy, onFirstRefusal),
      ),
    });

    const responses = send(listener, mainWindowFetch(main));
    await afterPendingCallbacks();
    expect(resolveProxy).not.toHaveBeenCalled();
    expect(responses).toEqual([]);

    proxySetting = 'PROXY x:1';
    start.settle();
    await afterPendingCallbacks();

    expect(resolveProxy).toHaveBeenCalledTimes(1);
    expect(resolveProxy).toHaveBeenCalledWith(RESPONSES_URL);
    expect(responses).toEqual([{ cancel: true }]);
    expect(token).not.toHaveBeenCalled();
    expect(windowProof).not.toHaveBeenCalled();
    expect(onFirstRefusal).toHaveBeenCalledTimes(1);
  });
});

describe('two gates in order', () => {
  /* A gate that holds every request until `settle(ready)` is called on it. */
  function heldGate() {
    const held: SettleHeldRequest[] = [];
    const gate: RequestGate = (_details, settle) => { held.push(settle); return true; };
    return { gate, held };
  }
  const passing: RequestGate = () => false;

  it('runs the second only after the first lets the request go', () => {
    const { guard, main } = guardedFrames();
    const first = heldGate();
    const second = heldGate();
    const responses = send(listenerWith({ guard, gate: gatesInOrder(first.gate, second.gate) }), mainWindowFetch(main));
    expect(second.held).toHaveLength(0);

    first.held[0](true);
    expect(second.held).toHaveLength(1);
    expect(responses).toEqual([]);

    second.held[0](true);
    expect(responses).toEqual([withToken(TOKEN, PROOF)]);
  });

  it('leaves the request to the second when the first does not hold it, and sends it when neither does', () => {
    const { guard, main } = guardedFrames();
    const second = heldGate();
    const heldBySecond = send(listenerWith({ guard, gate: gatesInOrder(passing, second.gate) }), mainWindowFetch(main));
    expect(heldBySecond).toEqual([]);
    second.held[0](false);
    expect(heldBySecond).toEqual([{ cancel: true }]);

    expect(send(listenerWith({ guard, gate: gatesInOrder(passing, passing) }), mainWindowFetch(main))).toEqual([withToken(TOKEN, PROOF)]);
  });

  it("cancels the request on the first gate's cancel without asking the second", () => {
    const { guard, main } = guardedFrames();
    const first = heldGate();
    const second = vi.fn<RequestGate>(() => false);
    const responses = send(listenerWith({ guard, gate: gatesInOrder(first.gate, second) }), mainWindowFetch(main));

    first.held[0](false);

    expect(responses).toEqual([{ cancel: true }]);
    expect(second).not.toHaveBeenCalled();
  });
});
