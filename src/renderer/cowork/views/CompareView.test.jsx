import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

import CompareView from './CompareView';

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
  it('says an update is needed when the server has no comparisons API', async () => {
    api.fetchComparisons.mockResolvedValue(null);
    render(<CompareView models={models} projects={projects} />);
    expect(await screen.findByText('Update needed')).toBeTruthy();
  });

  it('lists past comparisons with their models and verdict', async () => {
    api.fetchComparisons.mockResolvedValue([comparison({ verdict: 'b', sides: comparison().sides.map((s) => ({ ...s, turnCount: 3 })) })]);
    render(<CompareView models={models} projects={projects} />);
    expect(await screen.findByText('Kimi vs Qwen')).toBeTruthy();
    expect(screen.getByText('3 turns')).toBeTruthy();
    expect(screen.getByText('B was better')).toBeTruthy();
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

  it('will not send to both while one side is still answering', async () => {
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'next' } });
    fireEvent.click(screen.getByText('B only'));
    fireEvent.click(screen.getByText('Send'));
    expect(api.streamMessage).toHaveBeenCalledTimes(1);
    expect(api.streamMessage.mock.calls[0][0]).toBe('conv-b');

    fireEvent.click(screen.getByText('Both'));
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'again' } });
    expect(screen.getByText('Send').closest('button').disabled).toBe(true);
    expect(screen.getByText(/still answering/)).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText('Follow-up message'), { key: 'Enter' });
    expect(api.streamMessage).toHaveBeenCalledTimes(1);
  });

  it('reports a dropped connection but leaves an agent error to the transcript', async () => {
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    fireEvent.change(screen.getByLabelText('Follow-up message'), { target: { value: 'next' } });
    fireEvent.click(screen.getByText('Send'));
    act(() => openStreams['conv-a'].onError('Network lost', { code: 'stream_error' }));
    act(() => openStreams['conv-b'].onError('Model refused', { code: 'anton_error' }));
    expect(await screen.findByText('Network lost')).toBeTruthy();
    expect(screen.queryByText('Model refused')).toBeNull();
  });

  it('records which side was better on the latest finished turn', async () => {
    api.recordComparisonVerdict.mockResolvedValue(comparison({ verdict: 'a', verdicts: [{ turnIndex: 0, winner: 'a' }] }));
    await openDetail(comparison(), { 'conv-a': session('conv-a', finishedTurn('p')), 'conv-b': session('conv-b', finishedTurn('p')) });
    expect(screen.getByText('Turn 1: which was better?')).toBeTruthy();
    fireEvent.click(screen.getByText('A was better'));
    await waitFor(() => expect(api.recordComparisonVerdict).toHaveBeenCalledWith('cmp-1', 0, 'a'));
    await waitFor(() => expect(screen.getByText('A was better').closest('button').getAttribute('aria-pressed')).toBe('true'));
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
    expect(screen.getAllByText('compared').length).toBe(2);
    expect(screen.queryByText('asked later in its project')).toBeNull();
    expect(screen.getByText('Continued as a task')).toBeTruthy();
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
    fireEvent.click(await screen.findByText('Continue with A'));
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(api.continueComparisonSide).toHaveBeenCalledWith('cmp-1', 'a', 'p-real'));
    await waitFor(() => expect(onOpenTask).toHaveBeenCalledWith('conv-a'));
  });
});
