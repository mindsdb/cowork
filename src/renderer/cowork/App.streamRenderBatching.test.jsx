// A long answer streams in many small text events. The page must redraw the
// answer per frame, not per event, or a long list blocks the main thread for
// seconds. These tests drive the real stream client (`api.js` read loop) with
// a mocked `fetch` body and count how often the live answer renders.
//
// Mounting pattern copied from App.incompleteReason.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const spies = vi.hoisted(() => ({
  fetchSessions: vi.fn(),
  fetchSession: vi.fn(),
  fetchSessionResult: vi.fn(),
  liveAnswerRenders: 0,
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok', config_ready: true })),
  fetchSessions: (...args) => spies.fetchSessions(...args),
  fetchSession: (...args) => spies.fetchSession(...args),
  fetchSessionResult: (...args) => spies.fetchSessionResult(...args),
  fetchOlderMessages: vi.fn(async () => ({ messages: [] })),
  fetchConversationList: vi.fn(async () => []),
  fetchProjects: vi.fn(async () => [{ name: 'general', path: '/tmp/general' }]),
  fetchArtifacts: vi.fn(async () => []),
  fetchSettings: vi.fn(async () => ({})),
  fetchPins: vi.fn(async () => ({ pins: [] })),
  fetchSchedules: vi.fn(async () => []),
  fetchDatasources: vi.fn(async () => ({ connections: [] })),
  fetchInFlightList: vi.fn(async () => []),
  fetchInFlightStatus: vi.fn(async () => ({ in_flight: false })),
  fetchRecommendedModels: vi.fn(async () => []),
  fetchConnector: vi.fn(async () => ({})),
  fetchSavedConnection: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => ({})),
  recordTaskVisit: vi.fn(async () => ({})),
  cancelResponse: vi.fn(async () => ({})),
  allocateConversationId: vi.fn(() => 'conv-new'),
}));

vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isElectron: false,
      isMac: () => false,
      getApiOrigin: () => 'http://localhost:1',
      openPath: vi.fn(),
      openExternal: vi.fn(),
      onUpdateStatus: () => () => {},
      onOAuthRefreshError: () => () => {},
      onMindsHubAuthChanged: () => () => {},
      getKeychainPref: vi.fn(async () => false),
      serverDiagnostics: vi.fn(async () => ({})),
      getShellUpdate: vi.fn(async () => null),
      removeCodingTask: vi.fn(async () => ({})),
    },
    getAccessToken: vi.fn(async () => null),
    getVersionInfo: vi.fn(async () => ({ app: '', ui: null, source: 'web' })),
    isElectron: false,
  };
});

// Counts renders of the answer while it is still streaming; the real
// component still renders, so what ends on screen is unchanged.
vi.mock('./components/markdown/MarkdownContent', async (importOriginal) => {
  const actual = await importOriginal();
  function CountingMarkdownContent(props) {
    if (props.complete === false && String(props.text || '').includes('River fact')) {
      spies.liveAnswerRenders += 1;
    }
    return <actual.MarkdownContent {...props} />;
  }
  return { ...actual, MarkdownContent: CountingMarkdownContent };
});

import App from './App';
import { __resetDraftsForTests } from './lib/draftStore';

const ITEMS = 220;
const encoder = new TextEncoder();

const baseTask = {
  id: 'conv-a', title: 'Alpha task', status: 'idle', projectName: 'general',
  hasMoreMessages: false, messagesCursor: null, messages: [],
};

function sse(events) {
  return encoder.encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
}

function listDeltas(from, to) {
  const deltas = [];
  for (let n = from; n <= to; n += 1) {
    deltas.push({ type: 'response.output_text.delta', delta: `${n}. River fact ${n}.\n` });
  }
  return deltas;
}

// Two network reads, each carrying half the list as one text event per item.
function stubResponsesFetch({ completes, conversationId = 'conv-a' }) {
  const half = Math.floor(ITEMS / 2);
  const reads = [
    sse([
      { type: 'response.created', conversation_id: conversationId, user_message_id: 'user-current' },
      ...listDeltas(1, half),
    ]),
    sse([
      ...listDeltas(half + 1, ITEMS),
      ...(completes ? [{ type: 'response.completed', response: { status: 'completed' } }] : []),
    ]),
  ];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (!String(url).endsWith('/responses')) throw new Error(`Unexpected fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          reads.forEach((read) => controller.enqueue(read));
          controller.close();
        },
      }),
    };
  }));
}

async function composer() {
  return waitFor(() => {
    const ta = document.querySelector('textarea');
    if (!ta) throw new Error('composer not mounted');
    return ta;
  });
}

async function send(user, text) {
  await user.click(await composer());
  await user.keyboard(text);
  await user.keyboard('{Enter}');
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  __resetDraftsForTests();
  spies.liveAnswerRenders = 0;
  spies.fetchSessions.mockReset().mockResolvedValue([
    { id: 'conv-a', title: 'Alpha task', messages: [], status: 'idle', projectName: 'general' },
  ]);
  spies.fetchSession.mockReset().mockResolvedValue({
    id: 'conv-a',
    messages: [{ id: 'user-current', role: 'user', content: 'List river facts' }],
    hasMoreMessages: false,
    messagesCursor: null,
  });
  spies.fetchSessionResult.mockReset().mockResolvedValue({ status: 'ok', task: baseTask });
});

afterEach(() => vi.unstubAllGlobals());

// The old per-event render takes 10 to 50 s here; the limit lets it fail on
// the render count instead of timing out.
describe('a long streamed answer', { timeout: 90_000 }, () => {
  it('in an open task, renders per frame rather than per text event and ends with the whole list', async () => {
    const user = userEvent.setup();
    stubResponsesFetch({ completes: true });
    render(<App />);
    await user.click(await screen.findByText('Alpha task'));

    await send(user, 'List river facts');

    expect(await screen.findByText(`River fact ${ITEMS}.`)).toBeInTheDocument();
    expect(screen.getByText('River fact 1.')).toBeInTheDocument();
    expect(spies.liveAnswerRenders).toBeLessThan(10);
  });

  it('in a new task, renders per frame rather than per text event and ends with the whole list', async () => {
    const user = userEvent.setup();
    stubResponsesFetch({ completes: true, conversationId: 'conv-new' });
    render(<App />);
    await user.click(await screen.findByText('Alpha task'));
    await user.click(screen.getByRole('button', { name: /new task/i }));

    await send(user, 'List river facts');

    expect(await screen.findByText(`River fact ${ITEMS}.`)).toBeInTheDocument();
    expect(spies.liveAnswerRenders).toBeLessThan(10);
  });

  it('keeps the text that arrived when the stream breaks before any frame drew it', async () => {
    const user = userEvent.setup();
    stubResponsesFetch({ completes: false });
    render(<App />);
    await user.click(await screen.findByText('Alpha task'));

    await send(user, 'List river facts');

    expect(await screen.findByText(/interrupted before it finished/i)).toBeInTheDocument();
    expect(screen.getByText(`River fact ${ITEMS}.`)).toBeInTheDocument();
  });
});
