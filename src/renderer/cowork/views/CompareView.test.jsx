import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({
  isElectron: true,
  isWeb: false,
  isMac: () => false,
  getApiOrigin: () => 'http://localhost:1',
  openPath: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock('../../platform/host', () => ({
  host: hostMock,
  getAccessToken: vi.fn(async () => null),
  isElectron: true,
}));

// Base UI pickers are not drivable in happy-dom; a native select stands in so
// the test exercises what the screen does with a pick, not the popup.
vi.mock('../components/ModelSelect.jsx', () => ({
  default: ({ value, onValueChange, options, modelEfforts, effort, onEffortChange }) => (
    <span>
      <select aria-label="model" value={value} onChange={(e) => onValueChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {modelEfforts && (
        <input aria-label="effort" value={effort || ''} onChange={(e) => onEffortChange(e.target.value)} />
      )}
    </span>
  ),
}));

vi.mock('../components/ui', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Select: ({ value, onValueChange, options, ariaLabel, 'aria-label': label }) => (
      <select aria-label={ariaLabel || label} value={value} onChange={(e) => onValueChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ),
  };
});

const api = vi.hoisted(() => ({
  fetchComparisons: vi.fn(),
  fetchComparison: vi.fn(),
  fetchComparisonUsage: vi.fn(),
  createComparison: vi.fn(),
  deleteComparison: vi.fn(),
  recordComparisonVerdict: vi.fn(),
  continueComparisonSide: vi.fn(),
  fetchSession: vi.fn(),
  fetchInFlightStatus: vi.fn(),
  streamMessage: vi.fn(),
  tailInFlight: vi.fn(),
  cancelResponse: vi.fn(),
  uploadAttachments: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...api }));

import CompareView, { EXAMPLES, SETTLE_REREAD_MS, filterComparisons } from './CompareView';
import { HubUsageContext } from '../lib/hubUsageContext';
import UsageBar from '../components/UsageBar';
import { resetUsageBarDismissForTests } from '../lib/usageBarDismiss';
import { deriveComposerWarning } from '../lib/usageWarnings';

const models = [{ id: 'kimi', name: 'Kimi' }, { id: 'qwen', name: 'Qwen' }];

const usage = (balance) => ({
  usage: {
    reachable: true,
    isBillingOwner: true,
    freeTokens: { percentRemaining: 80, limit: 100, used: 20, remaining: 80, resetsAt: '2099-09-11T12:00:00Z' },
    balance,
    autoTopUp: { enabled: false, status: 'ok' },
  },
  providerType: 'minds-cloud',
});
const EMPTY = { usd: 0, canConsume: false, hasToppedUp: true, alert: 'depleted' };
const LOW = { usd: 4.2, canConsume: true, hasToppedUp: true, alert: 'low' };
// The history as fetchComparisons answers: one page, or null on a server
// without comparisons.
const mockHistory = (comparisons, hasMore = false) => api.fetchComparisons.mockResolvedValue(
  comparisons === null ? null : { comparisons, hasMore },
);
const withUsage = (value, ui) => <HubUsageContext.Provider value={value}>{ui}</HubUsageContext.Provider>;
const projects = [{ id: 'p-real', name: 'reports', display_name: 'Reports' }];

function comparison(overrides = {}) {
  return {
    id: 'cmp-1',
    title: 'Build a dashboard',
    createdAt: '2026-09-23T10:00:00Z',
    verdict: null,
    verdicts: [],
    sides: [
      { label: 'a', model: 'kimi', reasoningEffort: null, projectId: 'p-a', conversationId: 'conv-a', turnCount: 0, continuedAt: null, continuedTurnCount: null },
      { label: 'b', model: 'qwen', reasoningEffort: 'xhigh', projectId: 'p-b', conversationId: 'conv-b', turnCount: 0, continuedAt: null, continuedTurnCount: null },
    ],
    ...overrides,
  };
}

function session(id, messages = []) {
  return { id, title: 't', status: 'idle', messages, projectName: `_comparison-${id}`, projectPath: `/p/${id}` };
}

const finishedTurn = (text) => [
  { role: 'user', content: text, created_at: '2026-09-23T10:00:00Z' },
  { role: 'assistant', content: `answer to ${text}`, created_at: '2026-09-23T10:00:30Z' },
];

// Streams stay open until a test ends them, so "still answering" is a state a
// test can hold.
const openStreams = {};
function holdStreams() {
  api.streamMessage.mockImplementation((conversationId, _text, callbacks) => {
    openStreams[conversationId] = callbacks;
    return { abort: vi.fn() };
  });
}

async function openDetail(cmp, sessions, hubUsage = null) {
  mockHistory([cmp]);
  api.fetchComparison.mockResolvedValue(cmp);
  api.fetchSession.mockImplementation(async (id) => sessions[id]);
  const view = render(withUsage(hubUsage, <CompareView models={models} projects={projects} />));
  openDetail.rerender = (next) => view.rerender(withUsage(next, <CompareView models={models} projects={projects} />));
  fireEvent.click(await screen.findByText(cmp.title));
  await screen.findAllByRole('region');
  await waitFor(() => expect(api.fetchSession).toHaveBeenCalledTimes(2));
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  hostMock.openExternal.mockReset();
  for (const key of Object.keys(openStreams)) delete openStreams[key];
  api.fetchInFlightStatus.mockResolvedValue({ in_flight: false });
  api.fetchComparisonUsage.mockResolvedValue(null);
  holdStreams();
  resetUsageBarDismissForTests();
});

describe('CompareView', () => {
  it('shows what each comparison cost in the history, as last read', async () => {
    const usage = (usd, partial = false) => ({ estimatedCostUsd: usd, tokens: 1000, partial });
    const priced = comparison({ id: 'c-priced', title: 'Priced' });
    priced.sides = priced.sides.map((side, i) => ({ ...side, usage: usage(i ? 0.5 : 0.04) }));
    const partial = comparison({ id: 'c-partial', title: 'Partial' });
    partial.sides = [{ ...partial.sides[0], usage: usage(0.2) }, partial.sides[1]];
    const unread = comparison({ id: 'c-unread', title: 'Unread' });
    mockHistory([priced, partial, unread]);
    render(<CompareView models={models} projects={projects} />);

    expect(await screen.findByLabelText('Estimated cost $0.54')).toBeTruthy();
    expect(screen.getByLabelText('Estimated cost $0.2+')).toBeTruthy();
    expect(screen.getByLabelText('Cost not read yet').textContent).toBe('—');
  });

  it('pages through older comparisons', async () => {
    mockHistory([comparison({ id: 'c1', title: 'Newest' })], true);
    render(<CompareView models={models} projects={projects} />);
    await screen.findByText('Newest');

    api.fetchComparisons.mockResolvedValueOnce({ comparisons: [comparison({ id: 'c2', title: 'Older' })], hasMore: false });
    fireEvent.click(screen.getByRole('button', { name: 'Show older comparisons' }));

    expect(await screen.findByText('Older')).toBeTruthy();
    expect(screen.getByText('Newest')).toBeTruthy();
    expect(api.fetchComparisons).toHaveBeenLastCalledWith({ offset: 1 });
    expect(screen.queryByRole('button', { name: 'Show older comparisons' })).toBeNull();
  });

  it('opens on the start screen while there is no history yet', async () => {
    mockHistory([]);
    render(<CompareView models={models} projects={projects} />);
    expect(await screen.findByRole('heading', { name: 'Compare two models' })).toBeTruthy();
    expect(screen.queryByText('Comparisons')).toBeNull();
  });

  it('swaps the two sides and fills the prompt from an example', async () => {
    mockHistory([]);
    render(<CompareView models={models} projects={projects} />);
    const [modelA, modelB] = await screen.findAllByLabelText('model');
    fireEvent.change(modelA, { target: { value: 'kimi' } });
    fireEvent.change(modelB, { target: { value: 'qwen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Swap sides' }));
    const [afterA, afterB] = screen.getAllByLabelText('model');
    expect([afterA.value, afterB.value]).toEqual(['qwen', 'kimi']);

    const examples = screen.getByRole('group', { name: 'Example comparisons' });
    // Every example must work with nothing attached: most comparisons start empty.
    const pills = within(examples).getAllByRole('button');
    expect(pills.length).toBeGreaterThanOrEqual(6);
    fireEvent.click(within(examples).getByText('Build website'));
    expect(screen.getByLabelText('Task for both models').value).toMatch(/^Build a landing page/);
    // Examples step aside once there is a prompt.
    expect(screen.queryByRole('group', { name: 'Example comparisons' })).toBeNull();
  });

  it('counts a working side up live', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const started = new Date(Date.now() - 40_000).toISOString();
      api.fetchInFlightStatus.mockImplementation(async (id) => ({ in_flight: id === 'conv-a' }));
      api.tailInFlight.mockReturnValue({ abort: vi.fn() });
      await openDetail(comparison(), {
        'conv-a': session('conv-a', [{ role: 'user', content: 'p', created_at: started }]),
        'conv-b': session('conv-b', finishedTurn('p')),
      });
      const status = await screen.findByRole('status', { name: 'Side A status' });
      await waitFor(() => expect(status.textContent).toMatch(/Working · 4\ds$/));
      const seconds = () => Number(status.textContent.match(/(\d+)s$/)[1]);
      const before = seconds();
      await act(async () => { vi.advanceTimersByTime(3000); });
      expect(seconds()).toBeGreaterThanOrEqual(before + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('will not start a comparison a side could not pay for', async () => {
    mockHistory([]);
    render(withUsage(usage(EMPTY), <CompareView models={models} projects={projects} />));
    fireEvent.change(await screen.findByLabelText('Task for both models'), { target: { value: 'go' } });
    const [modelA, modelB] = screen.getAllByLabelText('model');
    fireEvent.change(modelA, { target: { value: 'kimi' } });
    fireEvent.change(modelB, { target: { value: 'qwen' } });
    expect(screen.getByText('Balance empty')).toBeTruthy();
    // Both the card's send arrow and the button below it.
    expect(screen.getAllByRole('button', { name: 'Start comparison' }).map((b) => b.disabled)).toEqual([true, true]);
    expect(screen.getAllByRole('button', { name: /Add funds/ }).length).toBeGreaterThan(0);
  });

  it('warns that a comparison spends about twice a task on a low balance, and still starts', async () => {
    mockHistory([]);
    render(withUsage(usage(LOW), <CompareView models={models} projects={projects} />));
    fireEvent.change(await screen.findByLabelText('Task for both models'), { target: { value: 'go' } });
    const [modelA, modelB] = screen.getAllByLabelText('model');
    fireEvent.change(modelA, { target: { value: 'kimi' } });
    fireEvent.change(modelB, { target: { value: 'qwen' } });
    expect(screen.getByText(/uses about twice the credits of one task/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Start comparison' }).map((b) => b.disabled)).toEqual([false, false]);
  });

  it('closes a low-balance warning, and the composer bar stays closed with it', async () => {
    mockHistory([]);
    const { unmount } = render(withUsage(usage(LOW), <CompareView models={models} projects={projects} />));
    fireEvent.change(await screen.findByLabelText('Task for both models'), { target: { value: 'go' } });
    const [modelA, modelB] = screen.getAllByLabelText('model');
    fireEvent.change(modelA, { target: { value: 'kimi' } });
    fireEvent.change(modelB, { target: { value: 'qwen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Balance running low')).toBeNull();
    unmount();
    const warning = deriveComposerWarning(usage(LOW).usage, { providerType: 'minds-cloud', model: 'kimi' });
    expect(warning.title).toBe('Balance running low');
    const { container } = render(<UsageBar warning={warning} />);
    expect(container.querySelector('[data-usage-notice]')).toBeNull();
  });

  it('offers no close on the notice that explains a disabled Start', async () => {
    mockHistory([]);
    render(withUsage(usage(EMPTY), <CompareView models={models} projects={projects} />));
    fireEvent.change(await screen.findByLabelText('Task for both models'), { target: { value: 'go' } });
    const [modelA, modelB] = screen.getAllByLabelText('model');
    fireEvent.change(modelA, { target: { value: 'kimi' } });
    fireEvent.change(modelB, { target: { value: 'qwen' } });
    expect(screen.getByText('Balance empty')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('holds follow-ups while a side is out of credits, and lets go once funds arrive', async () => {
    const ranOut = [{ role: 'user', content: 'p', created_at: '2026-09-23T10:00:00Z' }, { role: 'error', code: 'token_limit', content: 'out' }];
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', ranOut) }, usage(EMPTY));
    const held = screen.getByRole('status', { name: 'Follow-up message' });
    expect(within(held).getByText('Qwen stopped because the balance ran out. Add funds to keep comparing.')).toBeTruthy();
    fireEvent.click(within(held).getByRole('button', { name: 'Add funds' }));
    expect(hostMock.openExternal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status', { name: 'Side B status' }).textContent).toMatch(/^Out of credits/);
    expect(screen.getByText("Qwen ran out of credits before finishing, so this turn can't be judged.")).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Which answer was better?' })).toBeNull();

    openDetail.rerender(usage({ usd: 25, canConsume: true, hasToppedUp: true, alert: '' }));
    expect(await screen.findByRole('textbox', { name: 'Follow-up message' })).toBeTruthy();
  });

  it('says when a working side has gone quiet, without stopping it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.fetchInFlightStatus.mockImplementation(async (id) => ({ in_flight: id === 'conv-a' }));
      let tail = null;
      api.tailInFlight.mockImplementation((_id, callbacks) => { tail = callbacks; return { abort: vi.fn() }; });
      await openDetail(comparison(), {
        'conv-a': session('conv-a', [{ role: 'user', content: 'p', created_at: new Date().toISOString() }]),
        'conv-b': session('conv-b', finishedTurn('p')),
      });
      const status = await screen.findByRole('status', { name: 'Side A status' });
      await waitFor(() => expect(tail).not.toBeNull());
      expect(status.textContent).not.toMatch(/no new activity/);
      await act(async () => { vi.advanceTimersByTime(125_000); });
      expect(status.textContent).toMatch(/no new activity for 2m 0\ds$/);
      expect(api.cancelResponse).not.toHaveBeenCalled();
      // Any new event restarts the quiet clock.
      await act(async () => { tail.onEvent({ type: 'response.in_progress', thought_role: 'thought.progress' }); });
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(status.textContent).not.toMatch(/no new activity/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says an update is needed when the server has no comparisons API', async () => {
    mockHistory(null);
    render(<CompareView models={models} projects={projects} />);
    expect(await screen.findByText('Update needed')).toBeTruthy();
    expect(screen.getByText(/Restart the app to update it/)).toBeTruthy();
  });

  it('does not tell a web user to restart a server they do not run', async () => {
    hostMock.isWeb = true;
    try {
      mockHistory(null);
      render(<CompareView models={models} projects={projects} />);
      expect(await screen.findByText('Update needed')).toBeTruthy();
      expect(screen.queryByText(/Restart the app/)).toBeNull();
      expect(screen.getByText(/once it's updated/)).toBeTruthy();
    } finally {
      hostMock.isWeb = false;
    }
  });

  it('lists past comparisons under column headers, with the verdict named by model', async () => {
    mockHistory([
      comparison({ verdict: 'b', sides: comparison().sides.map((s) => ({ ...s, turnCount: 3 })) }),
      comparison({ id: 'cmp-2', title: 'Second task', sides: [
        { ...comparison().sides[0], turnCount: 3 },
        { ...comparison().sides[1], turnCount: 2 },
      ] }),
    ]);
    render(<CompareView models={models} projects={projects} />);
    const row = await screen.findByRole('button', { name: 'Open comparison: Build a dashboard' });
    for (const heading of ['Prompt', 'Models', 'Turns', 'Winner', 'Started']) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
    expect(within(row).getByText('Kimi')).toBeTruthy();
    expect(within(row).getByText('3')).toBeTruthy();
    // A follow-up went to one side only: both counts, each named in the tooltip.
    const uneven = within(screen.getByRole('button', { name: 'Open comparison: Second task' })).getByText('3 / 2');
    expect(uneven.getAttribute('title')).toBe('Kimi: 3 turns · Qwen: 2 turns');
    // The winner is named by model alone; no winner yet is a quiet dash.
    expect(within(row).getAllByText('Qwen')).toHaveLength(2);
    expect(within(row).queryByText(/preferred/)).toBeNull();
    expect(within(screen.getByRole('button', { name: 'Open comparison: Second task' })).getByLabelText('No winner yet')).toBeTruthy();
    // Few comparisons: no search box yet.
    expect(screen.queryByPlaceholderText('Search prompts and models')).toBeNull();
  });

  it("shows each model's own logo, not the generic mark", async () => {
    mockHistory([comparison({ sides: [
      { ...comparison().sides[0], model: 'claude-sonnet-5' },
      { ...comparison().sides[1], model: 'gpt-6-terra' },
    ] })]);
    const { container } = render(<CompareView models={[{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5' }, { id: 'gpt-6-terra', name: 'GPT 6 Terra' }]} projects={projects} />);
    await screen.findByText('Claude Sonnet 5');
    const icons = [...container.querySelectorAll('[role="button"] svg')];
    expect(icons.length).toBeGreaterThanOrEqual(2);
    // The neutral fallback is an outlined circle; a real logo is a path.
    for (const svg of icons.slice(0, 2)) {
      expect(svg.querySelector('path')).not.toBeNull();
      expect(svg.querySelector('circle')).toBeNull();
    }
  });

  it('falls back to the generic mark for a model with no logo', async () => {
    mockHistory([comparison({ sides: [
      { ...comparison().sides[0], model: 'house-model-x' },
      comparison().sides[1],
    ] })]);
    const { container } = render(<CompareView models={[{ id: 'house-model-x', name: 'House Model X' }, ...models]} projects={projects} />);
    await screen.findByText('House Model X');
    expect(container.querySelector('[role="button"] svg circle')).not.toBeNull();
  });

  it('adds search once there are more comparisons than fit at a glance', async () => {
    const many = Array.from({ length: 11 }, (_, i) => comparison({ id: `c${i}`, title: `Task ${i}` }));
    many[3] = comparison({ id: 'c3', title: 'Quarterly revenue dashboard' });
    mockHistory(many);
    render(<CompareView models={models} projects={projects} />);
    fireEvent.change(await screen.findByPlaceholderText('Search prompts and models'), { target: { value: 'revenue' } });
    expect(screen.getByRole('button', { name: 'Open comparison: Quarterly revenue dashboard' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open comparison: Task 0' })).toBeNull();
  });

  it('starts a comparison and sends the prompt to both sides on their own settings', async () => {
    mockHistory([]);
    api.createComparison.mockResolvedValue(comparison());
    api.fetchComparison.mockResolvedValue(comparison());
    api.fetchSession.mockImplementation(async (id) => session(id));
    render(<CompareView models={models} projects={projects} />);

    fireEvent.click((await screen.findAllByText('New comparison'))[0]);
    const start = screen.getByText('Start comparison');
    expect(start.closest('button').disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Task for both models'), { target: { value: 'Build a dashboard\nfrom sales' } });
    expect(start.closest('button').disabled).toBe(true);
    const [modelA, modelB] = screen.getAllByLabelText('model');
    // An effort belongs to the model it was picked for: changing the model drops it.
    fireEvent.change(modelA, { target: { value: 'qwen' } });
    fireEvent.change(screen.getAllByLabelText('effort')[0], { target: { value: 'xhigh' } });
    fireEvent.change(modelA, { target: { value: 'kimi' } });
    fireEvent.change(modelB, { target: { value: 'qwen' } });
    fireEvent.change(screen.getAllByLabelText('effort')[1], { target: { value: 'xhigh' } });
    // Home's project picker: search, pick, and "No project" to clear it.
    fireEvent.click(screen.getByRole('button', { name: 'Choose project' }));
    expect(screen.getByRole('button', { name: /No project/ })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Reports/ }));
    expect(screen.getByRole('button', { name: 'Choose project' }).textContent).toMatch(/Reports/);
    expect(start.closest('button').disabled).toBe(false);
    fireEvent.click(start);

    await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
    expect(api.createComparison).toHaveBeenCalledWith({
      title: 'Build a dashboard',
      sides: [{ model: 'kimi', reasoningEffort: null }, { model: 'qwen', reasoningEffort: 'xhigh' }],
      sourceProjectId: 'p-real',
    });
    const calls = Object.fromEntries(api.streamMessage.mock.calls.map(([id, text, opts]) => [id, { text, opts }]));
    expect(calls['conv-a'].text).toBe('Build a dashboard\nfrom sales');
    expect(calls['conv-a'].opts).toMatchObject({ model: 'kimi', projectId: 'p-a' });
    expect(calls['conv-a'].opts.reasoningEffort).toBeUndefined();
    expect(calls['conv-b'].opts).toMatchObject({ model: 'qwen', projectId: 'p-b', reasoningEffort: 'xhigh' });
  });

  async function startComparison({ files = [] } = {}) {
    render(<CompareView models={models} projects={projects} />);
    fireEvent.click((await screen.findAllByText('New comparison'))[0]);
    fireEvent.change(screen.getByLabelText('Task for both models'), { target: { value: 'go' } });
    const [modelA, modelB] = screen.getAllByLabelText('model');
    fireEvent.change(modelA, { target: { value: 'kimi' } });
    fireEvent.change(modelB, { target: { value: 'qwen' } });
    if (files.length) {
      const input = document.querySelector('input[type="file"]');
      fireEvent.change(input, { target: { files } });
    }
    fireEvent.click(screen.getByText('Start comparison'));
  }

  it('says when a side could not load, and sends the task once it does', async () => {
    mockHistory([]);
    api.createComparison.mockResolvedValue(comparison());
    api.fetchComparison.mockResolvedValue(comparison());
    let failB = true;
    api.fetchSession.mockImplementation(async (id) => (id === 'conv-b' && failB ? null : session(id)));
    await startComparison();

    const paneB = await screen.findByRole('region', { name: 'Side B' });
    expect(await within(paneB).findByText("Couldn't load this side.")).toBeTruthy();
    // Neither side starts while one of them is missing.
    expect(api.streamMessage).not.toHaveBeenCalled();

    failB = false;
    fireEvent.click(within(paneB).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
    expect(api.streamMessage.mock.calls.map((c) => c[0]).sort()).toEqual(['conv-a', 'conv-b']);
  });

  it('takes no follow-up while a side has not loaded', async () => {
    mockHistory([]);
    api.createComparison.mockResolvedValue(comparison());
    api.fetchComparison.mockResolvedValue(comparison());
    api.fetchSession.mockImplementation(async (id) => (id === 'conv-b' ? null : session(id)));
    await startComparison();

    const paneB = await screen.findByRole('region', { name: 'Side B' });
    await within(paneB).findByText("Couldn't load this side.");
    expect(screen.getByText("A side couldn't load. Retry it above before following up.")).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Follow-up message' })).toBeNull();
  });

  it('still takes a follow-up for the other side when a continued side cannot load', async () => {
    const cmp = comparison({
      sides: comparison().sides.map((side) => (side.label === 'a'
        ? { ...side, continuedAt: '2026-09-30T10:00:00Z', continuedTurnCount: 1, continuedProjectId: 'p-real' }
        : side)),
    });
    mockHistory([cmp]);
    api.fetchComparison.mockResolvedValue(cmp);
    api.fetchSession.mockImplementation(async (id) => (id === 'conv-a' ? null : session(id, finishedTurn('p'))));
    render(<CompareView models={models} projects={projects} />);
    fireEvent.click(await screen.findByText(cmp.title));
    await waitFor(() => expect(api.fetchSession).toHaveBeenCalledTimes(2));

    expect(await screen.findByText('Kimi was continued as a task. Send to Qwen only.')).toBeTruthy();
  });

  it('takes no follow-up until the task has gone out to both sides, so it cannot overtake it', async () => {
    mockHistory([]);
    api.createComparison.mockResolvedValue(comparison());
    api.fetchComparison.mockResolvedValue(comparison());
    api.fetchSession.mockImplementation(async (id) => session(id));
    let finishUpload;
    api.uploadAttachments.mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
    const file = new File(['a,b'], 'sales.csv', { type: 'text/csv' });
    await startComparison({ files: [file] });

    expect(await screen.findByText('Sending the task to both models…')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Follow-up message' })).toBeNull();

    api.uploadAttachments.mockResolvedValue([{ id: 'att-b' }]);
    await act(async () => { finishUpload([{ id: 'att-a' }]); });
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
    // The first thing either side was sent is the task itself.
    expect(api.streamMessage.mock.calls.every((c) => c[1] !== 'more')).toBe(true);
  });

  it('sends nothing when a file cannot be attached for one side, and offers to try again', async () => {
    mockHistory([]);
    api.createComparison.mockResolvedValue(comparison());
    api.fetchComparison.mockResolvedValue(comparison());
    api.fetchSession.mockImplementation(async (id) => session(id));
    const file = new File(['a,b'], 'sales.csv', { type: 'text/csv' });
    api.uploadAttachments
      .mockResolvedValueOnce([{ id: 'att-a' }])
      .mockRejectedValueOnce(new Error('Upload failed'))
      .mockResolvedValue([{ id: 'att-ok' }]);
    await startComparison({ files: [file] });

    expect(await screen.findByText(/The task wasn't sent to either model\. Upload failed/)).toBeTruthy();
    // Side A must not have started alone.
    expect(api.streamMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
    expect(api.streamMessage.mock.calls.map((c) => c[2].attachmentIds)).toEqual([['att-ok'], ['att-ok']]);
  });

  it.each([
    ['interrupted', 'The response was interrupted before it finished. Please try again.'],
    ['stream_error', 'The connection was reset.'],
  ])('re-attaches a side whose stream dropped (%s) to a turn still running, still working and without reading its cost', async (code, message) => {
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'next' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
    api.fetchInFlightStatus.mockResolvedValue({ in_flight: true });
    api.tailInFlight.mockImplementation((_id, callbacks) => { openStreams.tail = callbacks; return { abort: vi.fn() }; });
    const costReads = api.fetchComparisonUsage.mock.calls.length;

    act(() => openStreams['conv-a'].onError(message, { code }));

    await waitFor(() => expect(api.tailInFlight).toHaveBeenCalledWith('conv-a', expect.anything()));
    const paneA = screen.getByRole('region', { name: 'Side A' });
    expect(within(paneA).queryByText(message)).toBeNull();
    expect(within(paneA).getByRole('status', { name: 'Side A status' }).textContent).toMatch(/Working/);
    expect(api.fetchComparisonUsage.mock.calls.length).toBe(costReads);
  });

  it.each([
    ['interrupted', 'The response was interrupted before it finished. Please try again.'],
    ['stream_error', 'The connection was reset.'],
  ])('says when a side\'s stream dropped (%s) and its turn is no longer running', async (code, message) => {
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'next' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
    api.fetchInFlightStatus.mockResolvedValue({ in_flight: false });

    act(() => openStreams['conv-a'].onError(message, { code }));

    const paneA = screen.getByRole('region', { name: 'Side A' });
    expect(await within(paneA).findByText(message)).toBeTruthy();
    expect(api.tailInFlight).not.toHaveBeenCalled();
  });

  it('re-attaches again when the re-attached stream itself drops', async () => {
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'next' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
    api.fetchInFlightStatus.mockResolvedValue({ in_flight: true });
    const tails = [];
    api.tailInFlight.mockImplementation((_id, callbacks) => { tails.push(callbacks); return { abort: vi.fn() }; });

    act(() => openStreams['conv-a'].onError('The connection was reset.', { code: 'stream_error' }));
    await waitFor(() => expect(tails).toHaveLength(1));
    // How a tail reports its own connection dropping.
    act(() => tails[0].onError('Failed to fetch', { code: 'reconnect_error' }));

    await waitFor(() => expect(tails).toHaveLength(2));
  });

  it('stops re-attaching to a side whose stream keeps dropping', async () => {
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'next' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
    api.fetchInFlightStatus.mockResolvedValue({ in_flight: true });
    const tails = [];
    api.tailInFlight.mockImplementation((_id, callbacks) => { tails.push(callbacks); return { abort: vi.fn() }; });
    const drop = (callbacks) => act(() => callbacks.onError('The response was interrupted before it finished. Please try again.', { code: 'interrupted' }));

    drop(openStreams['conv-a']);
    await waitFor(() => expect(tails).toHaveLength(1));
    drop(tails[0]);
    await waitFor(() => expect(tails).toHaveLength(2));
    drop(tails[1]);
    await new Promise((r) => setTimeout(r, 50));
    expect(tails).toHaveLength(2);
  });

  it('does not attach a second stream to a side that has already started', async () => {
    mockHistory([]);
    api.createComparison.mockResolvedValue(comparison());
    api.fetchComparison.mockResolvedValue(comparison());
    api.fetchSession.mockImplementation(async (id) => session(id));
    // The running-turn check for B answers only after the first message went out.
    let answerB;
    api.fetchInFlightStatus.mockImplementation((id) => (id === 'conv-b'
      ? new Promise((resolve) => { answerB = resolve; })
      : Promise.resolve({ in_flight: false })));
    await startComparison();
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(answerB).toBeTypeOf('function'));
    await act(async () => { answerB({ in_flight: true }); });
    expect(api.tailInFlight).not.toHaveBeenCalled();
  });

  it('sends the first prompt only once', async () => {
    mockHistory([]);
    api.createComparison.mockResolvedValue(comparison({ id: 'cmp-once' }));
    api.fetchComparison.mockResolvedValue(comparison({ id: 'cmp-once' }));
    api.fetchSession.mockImplementation(async (id) => session(id));
    render(<CompareView models={models} projects={projects} />);
    fireEvent.click((await screen.findAllByText('New comparison'))[0]);
    fireEvent.change(screen.getByLabelText('Task for both models'), { target: { value: 'go' } });
    const [modelA, modelB] = screen.getAllByLabelText('model');
    fireEvent.change(modelA, { target: { value: 'kimi' } });
    fireEvent.change(modelB, { target: { value: 'qwen' } });
    fireEvent.click(screen.getByText('Start comparison'));
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
    act(() => openStreams['conv-a'].onDone());
    await waitFor(() => expect(api.fetchSession.mock.calls.length).toBeGreaterThan(2));
    expect(api.streamMessage).toHaveBeenCalledTimes(2);
  });

  const target = async (name) => {
    const picker = screen.getByRole('combobox', { name: 'Send to' });
    const option = within(picker).getByRole('option', { name });
    fireEvent.change(picker, { target: { value: option.value } });
  };

  it('picks the target by model name and will not send to both while one is working', async () => {
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    expect(screen.getByRole('button', { name: 'Send' }).disabled).toBe(true);
    // Inside the composer, next to Send, like the model pill on Home.
    expect(screen.getByRole('combobox', { name: 'Send to' }).closest('.composer-toolbar')).toBeTruthy();
    await target('Qwen');
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'next' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.streamMessage).toHaveBeenCalledTimes(1);
    expect(api.streamMessage.mock.calls[0][0]).toBe('conv-b');

    // Back to Both while Qwen works: the composer says why instead of
    // offering a box that cannot send.
    await target('Both models');
    expect(screen.getByText('Qwen is still working. Send to Kimi only, or wait.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Follow-up message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await target('Kimi');
    expect(screen.getByRole('textbox', { name: 'Follow-up message' })).toBeTruthy();
  });

  it('closes the composer while both models work', async () => {
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'next' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.streamMessage).toHaveBeenCalledTimes(2);
    expect(screen.getByText('You can follow up when both models finish.')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Send to' })).toBeNull();
    act(() => openStreams['conv-a'].onDone());
    await waitFor(() => expect(screen.getByText('Qwen is still working. Send to Kimi only, or wait.')).toBeTruthy());
  });

  it('shows what each side cost, its latest turn, and both together', async () => {
    api.fetchComparisonUsage.mockResolvedValue({
      sides: {
        a: { available: true, estimatedCostUsd: 0.042, turns: [{ turn: 1, estimatedCostUsd: 0.042, inputTokens: 12000, outputTokens: 400 }] },
        b: { available: true, estimatedCostUsd: 1.5, turns: [{ turn: 1, estimatedCostUsd: 1.5, inputTokens: 90000 }] },
      },
    });
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    expect((await screen.findByRole('button', { name: /^Side A estimated cost \$0\.042\./ })).textContent).toBe('$0.042total');
    expect(screen.getByRole('button', { name: /^Side B estimated cost \$1\.50\./ })).toBeTruthy();
    // The status line keeps to status and time; the cost has its own place.
    expect(screen.getByRole('status', { name: 'Side A status' }).textContent).toBe('Done · 30s');
    expect(screen.getByText(/Estimated cost \$1\.54/)).toBeTruthy();
    expect(api.fetchComparisonUsage).toHaveBeenCalledWith('cmp-1');
  });

  it('opens both sides\' usage by turn from one switch, with totals', async () => {
    api.fetchComparisonUsage.mockResolvedValue({
      sides: {
        a: {
          available: true,
          estimatedCostUsd: 0.05,
          inputTokens: 11000,
          cachedInputTokens: 1000,
          outputTokens: 600,
          turns: [{ turn: 1, estimatedCostUsd: 0.05, inputTokens: 11000, cachedInputTokens: 1000, outputTokens: 600 }],
        },
        b: { available: true, estimatedCostUsd: 0.3, inputTokens: 2000, outputTokens: 100, turns: [{ turn: 1, estimatedCostUsd: 0.3, inputTokens: 2000, outputTokens: 100 }] },
      },
    });
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    const toggleA = await screen.findByRole('button', { name: /^Side A estimated cost \$0\.05\. Show usage by turn$/ });
    expect(toggleA.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('table')).toBeNull();

    fireEvent.click(toggleA);

    const tableA = screen.getByRole('table', { name: 'Side A usage by turn' });
    expect(screen.getByRole('table', { name: 'Side B usage by turn' })).toBeTruthy();
    const rows = within(tableA).getAllByRole('row').map((r) => Array.from(r.children).map((c) => c.textContent));
    expect(rows).toEqual([
      ['Turn', 'Time', 'Input tokens', 'Output tokens', 'Cost'],
      ['1', '30s', '12K', '600', '$0.05'],
      ['Total', '30s', '12K', '600', '$0.05'],
    ]);
    expect(screen.getAllByRole('button', { name: /Hide usage by turn$/ })).toHaveLength(2);
    expect(screen.getByText('1 turn · 12.6K tokens')).toBeTruthy();
  });

  it('shows no cost for a side the gateway has nothing for, and marks the total as partial', async () => {
    api.fetchComparisonUsage.mockResolvedValue({
      sides: {
        a: { available: true, estimatedCostUsd: 0.2, turns: [{ turn: 1, estimatedCostUsd: 0.2 }] },
        b: { available: false, turns: [] },
      },
    });
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    expect(await screen.findByRole('button', { name: /^Side A estimated cost \$0\.2\./ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Side B estimated cost/ })).toBeNull();
    expect(screen.getByRole('status', { name: 'Side B status' }).textContent).not.toMatch(/\$/);
    expect(screen.getByText(/Estimated cost \$0\.2\+/)).toBeTruthy();
  });

  it('shows no cost at all when the server cannot say', async () => {
    api.fetchComparisonUsage.mockResolvedValue(null);
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    await waitFor(() => expect(api.fetchComparisonUsage).toHaveBeenCalled());
    expect(screen.queryByText(/Estimated cost/)).toBeNull();
    expect(screen.queryByLabelText(/estimated cost/)).toBeNull();
  });

  it('holds the cost still while a turn runs, and reads it when the turn finishes and once more after', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const usage = (a, b) => ({
        sides: {
          a: { available: true, estimatedCostUsd: a, turns: [{ turn: 1, estimatedCostUsd: a }] },
          b: { available: true, estimatedCostUsd: b, turns: [{ turn: 1, estimatedCostUsd: b }] },
        },
      });
      const costA = () => screen.getByRole('button', { name: /^Side A estimated cost/ }).textContent;
      const costB = () => screen.getByRole('button', { name: /^Side B estimated cost/ }).textContent;
      api.fetchComparisonUsage.mockResolvedValue(usage(1.25, 2.25));
      await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
      await waitFor(() => expect(costA()).toBe('$1.25total'));

      // The gateway's figure climbs as the running turn's calls land.
      api.fetchComparisonUsage.mockResolvedValue(usage(5.25, 6.25));
      const beforeSend = api.fetchComparisonUsage.mock.calls.length;
      fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'more' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
      await act(async () => { vi.advanceTimersByTime(SETTLE_REREAD_MS * 2); });
      expect(api.fetchComparisonUsage.mock.calls.length).toBe(beforeSend);
      expect(costA()).toBe('$1.25total');

      await act(async () => { openStreams['conv-a'].onDone(); });
      await waitFor(() => expect(costA()).toBe('$5.25total'));
      // B is still working, so it keeps the figure from its last finished turn.
      expect(costB()).toBe('$2.25total');
      const afterDone = api.fetchComparisonUsage.mock.calls.length;

      api.fetchComparisonUsage.mockResolvedValue(usage(5.75, 7.25));
      await act(async () => { vi.advanceTimersByTime(SETTLE_REREAD_MS); });
      await waitFor(() => expect(costA()).toBe('$5.75total'));
      expect(api.fetchComparisonUsage.mock.calls.length).toBe(afterDone + 1);
      expect(costB()).toBe('$2.25total');

      await act(async () => { openStreams['conv-b'].onDone(); });
      await waitFor(() => expect(costB()).toBe('$7.25total'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows each side under its model name with a quiet status line', async () => {
    const cmp = comparison();
    cmp.sides[1] = { ...cmp.sides[1], reasoningEffort: 'xhigh' };
    await openDetail(cmp, { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    expect(screen.getByRole('heading', { name: 'Kimi' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Qwen' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Side A status' }).textContent).toBe('Done · 30s');
    expect(screen.getByRole('status', { name: 'Side B status' }).textContent).toBe('Done · 30s · xhigh effort');
    // The name has its row to itself; the status sits beneath it.
    const header = screen.getByRole('heading', { name: 'Qwen' }).parentElement;
    expect(within(header).queryByRole('status')).toBeNull();
  });

  it('keeps Delete in the overflow menu, behind a confirmation', async () => {
    api.deleteComparison.mockResolvedValue({ ok: true });
    await openDetail(comparison(), { 'conv-a': session('conv-a'), 'conv-b': session('conv-b') });
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Comparison actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete comparison/ }));
    expect(api.deleteComparison).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteComparison).toHaveBeenCalledWith('cmp-1'));
  });

  it('reports a dropped connection but leaves an agent error to the transcript', async () => {
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'next' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() => openStreams['conv-a'].onError('Network lost', { code: 'stream_error' }));
    act(() => openStreams['conv-b'].onError('Model refused', { code: 'anton_error' }));
    expect(await screen.findByText('Network lost')).toBeTruthy();
    expect(screen.queryByText('Model refused')).toBeNull();
  });

  it('records which side was better on the latest finished turn', async () => {
    api.recordComparisonVerdict.mockResolvedValue(comparison({ verdict: 'a', verdicts: [{ turnIndex: 0, winner: 'a' }] }));
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    const bar = screen.getByRole('group', { name: 'Which answer was better?' });
    expect(within(bar).queryByText('Saved')).toBeNull();
    // One turn so far: no turn number to read.
    expect(within(bar).queryByText('Turn 1')).toBeNull();
    fireEvent.click(within(bar).getByRole('button', { name: 'Kimi' }));
    await waitFor(() => expect(api.recordComparisonVerdict).toHaveBeenCalledWith('cmp-1', 0, 'a'));
    await waitFor(() => expect(within(bar).getByRole('button', { name: 'Kimi' }).getAttribute('aria-pressed')).toBe('true'));
    expect(within(bar).getByText('Saved')).toBeTruthy();
  });

  it('offers no verdict until both sides finished', async () => {
    await openDetail(comparison(), {
      'conv-a': session('conv-a', finishedTurn('p')),
      'conv-b': session('conv-b', [{ role: 'user', content: 'p' }]),
    });
    expect(screen.queryByRole('group', { name: 'Which answer was better?' })).toBeNull();
  });

  it('shows a continued side only as far as it was compared', async () => {
    const cmp = comparison();
    cmp.sides[0] = { ...cmp.sides[0], continuedAt: '2026-09-23T11:00:00Z', continuedTurnCount: 1 };
    await openDetail(cmp, {
      'conv-a': session('conv-a', [...finishedTurn('compared'), ...finishedTurn('asked later in its project')]),
      'conv-b': session('conv-b', finishedTurn('compared')),
    });
    // Both sides' answers to the compared turn, and nothing after it.
    expect(screen.getAllByText('answer to compared').length).toBe(2);
    expect(screen.queryByText('answer to asked later in its project')).toBeNull();
    // The first prompt is on the page once, not in each pane.
    expect(screen.queryAllByText('compared')).toHaveLength(0);
    expect(screen.getByRole('status', { name: 'Side A status' }).textContent).toMatch(/^Continued as a task/);
  });

  it('marks the point where the two sides stopped being asked the same thing', async () => {
    await openDetail(comparison(), {
      'conv-a': session('conv-a', [...finishedTurn('p'), ...finishedTurn('only A')]),
      'conv-b': session('conv-b', finishedTurn('p')),
    });
    expect(screen.getByText(/diverged at turn 2/)).toBeTruthy();
  });

  it('re-attaches to a side still running on the server', async () => {
    api.fetchInFlightStatus.mockImplementation(async (id) => ({ in_flight: id === 'conv-b' }));
    api.tailInFlight.mockReturnValue({ abort: vi.fn() });
    await openDetail(comparison(), { 'conv-a': session('conv-a'), 'conv-b': session('conv-b') });
    await waitFor(() => expect(api.tailInFlight).toHaveBeenCalledTimes(1));
    expect(api.tailInFlight.mock.calls[0][0]).toBe('conv-b');
  });

  it('continues with a side into a real project and opens the task', async () => {
    const onOpenTask = vi.fn();
    api.continueComparisonSide.mockResolvedValue({ conversationId: 'conv-a', projectId: 'p-real' });
    mockHistory([comparison()]);
    api.fetchComparison.mockResolvedValue(comparison());
    api.fetchSession.mockImplementation(async (id) => session(id, finishedTurn('p')));
    render(<CompareView models={models} projects={projects} onOpenTask={onOpenTask} />);
    fireEvent.click(await screen.findByText('Build a dashboard'));
    const paneA = await screen.findByRole('region', { name: 'Side A' });
    fireEvent.click(await within(paneA).findByRole('button', { name: 'Continue' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continue' }));
    // The model's name, for the folder its files land in.
    await waitFor(() => expect(api.continueComparisonSide).toHaveBeenCalledWith('cmp-1', 'a', 'p-real', 'Kimi'));
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('conv-a'));
  });

  it('says when some files stayed behind, retries into the same project, and opens the task once they are all carried', async () => {
    const onOpenTask = vi.fn();
    api.continueComparisonSide
      .mockResolvedValueOnce({ conversationId: 'conv-a', projectId: 'p-real', carriedAll: false })
      .mockResolvedValueOnce({ conversationId: 'conv-a', projectId: 'p-real', carriedAll: true });
    mockHistory([comparison()]);
    api.fetchComparison.mockResolvedValue(comparison());
    api.fetchSession.mockImplementation(async (id) => session(id, finishedTurn('p')));
    render(<CompareView models={models} projects={projects} onOpenTask={onOpenTask} />);
    fireEvent.click(await screen.findByText('Build a dashboard'));
    const paneA = await screen.findByRole('region', { name: 'Side A' });
    fireEvent.click(await within(paneA).findByRole('button', { name: 'Continue' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continue' }));

    const dialog = await screen.findByRole('dialog');
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/some of the files Kimi made did not come across/);
    expect(onOpenTask).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('conv-a'));
    expect(api.continueComparisonSide).toHaveBeenNthCalledWith(2, 'cmp-1', 'a', 'p-real', 'Kimi');
  });

  it('keeps offering the files a continued side left behind, and copies them into the project it continued into', async () => {
    const left = comparison({
      sides: comparison().sides.map((side) => (side.label === 'a'
        ? { ...side, continuedAt: '2026-09-30T10:00:00Z', continuedTurnCount: 1, carryIncomplete: true, continuedProjectId: 'p-real' }
        : side)),
    });
    const done = comparison({
      sides: left.sides.map((side) => (side.label === 'a' ? { ...side, carryIncomplete: false } : side)),
    });
    api.continueComparisonSide.mockResolvedValue({ conversationId: 'conv-a', projectId: 'p-real', carriedAll: true });
    await openDetail(left, { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    const paneA = screen.getByRole('region', { name: 'Side A' });
    expect(within(paneA).getByText(/Some of the files Kimi made are still in this comparison/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Side B' })).queryByText(/still in this comparison/)).toBeNull();

    api.fetchComparison.mockResolvedValue(done);
    fireEvent.click(within(paneA).getByRole('button', { name: 'Copy the remaining files' }));

    await waitFor(() => expect(api.continueComparisonSide).toHaveBeenCalledWith('cmp-1', 'a', 'p-real', 'Kimi'));
    await waitFor(() => expect(within(paneA).queryByText(/still in this comparison/)).toBeNull());
  });

  it('says so when copying the remaining files fails, and keeps the offer', async () => {
    const left = comparison({
      sides: comparison().sides.map((side) => (side.label === 'a'
        ? { ...side, continuedAt: '2026-09-30T10:00:00Z', continuedTurnCount: 1, carryIncomplete: true, continuedProjectId: 'p-real' }
        : side)),
    });
    api.continueComparisonSide.mockRejectedValue(new Error('Disk full'));
    await openDetail(left, { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    const paneA = screen.getByRole('region', { name: 'Side A' });

    fireEvent.click(within(paneA).getByRole('button', { name: 'Copy the remaining files' }));

    expect(await within(paneA).findByText('Disk full')).toBeTruthy();
    expect(within(paneA).getByRole('button', { name: 'Copy the remaining files' }).disabled).toBe(false);
  });

  it('drops the offer when a failed copy finds the files it kept are gone', async () => {
    const left = comparison({
      sides: comparison().sides.map((side) => (side.label === 'a'
        ? { ...side, continuedAt: '2026-09-30T10:00:00Z', continuedTurnCount: 1, carryIncomplete: true, continuedProjectId: 'p-real' }
        : side)),
    });
    const cleared = comparison({
      sides: left.sides.map((side) => (side.label === 'a' ? { ...side, carryIncomplete: false } : side)),
    });
    api.continueComparisonSide.mockRejectedValue(new Error('The files this side left behind are gone'));
    await openDetail(left, { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    const paneA = screen.getByRole('region', { name: 'Side A' });

    api.fetchComparison.mockResolvedValue(cleared);
    fireEvent.click(within(paneA).getByRole('button', { name: 'Copy the remaining files' }));

    await waitFor(() => expect(within(paneA).queryByText(/still in this comparison/)).toBeNull());
  });

  it('opens the task when a partial carry is left as it is', async () => {
    const onOpenTask = vi.fn();
    api.continueComparisonSide.mockResolvedValue({ conversationId: 'conv-a', projectId: 'p-real', carriedAll: false });
    mockHistory([comparison()]);
    api.fetchComparison.mockResolvedValue(comparison());
    api.fetchSession.mockImplementation(async (id) => session(id, finishedTurn('p')));
    render(<CompareView models={models} projects={projects} onOpenTask={onOpenTask} />);
    fireEvent.click(await screen.findByText('Build a dashboard'));
    const paneA = await screen.findByRole('region', { name: 'Side A' });
    fireEvent.click(await within(paneA).findByRole('button', { name: 'Continue' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Continue' }));

    fireEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Open the task' }));

    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('conv-a'));
    expect(api.continueComparisonSide).toHaveBeenCalledTimes(1);
  });
});


describe('filterComparisons', () => {
  const rows = [
    // Newest-first and A–Z disagree here, so each sort is told apart.
    { id: '1', title: 'Alpha', createdAt: '2026-09-02T00:00:00Z', verdict: 'a', sides: [{ model: 'kimi' }, { model: 'qwen' }] },
    { id: '2', title: 'Beta', createdAt: '2026-09-03T00:00:00Z', verdict: null, sides: [{ model: 'glm' }, { model: 'qwen' }] },
  ];
  const ids = (list) => list.map((c) => c.id);

  it('searches prompts and model names', () => {
    expect(ids(filterComparisons(rows, { query: 'bet' }))).toEqual(['2']);
    expect(ids(filterComparisons(rows, { query: 'Kimi' }, (id) => (id === 'kimi' ? 'Kimi K2' : id)))).toEqual(['1']);
  });

  it('filters by model', () => {
    expect(ids(filterComparisons(rows, { model: 'kimi' }))).toEqual(['1']);
    expect(ids(filterComparisons(rows, { model: 'qwen' }))).toEqual(['2', '1']);
  });

  it('filters by verdict and sorts', () => {
    expect(ids(filterComparisons(rows, { verdict: 'none' }))).toEqual(['2']);
    expect(ids(filterComparisons(rows, { verdict: 'judged' }))).toEqual(['1']);
    expect(ids(filterComparisons(rows, { sort: 'recent' }))).toEqual(['2', '1']);
    expect(ids(filterComparisons(rows, { sort: 'oldest' }))).toEqual(['1', '2']);
    expect(ids(filterComparisons(rows, { sort: 'prompt' }))).toEqual(['1', '2']);
  });
});


describe('example prompts', () => {
  it('stand alone, with nothing attached, and each names what it compares', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(6);
    for (const example of EXAMPLES) {
      expect(example.prompt).not.toMatch(/attach/i);
      expect(example.hint).toMatch(/^Compares /);
    }
  });
});
