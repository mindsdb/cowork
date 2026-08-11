import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScratchpadModal } from './ScratchpadModal';

function toolCallStep(overrides = {}) {
  return {
    id: 'step-1',
    label: 'test_tool',
    badge: 'Tool',
    icon: 'code',
    status: 'in_progress',
    startedAt: 1000,
    completedAt: null,
    data: { one_line_description: 'step 1 executing' },
    output: null,
    result: null,
    _isScratchpad: false,
    _isToolCall: true,
    _scratchpadTabId: 'tc_1',
    _toolUseId: 'tc_1',
    ...overrides,
  };
}

function scratchpadStep(overrides = {}) {
  return {
    id: 'sp-1',
    label: 'Running code',
    status: 'in_progress',
    startedAt: 1000,
    completedAt: null,
    data: { one_line_description: 'Doing the thing', code: 'print(1)' },
    output: 'ok',
    result: null,
    _isScratchpad: true,
    _isToolCall: false,
    _scratchpadTabId: 'pad_1',
    _toolUseId: 'sp_1',
    ...overrides,
  };
}

describe('ScratchpadModal — ENG-763 stage 2 fixes for generic tool-call steps', () => {
  it('gives each unrelated tool call its own pad instead of numbering them as steps of one', () => {
    // Three separate test_tool invocations — NOT three cells of one
    // session. Before the fix, all three shared _scratchpadTabId: null
    // and collapsed into one "Untitled" pad, showing "step 1/3" etc.
    const steps = [
      toolCallStep({ id: 'a', label: 'test_tool', _scratchpadTabId: 'tc_1', _toolUseId: 'tc_1' }),
      toolCallStep({ id: 'b', label: 'test_tool', _scratchpadTabId: 'tc_2', _toolUseId: 'tc_2' }),
      toolCallStep({ id: 'c', label: 'test_tool', _scratchpadTabId: 'tc_3', _toolUseId: 'tc_3' }),
    ];
    render(
      <ScratchpadModal open onClose={vi.fn()} steps={steps} focusStepId="a" />,
    );

    // Three independent tabs, not one shared pad.
    expect(screen.getAllByText('test_tool').length).toBeGreaterThanOrEqual(3);
    // Each pad has exactly one cell — never "step 1/3".
    expect(screen.getByText(/step 1\/1/)).toBeTruthy();
    expect(screen.queryByText(/step 1\/3/)).toBeNull();
    expect(screen.queryByText(/step 2\/3/)).toBeNull();
  });

  it('titles the modal after the tool, not "Scratchpad", when there are no scratchpad cells', () => {
    render(
      <ScratchpadModal
        open
        onClose={vi.fn()}
        steps={[toolCallStep()]}
        focusStepId="step-1"
      />,
    );
    expect(screen.queryByText('Scratchpad')).toBeNull();
    expect(screen.getAllByText('test_tool').length).toBeGreaterThan(0);
  });

  it('keeps the "Scratchpad" title when the active pad is a real scratchpad cell', () => {
    render(
      <ScratchpadModal
        open
        onClose={vi.fn()}
        steps={[scratchpadStep()]}
        focusStepId="sp-1"
      />,
    );
    expect(screen.getByText('Scratchpad')).toBeTruthy();
  });

  it('does not show an Args toggle for a tool call with no real arguments', () => {
    // data only carries our own live-progress bookkeeping field
    // (one_line_description) — not a real argument. Before the fix,
    // this rendered a non-empty "Args" toggle whose JSON was just that
    // internal field.
    render(
      <ScratchpadModal
        open
        onClose={vi.fn()}
        steps={[toolCallStep({ data: { one_line_description: 'step 1 executing' } })]}
        focusStepId="step-1"
      />,
    );
    expect(screen.queryByRole('switch', { name: /args/i })).toBeNull();
  });

  it('still shows an Args toggle for a tool call that does have real arguments', () => {
    render(
      <ScratchpadModal
        open
        onClose={vi.fn()}
        steps={[toolCallStep({ data: { query: 'weather in Paris' } })]}
        focusStepId="step-1"
      />,
    );
    expect(screen.getByRole('switch', { name: /args/i })).toBeTruthy();
  });
});
