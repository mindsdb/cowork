// The voice call's operator loop: the model's tool calls run here, one at a
// time, their results go back, and the model's words are what gets said.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({ voiceOperate: vi.fn() }));

import { describeScreen, describeSteps, MAX_ROUNDS, runOperator } from './operator';

describe('the voice operator', () => {
  it('runs the calls in order, sends their results back and returns what to say', async () => {
    const operate = vi.fn()
      .mockResolvedValueOnce({ content: '', tool_calls: [
        { id: 'c1', name: 'create_project', arguments: { name: 'Sales' } },
        { id: 'c2', name: 'move_task', arguments: { task_id: 't1', project: 'Sales' } },
      ] })
      .mockResolvedValueOnce({ content: 'Made Sales and moved the task there.', tool_calls: [] });
    const order = [];
    const actions = {
      create_project: vi.fn(async ({ name }) => { order.push('create'); return `Created "${name}".`; }),
      move_task: vi.fn(async () => { order.push('move'); return 'Moved.'; }),
    };
    const history = [];

    const said = await runOperator({ request: 'Put this in a new Sales project.', history, snapshot: () => 'Home', actions, operate });

    expect(said).toBe('Made Sales and moved the task there.');
    expect(order).toEqual(['create', 'move']);
    const [, second] = operate.mock.calls;
    expect(second[0].slice(-3)).toEqual([
      { role: 'assistant', content: '', tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'create_project', arguments: '{"name":"Sales"}' } },
        { id: 'c2', type: 'function', function: { name: 'move_task', arguments: '{"task_id":"t1","project":"Sales"}' } },
      ] },
      { role: 'tool', tool_call_id: 'c1', content: 'Created "Sales".' },
      { role: 'tool', tool_call_id: 'c2', content: 'Moved.' },
    ]);
    expect(history.at(-1)).toEqual({ role: 'assistant', content: 'Made Sales and moved the task there.' });
  });

  it('reports a failed or unknown action to the model, and stops after a few rounds', async () => {
    const operate = vi.fn().mockResolvedValue({ tool_calls: [{ id: 'c', name: 'stop_task', arguments: { task_id: 't1' } }, { id: 'd', name: 'nope' }] });
    const history = [];
    const said = await runOperator({
      request: 'Stop it.', history, snapshot: () => '', operate,
      actions: { stop_task: async () => { throw new Error('No such task.'); } },
    });

    expect(operate).toHaveBeenCalledTimes(MAX_ROUNDS);
    expect(history.filter((m) => m.role === 'tool').slice(0, 2).map((m) => m.content))
      .toEqual(['That failed: No such task.', 'There is no action called nope.']);
    expect(said).toMatch(/more steps/);
  });

  it('describes the screen and a task\'s steps', () => {
    const tasks = [
      { id: 't1', title: 'Q3 sales', projectName: 'Sales', messages: [{ role: '_streaming', content: 'So far', steps: [
        { label: 'Opened the browser', status: 'completed' }, { label: 'Reading the report', status: 'in_progress' },
      ] }] },
      { id: 't2', title: 'Hotels', projectName: 'general', messages: [{ role: 'assistant', content: 'Booked.', steps: [] }] },
    ];
    const screen = describeScreen({ route: 'task', currentTask: tasks[0], projects: [{ name: 'general' }, { name: 'Sales' }], tasks });
    expect(screen).toContain('the task "Q3 sales" (id t1) in project "Sales"');
    expect(screen).toContain('Projects: "general", "Sales".');
    expect(screen).toContain('- id t1: "Q3 sales" in "Sales", running now');

    expect(describeSteps(tasks[0])).toBe('Running now. Its steps so far:\n- Opened the browser\n- Reading the report (running)\nIts answer so far: So far');
    expect(describeSteps(tasks[1])).toContain('Its answer: Booked.');
  });
});
