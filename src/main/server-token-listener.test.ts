import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { BeforeSendResponse } from 'electron';
import yaml from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';

import { PREVIEW_FRAME_NAME } from '../shared/document-preview';
import { guardDocumentPreviewFrames, type DocumentPreviewGuard, type GuardedFrame } from './document-preview-guard';
import {
  serverTokenListener,
  type ServerTokenListener,
  type ServerTokenListenerDeps,
  type SettleHeldRequest,
  type TokenRequestDetails,
} from './server-token-listener';

const SERVER_PORT = 26866;
const RESPONSES_URL = `http://127.0.0.1:${SERVER_PORT}/api/v1/responses`;
const TOKEN = 'server-token';

/* One request from server-token-listener.test.yaml. */
interface RequestCase {
  name: string;
  url: string;
  frame: 'main' | 'preview' | 'none';
  viteDevPort?: string;
  serverToken?: boolean;
  authorized: boolean;
}

function isRequestCase(value: unknown): value is RequestCase {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.name === 'string'
    && typeof entry.url === 'string'
    && (entry.frame === 'main' || entry.frame === 'preview' || entry.frame === 'none')
    && (entry.viteDevPort === undefined || typeof entry.viteDevPort === 'string')
    && (entry.serverToken === undefined || typeof entry.serverToken === 'boolean')
    && typeof entry.authorized === 'boolean';
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

/* The real guard, with a main-window frame and the preview frame inside it
   created where the guard sees them. */
function guardedFrames(): { guard: DocumentPreviewGuard; main: GuardedFrame; preview: GuardedFrame } {
  const contents = new EventEmitter();
  const guard = guardDocumentPreviewFrames(contents);
  const main: GuardedFrame = { frameTreeNodeId: 1, name: '', url: 'file:///app/index.html', parent: null };
  const preview: GuardedFrame = { frameTreeNodeId: 2, name: PREVIEW_FRAME_NAME, url: 'about:srcdoc', parent: main };
  for (const frame of [main, preview]) contents.emit('frame-created', {}, { frame });
  return { guard, main, preview };
}

/* The packaged app's listener: the server on SERVER_PORT with TOKEN, no Vite,
   and a gate that holds nothing. */
function listenerWith(overrides: Partial<ServerTokenListenerDeps> & Pick<ServerTokenListenerDeps, 'guard'>): ServerTokenListener {
  return serverTokenListener({ serverPort: () => SERVER_PORT, token: () => TOKEN, viteDevPort: null, gate: () => false, ...overrides });
}

/* Sends one request and returns the list of responses the listener hands
   Electron, which a held request adds to when it settles. */
function send(listener: ServerTokenListener, request: TokenRequestDetails): BeforeSendResponse[] {
  const responses: BeforeSendResponse[] = [];
  listener(request, (response) => responses.push(response));
  return responses;
}

const withToken = (token: string): BeforeSendResponse => ({ requestHeaders: { Authorization: `Bearer ${token}` } });
const withoutToken: BeforeSendResponse = { requestHeaders: {} };

describe('the server token listener', () => {
  it.each(loadRequestCases())('$name', (request) => {
    const { guard, main, preview } = guardedFrames();
    const listener = listenerWith({
      guard,
      viteDevPort: request.viteDevPort ?? null,
      token: () => (request.serverToken === false ? null : TOKEN),
    });
    const frame = { main, preview, none: null }[request.frame];

    expect(send(listener, { url: request.url, method: 'GET', frame, requestHeaders: {} }))
      .toEqual([request.authorized ? withToken(TOKEN) : withoutToken]);
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

  /* A response-creation request whose frame reads null once `gone` is set,
     the way Electron answers after the frame has navigated or been destroyed. */
  function vanishingFrameRequest(frame: GuardedFrame) {
    const state = { gone: false };
    const request: TokenRequestDetails = {
      url: RESPONSES_URL,
      method: 'POST',
      requestHeaders: {},
      get frame() { return state.gone ? null : frame; },
    };
    return { request, state };
  }

  it.each([
    ['a main-window request keeps the token', 'main', withToken(TOKEN)],
    ['a preview-frame request still goes without it', 'preview', withoutToken],
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

  it('reads the token when the request goes out, so a token replaced during the wait is the one sent', () => {
    const { guard, main } = guardedFrames();
    const { gate, held } = holdingGate();
    let token = 'token-before-restart';
    const responses = send(listenerWith({ guard, gate, token: () => token }), { url: RESPONSES_URL, method: 'POST', frame: main, requestHeaders: {} });

    token = 'token-after-restart';
    held[0].settle(true);

    expect(responses).toEqual([withToken('token-after-restart')]);
  });

  it('hands the gate the request and cancels it when the gate settles it as not ready', () => {
    const { guard, main } = guardedFrames();
    const { gate, held } = holdingGate();
    const token = vi.fn(() => TOKEN);
    const request: TokenRequestDetails = { url: RESPONSES_URL, method: 'POST', frame: main, requestHeaders: {} };
    const responses = send(listenerWith({ guard, gate, token }), request);
    expect(held).toHaveLength(1);
    expect(held[0].details).toBe(request);

    held[0].settle(false);

    expect(responses).toEqual([{ cancel: true }]);
    expect(token).not.toHaveBeenCalled();
  });
});
