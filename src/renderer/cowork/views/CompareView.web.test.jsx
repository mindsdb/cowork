// The web build: web turns don't carry a reasoning effort yet, so Compare
// offers none and sends none (EFFORT_SUPPORTED reads host.isWeb at import).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: true }));
vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isWeb: true,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

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

const api = vi.hoisted(() => ({
  fetchComparisons: vi.fn(),
  fetchComparison: vi.fn(),
  fetchComparisonUsage: vi.fn(),
  createComparison: vi.fn(),
  fetchSession: vi.fn(),
  fetchInFlightStatus: vi.fn(),
  streamMessage: vi.fn(),
  uploadAttachments: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...api }));

import CompareView from './CompareView';

const models = [{ id: 'kimi', name: 'Kimi' }, { id: 'qwen', name: 'Qwen' }];
// Both models advertise efforts, so only the web rule keeps them off.
const modelMeta = { modelEfforts: { kimi: { efforts: ['low', 'high'] }, qwen: { efforts: ['low', 'xhigh'] } } };
const side = (label, model) => ({
  label, model, reasoningEffort: null, projectId: `p-${label}`, conversationId: `conv-${label}`,
  turnCount: 0, continuedAt: null, continuedTurnCount: null,
});
const comparison = {
  id: 'cmp-1', title: 'go', createdAt: '2026-09-23T10:00:00Z', updatedAt: '2026-09-23T10:00:00Z',
  sourceProjectId: null, sourceProjectLabel: null, verdict: null, verdicts: [],
  sides: [side('a', 'kimi'), side('b', 'qwen')],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchComparisons.mockResolvedValue({ comparisons: [], hasMore: false });
  api.createComparison.mockResolvedValue(comparison);
  api.fetchComparison.mockResolvedValue(comparison);
  api.fetchComparisonUsage.mockResolvedValue(null);
  api.fetchInFlightStatus.mockResolvedValue({ in_flight: false });
  api.fetchSession.mockImplementation(async (id) => ({ id, title: 't', status: 'idle', messages: [], projectName: `_comparison-${id}`, projectPath: `/p/${id}` }));
  api.streamMessage.mockImplementation(() => ({ abort: vi.fn() }));
});

describe('Compare Models on the web build', () => {
  it('offers no reasoning effort and sends none', async () => {
    render(<CompareView models={models} modelMeta={modelMeta} projects={[]} />);
    fireEvent.click((await screen.findAllByText('New comparison'))[0]);
    fireEvent.change(screen.getByLabelText('Task for both models'), { target: { value: 'go' } });
    const [modelA, modelB] = screen.getAllByLabelText('model');
    fireEvent.change(modelA, { target: { value: 'kimi' } });
    fireEvent.change(modelB, { target: { value: 'qwen' } });
    expect(screen.queryAllByLabelText('effort')).toHaveLength(0);

    fireEvent.click(screen.getByText('Start comparison'));
    await waitFor(() => expect(api.streamMessage).toHaveBeenCalledTimes(2));
    const { sides } = api.createComparison.mock.calls[0][0];
    expect(sides.map((s) => s.reasoningEffort ?? null)).toEqual([null, null]);
    for (const [, , opts] of api.streamMessage.mock.calls) expect(opts.reasoningEffort).toBeUndefined();
  });
});
