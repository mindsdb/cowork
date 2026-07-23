import { describe, expect, it } from 'vitest';
import { initialStreamState, reduceStream } from './responseStreamAdapter';

const requested = {
  type: 'response.approval_requested',
  approval: {
    id: 'ap-1',
    conversationId: 'c-1',
    kind: 'action',
    status: 'pending',
    actionDescriptor: { tool: 'browser_click', args: { index: 3 }, summary: 'Send the reply' },
    draft: 'Thanks Abi',
  },
};

const resolved = {
  type: 'response.approval_resolved',
  approval: {
    id: 'ap-1',
    conversationId: 'c-1',
    kind: 'action',
    status: 'approved',
    actionDescriptor: { tool: 'browser_click', args: { index: 3 }, summary: 'Send the reply' },
    draft: 'Thanks Abi',
  },
};

const init = initialStreamState();

describe('approval events', () => {
  it('approval_requested parks a card', () => {
    const state = reduceStream(init, requested, () => 1);
    const step = state.steps.find((s) => s.badge === 'Approval');
    expect(step).toBeTruthy();
    expect(step.label).toBe('Send the reply');
    expect(step.data.approval.status).toBe('pending');
    expect(step._approvalId).toBe('ap-1');
  });

  it('approval_resolved updates the same card instead of duplicating', () => {
    let state = reduceStream(init, requested, () => 1);
    state = reduceStream(state, resolved, () => 2);
    const cards = state.steps.filter((s) => s.badge === 'Approval');
    expect(cards).toHaveLength(1);
    expect(cards[0].data.approval.status).toBe('approved');
  });

  it('duplicate requested events dedupe by approval id', () => {
    let state = reduceStream(init, requested, () => 1);
    state = reduceStream(state, requested, () => 2, { replay: true });
    expect(state.steps.filter((s) => s.badge === 'Approval')).toHaveLength(1);
  });

  it('missing id is ignored', () => {
    const state = reduceStream(init, { type: 'response.approval_requested', approval: {} }, () => 1);
    expect(state.steps.filter((s) => s.badge === 'Approval')).toHaveLength(0);
  });
});
