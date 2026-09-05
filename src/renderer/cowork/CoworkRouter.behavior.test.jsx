// Exercise the real route config and URL/state bridge with a memory router and a test context; pure
// helpers are tested separately.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router-dom';

// fetchSessionResult is the loader's only server dependency — mock it so each
// test can pin a status (ok / not_found / unavailable).
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSessionResult: vi.fn(),
}));

import { fetchSessionResult } from './api';
import {
  routes,
  CoworkProvider,
  markOptimisticConversation,
  clearOptimisticConversation,
} from './CoworkRouter';

function makeHarness(initialNav, opts = {}) {
  // Whether a given project id resolves from the fetched list. Default: found.
  // `false` exercises the missing-detail path (route element replaces the URL).
  const projectExists = opts.projectExists || (() => true);
  const ctl = {
    setNav: null,
    openConversation: vi.fn(),
    enterHome: vi.fn(),
    enterRoute: vi.fn(),
    enterProjectDetail: vi.fn(),
    enterScheduleDetail: vi.fn(),
  };
  function Harness({ router }) {
    const [nav, setNav] = useState(initialNav);
    ctl.setNav = setNav;
    const value = {
      shell: <div data-testid="shell"><Outlet /></div>,
      route: nav.route,
      activeTaskId: nav.activeTaskId ?? null,
      selectedProjectId: nav.selectedProjectId ?? null,
      selectedScheduleId: nav.selectedScheduleId ?? null,
      // Mirror AppCore's navigation handlers while recording conversation opens instead of
      // hydrating them.
      enterHome: () => { ctl.enterHome(); setNav({ route: 'home' }); },
      enterRoute: (k) => { ctl.enterRoute(k); setNav({ route: k }); },
      openConversation: (id, loaded) => { ctl.openConversation(id, loaded); },
      // Resolves to found/not-found so the route element can replace a dead
      // detail URL — the real enterProjectDetail has the same contract.
      enterProjectDetail: (id) => {
        ctl.enterProjectDetail(id);
        const found = projectExists(id);
        if (found) setNav({ route: 'projects', selectedProjectId: id });
        return Promise.resolve(found);
      },
      enterScheduleDetail: (id) => { ctl.enterScheduleDetail(id); setNav({ route: 'schedule-detail', selectedScheduleId: id }); },
    };
    return (
      <CoworkProvider value={value}>
        <RouterProvider router={router} />
      </CoworkProvider>
    );
  }
  return { ctl, Harness };
}

function renderAt(initialEntries, initialNav, opts = {}) {
  const router = createMemoryRouter(routes, { initialEntries, initialIndex: initialEntries.length - 1 });
  const { ctl, Harness } = makeHarness(initialNav, opts);
  render(<Harness router={router} />);
  return { router, ctl };
}

beforeEach(() => {
  fetchSessionResult.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('conversation loader failure handling (ENG-1233 Major 2)', () => {
  it('opens a resolvable conversation from the loader task', async () => {
    fetchSessionResult.mockResolvedValue({ status: 'ok', task: { id: 'known', messages: [] } });
    const { router, ctl } = renderAt(['/c/known'], { route: 'task', activeTaskId: 'known' });

    await waitFor(() => expect(ctl.openConversation).toHaveBeenCalled());
    const [id, loaded] = ctl.openConversation.mock.calls.at(-1);
    expect(id).toBe('known');
    expect(loaded.task).toEqual({ id: 'known', messages: [] });
    expect(router.state.location.pathname).toBe('/c/known');
  });

  it('redirects a 404 deep link Home without trapping the dead URL in history', async () => {
    // Loader redirects run before the destination commits: push preserves the origin without adding
    // the dead URL; replace would lose the origin.
    fetchSessionResult.mockResolvedValue({ status: 'not_found' });
    const { router, ctl } = renderAt(['/projects'], { route: 'projects' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'));

    await act(async () => { await router.navigate('/c/missing'); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(ctl.enterHome).toHaveBeenCalled();

    // Back returns to the origin, not the dead conversation.
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'));

    // Forward does NOT resurrect /c/missing — it never entered history.
    await act(async () => { await router.navigate(1); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('keeps the URL and flags unavailable on a transient failure (does NOT redirect home)', async () => {
    fetchSessionResult.mockResolvedValue({ status: 'unavailable', code: 500 });
    const { router, ctl } = renderAt(['/c/broken'], { route: 'task', activeTaskId: 'broken' });

    await waitFor(() => expect(ctl.openConversation).toHaveBeenCalled());
    const [id, loaded] = ctl.openConversation.mock.calls.at(-1);
    expect(id).toBe('broken');
    expect(loaded).toEqual({ unavailable: true, id: 'broken' });
    // The deep link is preserved — the bug was redirecting to '/' here.
    expect(router.state.location.pathname).toBe('/c/broken');
    expect(ctl.enterHome).not.toHaveBeenCalled();
  });
});

describe('new-chat history (ENG-1233 Major 1)', () => {
  it('is one Back press from Home — the temp URL is never pushed', async () => {
    // Start at Home, as a new chat does.
    const { router, ctl } = renderAt(['/'], { route: 'home', activeTaskId: null });
    await waitFor(() => expect(ctl.enterHome).toHaveBeenCalled());
    expect(router.state.location.pathname).toBe('/');

    // Send → an optimistic `tmp-` task. The bridge must NOT push /c/tmp-*.
    await act(async () => { ctl.setNav({ route: 'task', activeTaskId: 'tmp-1' }); });
    expect(router.state.location.pathname).toBe('/');

    // Server mints the canonical id (marked optimistic so its loader renders
    // from local state). Adopting it drives the single push to /c/:sid.
    markOptimisticConversation('sid-hist-1');
    await act(async () => { ctl.setNav({ route: 'task', activeTaskId: 'sid-hist-1' }); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/sid-hist-1'));

    // One Back press returns Home — not to a dead /c/tmp-1 entry.
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));

    clearOptimisticConversation('sid-hist-1');
  });
});

describe('the customize view is served at its /connect slug, not its route key', () => {
  it('renders the customize view at /connect and preserves the URL', async () => {
    const { router, ctl } = renderAt(['/connect'], { route: 'home' });
    // The URL slug is `connect`; the internal route key stays `customize`.
    await waitFor(() => expect(ctl.enterRoute).toHaveBeenCalledWith('customize'));
    expect(router.state.location.pathname).toBe('/connect');
  });

  it('redirects the legacy /customize URL Home (no route registered for the raw key)', async () => {
    const { router, ctl } = renderAt(['/customize'], { route: 'home' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(ctl.enterRoute).not.toHaveBeenCalledWith('customize');
  });
});

describe('detail routes carry their entity id (ENG-1233 v1)', () => {
  it('resolves a project deep link and preserves the URL', async () => {
    const { router, ctl } = renderAt(['/projects/proj-9'], { route: 'projects' });
    await waitFor(() => expect(ctl.enterProjectDetail).toHaveBeenCalledWith('proj-9'));
    expect(router.state.location.pathname).toBe('/projects/proj-9');
  });

  it('resolves a schedule deep link and preserves the URL', async () => {
    const { router, ctl } = renderAt(['/scheduled/sched-9'], {
      route: 'schedule-detail',
      selectedScheduleId: 'sched-9',
    });
    await waitFor(() => expect(ctl.enterScheduleDetail).toHaveBeenCalledWith('sched-9'));
    expect(router.state.location.pathname).toBe('/scheduled/sched-9');
  });

  it('replaces a missing project deep link with the grid, and Back skips the dead URL (Major 3)', async () => {
    const { router, ctl } = renderAt(
      ['/scheduled', '/projects/ghost'],
      { route: 'projects' },
      { projectExists: () => false },
    );
    await waitFor(() => expect(ctl.enterProjectDetail).toHaveBeenCalledWith('ghost'));
    // Not in the fetched list → the dead detail URL is replaced with the grid.
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'));

    // replace, not push: Back returns to the origin, not to /projects/ghost.
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/scheduled'));
  });

  it('pushes /projects/:id when a project is selected, and Back returns to the grid', async () => {
    const { router, ctl } = renderAt(['/projects'], { route: 'projects' });
    await waitFor(() => expect(ctl.enterRoute).toHaveBeenCalledWith('projects'));
    expect(router.state.location.pathname).toBe('/projects');

    // Select a project (as an in-app click does): the bridge pushes the id URL.
    await act(async () => { ctl.setNav({ route: 'projects', selectedProjectId: 'proj-x' }); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/proj-x'));

    // Back returns to the grid, not out of the app.
    await act(async () => { await router.navigate(-1); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'));
  });
});
