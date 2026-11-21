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
  serverTokenListener,
  type MainWindowContents,
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
