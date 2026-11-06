import { describe, expect, it, vi } from 'vitest';
import { type BrowserViewState, parseStepRequest, type StepRequest } from '../shared/browser-contract';
import {
  BrowserSessions,
  IDLE_CLOSE_MS,
  type TabHooks,
  type TabView,
  type ViewBounds,
} from './browser-sessions';

interface FakeTab extends TabView {
  hooks: TabHooks;
  shownAt: ViewBounds | null;
  closed: boolean;
  aborts: number;
  actions: StepRequest[];
  currentUrl: string;
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
        actions: [],
        currentUrl: url ?? 'about:blank',
        url: () => tab.currentUrl,
        title: () => 'Title',
        loading: () => false,
        canGoBack: () => false,
        canGoForward: () => false,
        read: vi.fn(async () => ({ url: tab.currentUrl, title: 'Title', scroll: { y: 0, height: 100, viewport: 100 }, elements: [], text: '', truncated: false, challenges: [] })),
        act: vi.fn(async (request: StepRequest) => {
          tab.actions.push(request);
          if (request.step.action === 'wait') await new Promise<void>((resolve) => { release = resolve; });
        }),
        screenshot: vi.fn(async () => ({ jpeg: Buffer.from('x'), width: 10, height: 10 })),
        load: vi.fn(async (u: string) => { tab.currentUrl = u; }),
        back: vi.fn(async () => {}),
        forward: vi.fn(async () => {}),
        reload: vi.fn(async () => {}),
        show: vi.fn((b: ViewBounds) => { tab.shownAt = b; }),
        park: vi.fn(() => { tab.shownAt = null; }),
        abortInput: vi.fn(() => { tab.aborts += 1; }),
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
    advance: (ms: number) => { clock += ms; },
    release: () => release?.(),
  };
}

const step = (body: Record<string, unknown>): StepRequest => {
  const parsed = parseStepRequest(body);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
};

const BOUNDS = { x: 10, y: 20, width: 600, height: 700 };

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

  it('cuts off a running step when the person takes over, and runs no queued step after it', async () => {
    const { sessions, tabs, release } = harness();
    sessions.open('t-a', null);
    const running = sessions.action('t-a', step({ action: 'wait', ms: 1000 }));
    const queued = sessions.action('t-a', step({ action: 'click', element: 1 }));
    await vi.waitFor(() => expect(tabs[0].actions).toHaveLength(1));
    sessions.takeOver('t-a');
    expect(tabs[0].aborts).toBe(1);
    release();
    await running;
    await expect(queued).rejects.toMatchObject({ code: 'human_in_control' });
    expect(tabs[0].actions).toHaveLength(1);
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

  it('closes a task idle for 15 minutes unless it is shown or held', () => {
    const { sessions, advance, tabs } = harness();
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

  it('tells the pane when a task it shows closes', () => {
    const { sessions, states } = harness();
    sessions.open('t-a', null);
    sessions.show('t-a', BOUNDS);
    sessions.close('t-a');
    expect(states.at(-1)).toMatchObject({ sessionId: 't-a', open: false });
    expect(sessions.show('t-a', BOUNDS)).toEqual({ exists: false });
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

  it('hands a sign-in prompt to the person and passes only their answer on', () => {
    const { sessions, tabs, states } = harness();
    sessions.open('t-a', null);
    const respond = vi.fn();
    tabs[0].hooks.login({ host: 'intranet.test', respond });
    expect(sessions.info('t-a').control).toMatchObject({ holder: 'human', reason: 'intranet.test asks for a username and password.' });
    expect(states.at(-1)!.login).toEqual({ host: 'intranet.test' });
    sessions.answerLogin('t-a', { username: 'ada', password: 'pw' });
    expect(respond).toHaveBeenCalledWith({ username: 'ada', password: 'pw' });
    expect(JSON.stringify(states)).not.toContain('pw"');
    expect(states.at(-1)!.login).toBeNull();
  });

  it('ignores the person\'s calls for a task that is not open', async () => {
    const { sessions } = harness();
    sessions.takeOver('t-none');
    sessions.handBack('t-none');
    await sessions.personNavigate('t-none', 'back');
    expect(sessions.liveIds()).toEqual([]);
  });
});
