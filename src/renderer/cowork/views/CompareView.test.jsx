import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: true,
    isWeb: false,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
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
    Select: ({ value, onValueChange, options, 'aria-label': label }) => (
      <select aria-label={label} value={value} onChange={(e) => onValueChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ),
  };
});

const api = vi.hoisted(() => ({
  fetchComparisons: vi.fn(),
  fetchComparison: vi.fn(),
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

import CompareView, { filterComparisons } from './CompareView';

const models = [{ id: 'kimi', name: 'Kimi' }, { id: 'qwen', name: 'Qwen' }];
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

async function openDetail(cmp, sessions) {
  api.fetchComparisons.mockResolvedValue([cmp]);
  api.fetchComparison.mockResolvedValue(cmp);
  api.fetchSession.mockImplementation(async (id) => sessions[id]);
  render(<CompareView models={models} projects={projects} />);
  fireEvent.click(await screen.findByText(cmp.title));
  await screen.findAllByRole('region');
  await waitFor(() => expect(api.fetchSession).toHaveBeenCalledTimes(2));
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  for (const key of Object.keys(openStreams)) delete openStreams[key];
  api.fetchInFlightStatus.mockResolvedValue({ in_flight: false });
  holdStreams();
});

describe('CompareView', () => {
  it('opens on the start screen while there is no history yet', async () => {
    api.fetchComparisons.mockResolvedValue([]);
    render(<CompareView models={models} projects={projects} />);
    expect(await screen.findByRole('heading', { name: 'Compare two models' })).toBeTruthy();
    expect(screen.queryByText('Comparisons')).toBeNull();
  });

  it('swaps the two sides and fills the prompt from an example', async () => {
    api.fetchComparisons.mockResolvedValue([]);
    render(<CompareView models={models} projects={projects} />);
    const [modelA, modelB] = await screen.findAllByLabelText('model');
    fireEvent.change(modelA, { target: { value: 'kimi' } });
    fireEvent.change(modelB, { target: { value: 'qwen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Swap sides' }));
    const [afterA, afterB] = screen.getAllByLabelText('model');
    expect([afterA.value, afterB.value]).toEqual(['qwen', 'kimi']);

    fireEvent.click(screen.getByText('Build a dashboard'));
    expect(screen.getByLabelText('Task for both models').value).toMatch(/^Build a one-page HTML dashboard/);
    // Examples step aside once there is a prompt.
    expect(screen.queryByText('Try an example')).toBeNull();
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

  it('says an update is needed when the server has no comparisons API', async () => {
    api.fetchComparisons.mockResolvedValue(null);
    render(<CompareView models={models} projects={projects} />);
    expect(await screen.findByText('Update needed')).toBeTruthy();
  });

  it('lists past comparisons under column headers, with the verdict named by model', async () => {
    api.fetchComparisons.mockResolvedValue([
      comparison({ verdict: 'b', sides: comparison().sides.map((s) => ({ ...s, turnCount: 3 })) }),
      comparison({ id: 'cmp-2', title: 'Second task' }),
    ]);
    render(<CompareView models={models} projects={projects} />);
    const row = await screen.findByRole('button', { name: 'Open comparison: Build a dashboard' });
    for (const heading of ['Prompt', 'Models', 'Turns', 'Verdict', 'Started']) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
    expect(within(row).getByText('Kimi')).toBeTruthy();
    expect(within(row).getByText('Qwen')).toBeTruthy();
    expect(within(row).getByText('3')).toBeTruthy();
    expect(within(row).getByText('Qwen preferred')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: 'Open comparison: Second task' })).getByText('No verdict')).toBeTruthy();
    // Few comparisons: no search box yet.
    expect(screen.queryByPlaceholderText('Search prompts and models')).toBeNull();
  });

  it('adds search once there are more comparisons than fit at a glance', async () => {
    const many = Array.from({ length: 11 }, (_, i) => comparison({ id: `c${i}`, title: `Task ${i}` }));
    many[3] = comparison({ id: 'c3', title: 'Quarterly revenue dashboard' });
    api.fetchComparisons.mockResolvedValue(many);
    render(<CompareView models={models} projects={projects} />);
    fireEvent.change(await screen.findByPlaceholderText('Search prompts and models'), { target: { value: 'revenue' } });
    expect(screen.getByRole('button', { name: 'Open comparison: Quarterly revenue dashboard' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open comparison: Task 0' })).toBeNull();
  });

  it('starts a comparison and sends the prompt to both sides on their own settings', async () => {
    api.fetchComparisons.mockResolvedValue([]);
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
    fireEvent.change(screen.getByLabelText('Start from a project'), { target: { value: 'p-real' } });
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

  it('sends the first prompt only once', async () => {
    api.fetchComparisons.mockResolvedValue([]);
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

  const target = (name) => within(screen.getByRole('group', { name: 'Send to' })).getByText(name);

  it('picks the target by model name and will not send to both while one is working', async () => {
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    expect(screen.getByRole('button', { name: 'Send' }).disabled).toBe(true);
    fireEvent.click(target('Qwen'));
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'next' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.streamMessage).toHaveBeenCalledTimes(1);
    expect(api.streamMessage.mock.calls[0][0]).toBe('conv-b');

    // Back to Both while Qwen works: the composer says why instead of
    // offering a box that cannot send.
    fireEvent.click(target('Both'));
    expect(screen.getByText('Qwen is still working. Send to Kimi only, or wait.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Follow-up message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(target('Kimi'));
    expect(screen.getByRole('textbox', { name: 'Follow-up message' })).toBeTruthy();
  });

  it('closes the composer while both models work', async () => {
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'next' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.streamMessage).toHaveBeenCalledTimes(2);
    expect(screen.getByText('You can follow up when both models finish.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Send to' })).toBeNull();
    act(() => openStreams['conv-a'].onDone());
    await waitFor(() => expect(screen.getByText('Qwen is still working. Send to Kimi only, or wait.')).toBeTruthy());
  });

  it('shows each side under its model name with a quiet status line', async () => {
    const cmp = comparison();
    cmp.sides[1] = { ...cmp.sides[1], reasoningEffort: 'xhigh' };
    await openDetail(cmp, { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    expect(screen.getByRole('heading', { name: 'Kimi' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Qwen' })).toBeTruthy();
    expect(screen.getByText('xhigh effort')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Side A status' }).textContent).toBe('Done · 30s');
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
    expect(screen.getByText('Turn 1: which was better?')).toBeTruthy();
    fireEvent.click(screen.getByText('Kimi was better'));
    await waitFor(() => expect(api.recordComparisonVerdict).toHaveBeenCalledWith('cmp-1', 0, 'a'));
    await waitFor(() => expect(screen.getByText('Kimi was better').closest('button').getAttribute('aria-pressed')).toBe('true'));
  });

  it('offers no verdict until both sides finished', async () => {
    await openDetail(comparison(), {
      'conv-a': session('conv-a', finishedTurn('p')),
      'conv-b': session('conv-b', [{ role: 'user', content: 'p' }]),
    });
    expect(screen.queryByText(/which was better/)).toBeNull();
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
    api.fetchComparisons.mockResolvedValue([comparison()]);
    api.fetchComparison.mockResolvedValue(comparison());
    api.fetchSession.mockImplementation(async (id) => session(id, finishedTurn('p')));
    render(<CompareView models={models} projects={projects} onOpenTask={onOpenTask} />);
    fireEvent.click(await screen.findByText('Build a dashboard'));
    const paneA = await screen.findByRole('region', { name: 'Side A' });
    fireEvent.click(await within(paneA).findByText('Continue with this model'));
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(api.continueComparisonSide).toHaveBeenCalledWith('cmp-1', 'a', 'p-real'));
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('conv-a'));
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
