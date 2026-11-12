import { describe, expect, it, type Mock, vi } from 'vitest';
import { type BrowserDownload, type BrowserViewState, parseStepRequest, type PageSnapshot, type StepOutcome, type StepRequest } from '../shared/browser-contract';
import type { Screenshot } from './browser-screenshot';
import {
  BrowserSessions,
  IDLE_CLOSE_MS,
  MAX_LIVE_SESSIONS,
  MAX_TABS,
  MIN_VIEW_PX,
  type TabHooks,
  type TabView,
  type ViewBounds,
} from './browser-sessions';

interface FakeTab extends TabView {
  hooks: TabHooks;
  shownAt: ViewBounds | null;
  closed: boolean;
  aborts: number;
  watches: number;
  actions: StepRequest[];
  currentUrl: string;
  read: Mock<TabView['read']>;
  act: Mock<TabView['act']>;
  screenshot: Mock<TabView['screenshot']>;
}

function harness(options: { maxLive?: number } = {}) {
  let clock = 1_000_000;
  const tabs: FakeTab[] = [];
  const states: BrowserViewState[] = [];
  let release: (() => void) | null = null;
  const factory = {
    create: vi.fn((hooks: TabHooks, url: string | null): TabView => {
      const tab: FakeTab = {
        hooks,
        shownAt: null,
        closed: false,
        aborts: 0,
        watches: 0,
        actions: [],
        currentUrl: url ?? 'about:blank',
        url: () => tab.currentUrl,
        title: () => 'Title',
        loading: () => false,
        canGoBack: () => false,
        canGoForward: () => false,
        read: vi.fn<TabView['read']>(async () => ({ url: tab.currentUrl, title: 'Title', scroll: { y: 0, height: 100, viewport: 100 }, elements: [], text: '', truncated: false, challenges: [] })),
        act: vi.fn<TabView['act']>(async (request: StepRequest) => {
          tab.actions.push(request);
          if (request.step.action === 'wait') await new Promise<void>((resolve) => { release = resolve; });
          return { changed: null };
        }),
        screenshot: vi.fn<TabView['screenshot']>(async () => ({ jpeg: Buffer.from('x'), width: 10, height: 10 })),
        load: vi.fn(async (u: string) => { tab.currentUrl = u; }),
        back: vi.fn(async () => {}),
        forward: vi.fn(async () => {}),
        reload: vi.fn(async () => {}),
        show: vi.fn((b: ViewBounds) => { tab.shownAt = b; }),
        park: vi.fn(() => { tab.shownAt = null; }),
        abortInput: vi.fn(() => { tab.aborts += 1; }),
        watchSecrets: vi.fn(() => { tab.watches += 1; }),
        close: vi.fn(() => { tab.closed = true; }),
      };
      tabs.push(tab);
      return tab;
    }),
  };
  const sessions = new BrowserSessions({
    factory,
    emit: (state) => states.push(state),
    cookies: async (site) => ({ present: site === 'github.com', expiresAt: null }),
    now: () => clock,
    maxLive: options.maxLive,
  });
  sessions.setAvailable(true);
  return {
    sessions,
    tabs,
    states,
    factory,
    now: () => clock,
    advance: (ms: number) => { clock += ms; },
    release: () => release?.(),
  };
}

const step = (body: Record<string, unknown>): StepRequest => {
  const parsed = parseStepRequest(body);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
};

/* A promise the test settles itself. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

const BOUNDS = { x: 10, y: 20, width: 600, height: 700 };
/* What the pane reports while something covers it. */
const EMPTY = { x: 0, y: 0, width: 0, height: 0 };
const PAGE: PageSnapshot = { url: 'https://a.test/', title: 'Title', scroll: { y: 0, height: 100, viewport: 100 }, elements: [], text: 'what the person typed', truncated: false, challenges: [] };
const SHOT: Screenshot = { jpeg: Buffer.from('x'), width: 10, height: 10 };

describe('control', () => {
  it('lets the API hand the browser to the person, and only the person hands it back', () => {
    const { sessions } = harness();
    sessions.open('t-a', null);
    expect(sessions.control('t-a', { holder: 'human', reason: 'Sign in' })).toMatchObject({ holder: 'human', reason: 'Sign in', seq: 1, by: 'agent' });
    sessions.handBack('t-a');
    expect(sessions.info('t-a').control).toMatchObject({ holder: 'agent', seq: 2, by: 'person' });
  });

  it('takes over for the person and counts each change', () => {
    const { sessions } = harness();
    sessions.open('t-a', null);
    sessions.takeOver('t-a');
    expect(sessions.info('t-a').control).toMatchObject({ holder: 'human', seq: 1, by: 'person' });
    sessions.handBack('t-a');
    sessions.handBack('t-a');
    expect(sessions.info('t-a').control.seq).toBe(2);
  });

  it('refuses page, action, screenshot and tab calls while the person holds the browser, and still answers who holds it', async () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    sessions.takeOver('t-a');
    for (const call of [
      () => sessions.page('t-a', 100),
      () => sessions.action('t-a', step({ action: 'click', element: 1 })),
      () => sessions.screenshot('t-a', true, 70),
      () => sessions.tabs('t-a'),
      () => sessions.newTab('t-a', null),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'human_in_control', status: 409 });
    }
    expect(tabs[0].actions).toEqual([]);
    expect(sessions.info('t-a').control.holder).toBe('human');
  });

  it('cuts off a running step when the person takes over: it answers without the page, and no queued step runs after it', async () => {
    const { sessions, tabs, release } = harness();
    sessions.open('t-a', null);
    const running = sessions.action('t-a', step({ action: 'wait', ms: 1000, include_page: true }));
    const queued = sessions.action('t-a', step({ action: 'click', element: 1 }));
    await vi.waitFor(() => expect(tabs[0].actions).toHaveLength(1));
    sessions.takeOver('t-a');
    expect(tabs[0].aborts).toBe(1);
    release();
    await expect(running).resolves.toEqual({ ok: true, url: 'about:blank', changed: null });
    expect(tabs[0].read).not.toHaveBeenCalled();
    await expect(queued).rejects.toMatchObject({ code: 'human_in_control' });
    expect(tabs[0].actions).toHaveLength(1);
  });

  it("drops a step's page when the person takes over during its page read", async () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', 'https://a.test/');
    const reading = deferred<PageSnapshot>();
    tabs[0].read.mockImplementationOnce(() => reading.promise);
    const answer = sessions.action('t-a', step({ action: 'click', element: 1, include_page: true }));
    await vi.waitFor(() => expect(tabs[0].read).toHaveBeenCalled());
    sessions.takeOver('t-a');
    reading.resolve(PAGE);
    await expect(answer).resolves.toEqual({ ok: true, url: 'https://a.test/', changed: null });
  });

  it("answers a navigate without the page when a site's sign-in prompt hands the browser over during it", async () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    tabs[0].act.mockImplementationOnce(async (request) => {
      tabs[0].actions.push(request);
      await new Promise<void>((resolve) => tabs[0].hooks.login({ host: 'intranet.test', respond: () => resolve() }));
      tabs[0].currentUrl = 'https://intranet.test/';
      return { changed: true };
    });
    const answer = sessions.action('t-a', step({ action: 'navigate', url: 'https://intranet.test/', include_page: true }));
    await vi.waitFor(() => expect(sessions.stateOf('t-a')!.login).toEqual({ host: 'intranet.test' }));
    sessions.answerLogin('t-a', { username: 'ada', password: 'pw' });
    await expect(answer).resolves.toEqual({ ok: true, url: 'https://intranet.test/', changed: null });
    expect(tabs[0].read).not.toHaveBeenCalled();
    await expect(sessions.page('t-a', 100)).rejects.toMatchObject({ code: 'human_in_control', status: 409 });
  });

  it('answers 409 for a page read or screenshot in flight when the person takes over, even after their Done', async () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    const reading = deferred<PageSnapshot>();
    tabs[0].read.mockImplementationOnce(() => reading.promise);
    const page = sessions.page('t-a', 100);
    await vi.waitFor(() => expect(tabs[0].read).toHaveBeenCalled());
    sessions.takeOver('t-a');
    reading.resolve(PAGE);
    await expect(page).rejects.toMatchObject({ code: 'human_in_control', status: 409 });

    sessions.handBack('t-a');
    const capturing = deferred<Screenshot>();
    tabs[0].screenshot.mockImplementationOnce(() => capturing.promise);
    const shot = sessions.screenshot('t-a', true, 70);
    await vi.waitFor(() => expect(tabs[0].screenshot).toHaveBeenCalled());
    sessions.takeOver('t-a');
    sessions.handBack('t-a');
    capturing.resolve(SHOT);
    await expect(shot).rejects.toMatchObject({ code: 'human_in_control', status: 409 });
    await expect(sessions.screenshot('t-a', true, 70)).resolves.toEqual(SHOT);
  });

  it("watches every tab's secret fields each time the browser passes to the person", async () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    await sessions.newTab('t-a', null);
    sessions.control('t-a', { holder: 'human', reason: 'Please sign in' });
    expect(tabs.map((t) => t.watches)).toEqual([1, 1]);
    sessions.handBack('t-a');
    expect(tabs.map((t) => t.watches)).toEqual([1, 1]);
    sessions.takeOver('t-a');
    expect(tabs.map((t) => t.watches)).toEqual([2, 2]);
    sessions.handBack('t-a');
    tabs[0].hooks.login({ host: 'intranet.test', respond: vi.fn() });
    expect(tabs.map((t) => t.watches)).toEqual([3, 3]);
  });

  it('hands the browser to the person even when a tab fails to stop its step or watch its secret fields, and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    await sessions.newTab('t-a', null);
    const destroyed = () => { throw new Error('Object has been destroyed'); };
    tabs[0].abortInput = vi.fn(destroyed);
    tabs[0].watchSecrets = vi.fn(destroyed);
    expect(sessions.control('t-a', { holder: 'human', reason: 'Please sign in' })).toMatchObject({ holder: 'human', seq: 1, by: 'agent' });
    expect([tabs[1].aborts, tabs[1].watches]).toEqual([1, 1]);
    await expect(sessions.page('t-a', 100)).rejects.toMatchObject({ code: 'human_in_control', status: 409 });
    sessions.handBack('t-a');
    sessions.takeOver('t-a');
    expect(sessions.info('t-a').control).toMatchObject({ holder: 'human', seq: 3, by: 'person' });
    const events = warn.mock.calls.map(([line]) => JSON.parse(String(line)) as { logger: string; event: string });
    expect(events.filter((e) => e.logger === 'main.browser-sessions').map((e) => e.event)).toEqual([
      'browser_sessions_could_not_stop_a_step',
      'browser_sessions_could_not_watch_secret_fields',
      'browser_sessions_could_not_stop_a_step',
      'browser_sessions_could_not_watch_secret_fields',
    ]);
    warn.mockRestore();
  });

  it('refuses to close a task while the person holds it', () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    sessions.takeOver('t-a');
    expect(() => sessions.close('t-a')).toThrow(expect.objectContaining({ code: 'human_in_control', status: 409 }));
    expect(tabs[0].closed).toBe(false);
    expect(sessions.liveIds()).toEqual(['t-a']);
    sessions.handBack('t-a');
    sessions.close('t-a');
    expect(tabs[0].closed).toBe(true);
  });
});

describe('the agent API', () => {
  it("counts only the person's own take-over as theirs, for downloads", () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', 'https://a.test/');
    const hooks = tabs[0].hooks;
    expect(hooks.sessionId()).toBe('t-a');
    expect(hooks.personHolds()).toBe(false);
    sessions.control('t-a', { holder: 'human', reason: 'Please sign in' });
    expect(hooks.personHolds()).toBe(false);
    sessions.handBack('t-a');
    sessions.takeOver('t-a');
    expect(hooks.personHolds()).toBe(true);
  });

  it('opens idempotently, reads and acts on the active tab', async () => {
    const { sessions, tabs } = harness();
    expect(sessions.open('t-a', 'https://a.test/')).toEqual({ created: true, url: 'https://a.test/' });
    expect(sessions.open('t-a', 'https://b.test/')).toEqual({ created: false, url: 'https://a.test/' });
    expect(sessions.open('t-blank', null)).toEqual({ created: true, url: null });
    expect(tabs).toHaveLength(2);
    const answer = await sessions.action('t-a', step({ action: 'click', element: 1, include_page: true }));
    expect(answer).toMatchObject({ ok: true, url: 'https://a.test/', page: { url: 'https://a.test/' } });
  });

  it('opens an address the person typed: a new session at it, or the open one goes there', async () => {
    const { sessions, tabs } = harness();
    await sessions.personOpen('t-a', 'https://a.test/');
    expect(tabs).toHaveLength(1);
    expect(sessions.open('t-a', null)).toEqual({ created: false, url: 'https://a.test/' });
    await sessions.personOpen('t-a', 'https://b.test/');
    expect(tabs).toHaveLength(1);
    expect(sessions.open('t-a', null)).toEqual({ created: false, url: 'https://b.test/' });
    await expect(sessions.personOpen('t-a', 'https://cowork.mindshub.ai/')).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('opens a blank tab when the person opens the browser with no address, and leaves an open one be', async () => {
    const { sessions, tabs } = harness();
    await sessions.personOpen('t-a', null);
    expect(sessions.open('t-a', null)).toEqual({ created: false, url: null });
    await sessions.personOpen('t-a', 'https://a.test/');
    await sessions.personOpen('t-a', null);
    expect(tabs).toHaveLength(1);
    expect(sessions.open('t-a', null)).toEqual({ created: false, url: 'https://a.test/' });
  });

  it("refuses to open MindsHub's own hosts or a metadata address, saying why", async () => {
    const { sessions, tabs } = harness();
    expect(() => sessions.open('t-a', 'https://cowork.mindshub.ai/')).toThrow(expect.objectContaining({ code: 'bad_request', message: "MindsDB's sign-in and app hosts are blocked in this browser" }));
    expect(tabs).toHaveLength(0);
    sessions.open('t-a', 'https://a.test/');
    expect(() => sessions.newTab('t-a', 'http://169.254.169.254/')).toThrow(expect.objectContaining({ code: 'bad_request' }));
    expect(tabs).toHaveLength(1);
  });

  it('opens a closed task again with a blank tab when the agent uses it', async () => {
    const { sessions, tabs } = harness();
    await sessions.page('t-gone', 100);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].currentUrl).toBe('about:blank');
    expect(sessions.info('t-gone')).toMatchObject({ url: null });
    expect(() => sessions.info('t-other')).toThrow(expect.objectContaining({ code: 'not_found' }));
  });

  it('keeps no task whose first tab fails to build', () => {
    const { sessions, factory } = harness();
    factory.create.mockImplementationOnce(() => {
      throw new Error('the profile folder could not be made');
    });
    expect(() => sessions.open('t-a', null)).toThrow('the profile folder could not be made');
    expect(sessions.liveIds()).toEqual([]);
    expect(sessions.open('t-a', null)).toEqual({ created: true, url: null });
  });

  it('manages tabs: new tabs become active, closing the last leaves a blank one', async () => {
    const { sessions } = harness();
    sessions.open('t-a', 'https://a.test/');
    const tab = await sessions.newTab('t-a', 'https://b.test/');
    expect(tab).toEqual({ id: 't2', url: 'https://b.test/', title: 'Title', active: true });
    expect((await sessions.activateTab('t-a', 't1')).active).toBe(true);
    await expect(sessions.activateTab('t-a', 't9')).rejects.toMatchObject({ code: 'tab_not_found', status: 404 });
    await sessions.closeTab('t-a', 't1');
    await sessions.closeTab('t-a', 't2');
    const left = await sessions.tabs('t-a');
    expect(left).toEqual([{ id: 't3', url: 'about:blank', title: 'Title', active: true }]);
  });

  it('caps a task at 20 tabs: the 21st gets 400, and a popup past the cap closes', async () => {
    const { sessions, tabs, factory } = harness();
    expect(MAX_TABS).toBe(20);
    sessions.open('t-a', null);
    for (let i = 1; i < MAX_TABS; i += 1) await sessions.newTab('t-a', null);
    await expect(sessions.newTab('t-a', null)).rejects.toMatchObject({ code: 'bad_request', status: 400 });
    const popup = factory.create(tabs[0].hooks, null) as FakeTab;
    tabs[0].hooks.adopt(popup);
    expect(popup.closed).toBe(true);
    expect(sessions.stateOf('t-a')!.tabs).toHaveLength(MAX_TABS);
  });

  it('answers 503 for every call once the window is gone, and closes every task', async () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    sessions.setAvailable(false);
    expect(tabs[0].closed).toBe(true);
    expect(() => sessions.open('t-a', null)).toThrow(expect.objectContaining({ code: 'browser_unavailable', status: 503 }));
    await expect(async () => sessions.page('t-a', 1)).rejects.toMatchObject({ code: 'browser_unavailable' });
    expect(() => sessions.info('t-a')).toThrow(expect.objectContaining({ code: 'browser_unavailable' }));
  });

  it('reads whether the profile still holds each site\'s cookies', async () => {
    const { sessions } = harness();
    sessions.open('t-a', null);
    const sites = await sessions.sites('t-a', [{ site: 'github.com', account_hint: 'ada', noted_at: 'x' }, { site: 'gone.test', account_hint: '', noted_at: 'y' }]);
    expect(sites.map((s) => [s.site, s.cookies_present])).toEqual([['github.com', true], ['gone.test', false]]);
  });
});

describe('live tasks', () => {
  it('keeps 6 tasks live by default, and a seventh closes the least recently used', () => {
    const { sessions, advance } = harness();
    expect(MAX_LIVE_SESSIONS).toBe(6);
    for (let i = 1; i <= MAX_LIVE_SESSIONS + 1; i += 1) {
      sessions.open(`t-${i}`, null);
      advance(10);
    }
    expect(sessions.liveIds()).toEqual(['t-2', 't-3', 't-4', 't-5', 't-6', 't-7']);
  });

  it('closes the least recently used task past the cap, never the shown one or one the person holds', () => {
    const { sessions, advance } = harness({ maxLive: 3 });
    for (const id of ['t-1', 't-2', 't-3']) {
      sessions.open(id, null);
      advance(10);
    }
    sessions.show('t-1', BOUNDS);
    sessions.takeOver('t-2');
    sessions.open('t-4', null);
    expect(sessions.liveIds().sort()).toEqual(['t-1', 't-2', 't-4']);
  });

  it('refuses another task with 503 at_capacity when the pane shows or the person holds every live one', () => {
    const { sessions, tabs } = harness({ maxLive: 3 });
    sessions.open('t-1', null);
    sessions.show('t-1', BOUNDS);
    sessions.open('t-2', null);
    sessions.takeOver('t-2');
    sessions.control('t-3', { holder: 'human', reason: 'Please sign in' });
    expect(() => sessions.open('t-4', null)).toThrow(expect.objectContaining({ code: 'at_capacity', status: 503 }));
    expect(() => sessions.control('t-5', { holder: 'human', reason: 'Please sign in' })).toThrow(expect.objectContaining({ code: 'at_capacity' }));
    expect(sessions.liveIds().sort()).toEqual(['t-1', 't-2', 't-3']);
    expect(tabs).toHaveLength(3);
  });

  it('closes a task idle for 15 minutes unless it is shown or held', () => {
    const { sessions, advance, tabs } = harness();
    expect(IDLE_CLOSE_MS).toBe(15 * 60_000);
    sessions.open('t-idle', null);
    sessions.open('t-shown', null);
    sessions.open('t-held', null);
    sessions.show('t-shown', BOUNDS);
    sessions.takeOver('t-held');
    advance(IDLE_CLOSE_MS + 1);
    sessions.sweepIdle();
    expect(sessions.liveIds().sort()).toEqual(['t-held', 't-shown']);
    expect(tabs[0].closed).toBe(true);
  });

  it('keeps a task the person was browsing in when they hide the pane', () => {
    const { sessions, advance, tabs } = harness();
    sessions.open('t-a', null);
    sessions.show('t-a', BOUNDS);
    for (let minute = 0; minute < 20; minute += 1) {
      advance(60_000);
      tabs[0].hooks.personInput();
    }
    sessions.hide();
    advance(60_000);
    sessions.sweepIdle();
    expect(sessions.liveIds()).toEqual(['t-a']);
  });

  /* Each of the person's own calls on a task, after any setup it needs. */
  const personUses: Array<[string, (s: BrowserSessions, tabs: FakeTab[]) => void, (s: BrowserSessions, tabs: FakeTab[]) => unknown]> = [
    ['input in the page', () => {}, (_s, tabs) => tabs[0].hooks.personInput()],
    ['back', () => {}, (s) => s.personNavigate('t-a', 'back')],
    ['a tab switch', () => {}, (s) => s.personActivateTab('t-a', 't1')],
    ['Take over', () => {}, (s) => s.takeOver('t-a')],
    ['Done', (s) => s.takeOver('t-a'), (s) => s.handBack('t-a')],
    ['an answer to a sign-in prompt', (_s, tabs) => tabs[0].hooks.login({ host: 'intranet.test', respond: vi.fn() }), (s) => s.answerLogin('t-a', null)],
    ['hiding the pane', (s) => s.show('t-a', BOUNDS), (s) => s.hide()],
    ['showing another task', (s) => { s.show('t-a', BOUNDS); s.open('t-b', null); }, (s) => s.show('t-b', BOUNDS)],
  ];

  it.each(personUses)('counts %s as use of the task', async (_name, setup, use) => {
    const { sessions, tabs, advance, now } = harness();
    sessions.open('t-a', null);
    setup(sessions, tabs);
    advance(60_000);
    await use(sessions, tabs);
    expect(sessions.info('t-a').last_active_at).toBe(new Date(now()).toISOString());
  });

  it('tells the pane when a task it shows closes', () => {
    const { sessions, states } = harness();
    sessions.open('t-a', null);
    sessions.show('t-a', BOUNDS);
    sessions.close('t-a');
    expect(states.at(-1)).toMatchObject({ sessionId: 't-a', open: false });
    expect(sessions.show('t-a', BOUNDS)).toEqual({ exists: false, drawn: false });
  });
});

describe('the pane', () => {
  it('shows the active tab at the stage and parks the rest', async () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    await sessions.newTab('t-a', null);
    sessions.show('t-a', BOUNDS);
    expect(tabs[1].shownAt).toEqual(BOUNDS);
    expect(tabs[0].shownAt).toBeNull();
    sessions.setBounds({ ...BOUNDS, width: 500 });
    expect(tabs[1].shownAt).toMatchObject({ width: 500 });
    sessions.hide();
    expect(tabs[1].shownAt).toBeNull();
  });

  it('parks the shown tab at the last usable bounds while the stage is too small to draw in, and shows it again once it is big enough', () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    expect(sessions.show('t-a', BOUNDS)).toEqual({ exists: true, drawn: true });
    expect(sessions.setBounds({ x: 0, y: 0, width: 1, height: 1 })).toEqual({ drawn: false });
    expect(tabs[0].shownAt).toBeNull();
    expect(tabs[0].park).toHaveBeenLastCalledWith(BOUNDS);
    // A row above the stage pushes it down and squeezes it under the floor.
    expect(sessions.setBounds({ ...BOUNDS, y: BOUNDS.y + 60, height: MIN_VIEW_PX - 1 })).toEqual({ drawn: false });
    expect(tabs[0].shownAt).toBeNull();
    expect(tabs[0].park).toHaveBeenLastCalledWith(BOUNDS);
    expect(sessions.info('t-a').viewers).toBe(1);
    const grown = { ...BOUNDS, y: BOUNDS.y + 60, height: MIN_VIEW_PX };
    expect(sessions.setBounds(grown)).toEqual({ drawn: true });
    expect(tabs[0].shownAt).toEqual(grown);
    sessions.open('t-b', null);
    sessions.show('t-b', { x: 0, y: 0, width: 1, height: 1 });
    expect(tabs[1].shownAt).toBeNull();
    expect(tabs[1].park).toHaveBeenLastCalledWith(grown);
    expect(tabs[0].park).toHaveBeenLastCalledWith(grown);
  });

  it('draws nothing for a first show under the floor, never at a default place, until the stage is big enough', () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    expect(sessions.show('t-a', { x: 700, y: 180, width: 480, height: MIN_VIEW_PX - 50 })).toEqual({ exists: true, drawn: false });
    expect(tabs[0].show).not.toHaveBeenCalled();
    expect(sessions.setBounds(BOUNDS)).toEqual({ drawn: true });
    expect(tabs[0].show).toHaveBeenCalledTimes(1);
    expect(tabs[0].shownAt).toEqual(BOUNDS);
  });

  it('answers that nothing draws while the pane shows no task, at any bounds', () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    expect(sessions.setBounds(BOUNDS)).toEqual({ drawn: false });
    expect(sessions.show('t-a', BOUNDS)).toEqual({ exists: true, drawn: true });
    sessions.hide();
    expect(sessions.setBounds(BOUNDS)).toEqual({ drawn: false });
    expect(sessions.show('t-missing', BOUNDS)).toEqual({ exists: false, drawn: false });
    expect(sessions.setBounds(BOUNDS)).toEqual({ drawn: false });
    expect(tabs[0].shownAt).toBeNull();
  });

  it('keeps a task the pane shows while covered from the idle close and the live-task cap', () => {
    const { sessions, tabs, advance } = harness({ maxLive: 2 });
    // The pane opens covered, so it reports an empty rectangle.
    sessions.open('t-covered', null);
    expect(sessions.show('t-covered', EMPTY)).toEqual({ exists: true, drawn: false });
    advance(10);
    sessions.open('t-other', null);
    advance(10);
    sessions.open('t-new', null);
    expect(sessions.liveIds().sort()).toEqual(['t-covered', 't-new']);
    advance(IDLE_CLOSE_MS + 1);
    sessions.sweepIdle();
    expect(sessions.liveIds()).toEqual(['t-covered']);
    expect(tabs[0].show).not.toHaveBeenCalled();
    expect(sessions.info('t-covered').viewers).toBe(1);
  });

  it('opens a popup in the background while the agent holds the browser, in front for the person', () => {
    const { sessions, tabs, factory } = harness();
    sessions.open('t-a', null);
    sessions.show('t-a', BOUNDS);
    const popup = factory.create(tabs[0].hooks, null) as FakeTab;
    tabs[0].hooks.adopt(popup);
    expect(sessions.stateOf('t-a')!.tabs.map((t) => [t.id, t.active])).toEqual([['t1', true], ['t2', false]]);
    sessions.takeOver('t-a');
    const second = factory.create(tabs[0].hooks, null) as FakeTab;
    tabs[0].hooks.adopt(second);
    expect(sessions.stateOf('t-a')!.tabs.find((t) => t.active)!.id).toBe('t3');
    expect(second.shownAt).toEqual(BOUNDS);
  });

  it('allows a popup only right after an agent step or the person\'s input', async () => {
    const { sessions, tabs, advance } = harness();
    sessions.open('t-a', null);
    expect(tabs[0].hooks.popupAllowed()).toBe(false);
    await sessions.action('t-a', step({ action: 'click', element: 1 }));
    expect(tabs[0].hooks.popupAllowed()).toBe(true);
    advance(1001);
    expect(tabs[0].hooks.popupAllowed()).toBe(false);
    tabs[0].hooks.personInput();
    expect(tabs[0].hooks.popupAllowed()).toBe(true);
  });

  it("ends the popup window 1 s after a step's input, not after the settle that follows it", async () => {
    const { sessions, tabs, advance } = harness();
    sessions.open('t-a', null);
    const settling = deferred<StepOutcome>();
    tabs[0].act.mockImplementationOnce(async (_request, onInputDone) => {
      onInputDone?.();
      return settling.promise;
    });
    const click = sessions.action('t-a', step({ action: 'click', element: 1 }));
    await vi.waitFor(() => expect(tabs[0].act).toHaveBeenCalled());
    expect(tabs[0].hooks.popupAllowed()).toBe(true);
    advance(1001);
    expect(tabs[0].hooks.popupAllowed()).toBe(false);
    settling.resolve({ changed: true });
    await expect(click).resolves.toEqual({ ok: true, url: 'about:blank', changed: true });
    expect(tabs[0].hooks.popupAllowed()).toBe(false);
  });

  it("answers whether the step changed the page, and can't tell once the person took the browser during the step or its read", async () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', 'https://a.test/');
    tabs[0].act.mockResolvedValueOnce({ changed: false });
    await expect(sessions.action('t-a', step({ action: 'click', element: 1, include_page: true }))).resolves.toMatchObject({ ok: true, changed: false, page: { url: 'https://a.test/' } });
    tabs[0].act.mockResolvedValueOnce({ changed: true });
    tabs[0].read.mockImplementationOnce(async () => {
      sessions.takeOver('t-a');
      return PAGE;
    });
    await expect(sessions.action('t-a', step({ action: 'click', element: 1, include_page: true }))).resolves.toEqual({ ok: true, url: 'https://a.test/', changed: null });
    sessions.handBack('t-a');
    tabs[0].act.mockImplementationOnce(async () => {
      sessions.takeOver('t-a');
      return { changed: true };
    });
    await expect(sessions.action('t-a', step({ action: 'click', element: 1 }))).resolves.toEqual({ ok: true, url: 'https://a.test/', changed: null });
  });

  it("allows a popup while the agent's input step runs, but not through a wait", async () => {
    const { sessions, tabs, advance, release } = harness();
    sessions.open('t-a', null);
    const waiting = sessions.action('t-a', step({ action: 'wait', ms: 30_000 }));
    await vi.waitFor(() => expect(tabs[0].actions).toHaveLength(1));
    expect(tabs[0].hooks.popupAllowed()).toBe(false);
    release();
    await waiting;
    advance(1001);
    const clicking = deferred<StepOutcome>();
    tabs[0].act.mockImplementationOnce(() => clicking.promise);
    const click = sessions.action('t-a', step({ action: 'click', element: 1 }));
    await vi.waitFor(() => expect(tabs[0].act).toHaveBeenCalledTimes(2));
    expect(tabs[0].hooks.popupAllowed()).toBe(true);
    clicking.resolve({ changed: null });
    await click;
  });

  it('hands a sign-in prompt to the person and passes only their answer on', () => {
    const { sessions, tabs, states } = harness();
    sessions.open('t-a', null);
    const respond = vi.fn();
    tabs[0].hooks.login({ host: 'intranet.test', respond });
    expect(sessions.info('t-a').control).toMatchObject({ holder: 'human', reason: 'intranet.test asks for a username and password.', by: 'agent' });
    expect(tabs[0].hooks.personHolds()).toBe(false);
    expect(states.at(-1)!.login).toEqual({ host: 'intranet.test' });
    sessions.answerLogin('t-a', { username: 'ada', password: 'pw' });
    expect(respond).toHaveBeenCalledWith({ username: 'ada', password: 'pw' });
    expect(JSON.stringify(states)).not.toContain('pw"');
    expect(states.at(-1)!.login).toBeNull();
  });

  it("keeps the person's own take over theirs when a site's sign-in prompt arrives during it", () => {
    const { sessions, tabs } = harness();
    sessions.open('t-a', null);
    sessions.takeOver('t-a');
    tabs[0].hooks.login({ host: 'intranet.test', respond: vi.fn() });
    expect(sessions.info('t-a').control).toMatchObject({ holder: 'human', reason: 'intranet.test asks for a username and password.', by: 'person' });
    expect(tabs[0].hooks.personHolds()).toBe(true);
  });

  it('keeps every download still waiting for an answer, and the newest five of the rest', () => {
    const { sessions, tabs, states } = harness();
    sessions.open('t-a', null);
    const download = (id: string, state: BrowserDownload['state']): BrowserDownload => ({ id, name: `${id}.pdf`, folder: '/Downloads/Cowork browser', state });
    tabs[0].hooks.download(download('waiting', 'waiting'));
    for (let i = 1; i <= 6; i += 1) tabs[0].hooks.download(download(`done-${i}`, 'completed'));
    expect(states.at(-1)!.downloads.map((d) => d.id)).toEqual(['done-6', 'done-5', 'done-4', 'done-3', 'done-2', 'waiting']);
  });

  it('ignores the person\'s calls for a task that is not open', async () => {
    const { sessions } = harness();
    sessions.takeOver('t-none');
    sessions.handBack('t-none');
    await sessions.personNavigate('t-none', 'back');
    expect(sessions.liveIds()).toEqual([]);
  });
});
