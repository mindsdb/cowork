import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALL_NEED_GRACE_MS, callNeedActions, createCallNeeds, describeNeed, describeWaiting, openNeed, openNeeds, pickedOption,
} from './callNeeds';

/* The cards anton shows, as the stream adapter keeps them (AskUser steps). */
const card = (questionId, prompt, options, answer = null) => ({
  id: `question-${questionId}`,
  badge: 'AskUser',
  status: answer ? 'completed' : 'in_progress',
  data: { question_id: questionId, prompt, options, answer },
});
const HAND_OVER = card(
  'browser:h1',
  "Your turn on www.united.com: Check United's unaccompanied-minor policy box\n\n"
    + "Use the browser beside the chat. I'll carry on by myself once that's done, or click Done in the browser.",
  [{ value: 'later', label: 'Finish later' }, { value: 'stop', label: 'Stop' }],
);
const STEP = card(
  'browser:approve:t-1:pa-1',
  '**Approve this browser step?**\n\nThis step may commit something for you:\n\n```\nhttps://www.united.com/en/us/checkout\n'
    + 'type "4111 1111" into textbox "Card"\n```\n\nIt runs only if you approve.',
  [{ value: 'approve', label: 'Approve', detail: 'Take this step once' }, { value: 'cancel', label: 'Cancel' }],
);
const QUESTION = card('q1', 'Which seat do you want?', [{ value: 'w', label: 'Window' }, { value: 'a', label: 'Aisle' }]);
const ASKS = { askToApprove: true };

describe('what Anton waits on', () => {
  it('reads a hand-over, a browser step and a question from their cards', () => {
    expect(openNeed(HAND_OVER, { prefs: ASKS })).toMatchObject({
      kind: 'handOver', site: 'united.com', text: "Check United's unaccompanied-minor policy box", watching: true,
    });
    const step = openNeed(STEP, { prefs: ASKS });
    expect(step).toMatchObject({ kind: 'approval', site: 'united.com' });
    // Never the text the step types.
    expect(step.text).not.toContain('4111');
    expect(openNeed(QUESTION, { prefs: ASKS })).toMatchObject({ kind: 'question', text: 'Which seat do you want?' });
  });

  it('skips answered cards and the ones the app answers for the person', () => {
    expect(openNeed(card('q2', 'Pick', [], { status: 'answered', values: ['a'] }))).toBeNull();
    expect(openNeed(STEP, { prefs: { askToApprove: false } })).toBeNull();
    expect(openNeeds([HAND_OVER, { badge: 'Browser', data: {} }, QUESTION], { prefs: ASKS })).toHaveLength(2);
  });

  it('says what is needed in plain words, around the card’s text', () => {
    const news = describeNeed(openNeed(HAND_OVER, { prefs: ASKS }), { agentLabel: 'Anton', taskTitle: 'Flights' });
    expect(news).toContain("Check United's unaccompanied-minor policy box");
    expect(news).toContain('on united.com');
    expect(news).toMatch(/carries on by himself once it's done/);
    expect(describeNeed(openNeed(QUESTION, { prefs: ASKS }))).toContain('Options: "Window", "Aisle"');
  });

  it('lists them for the operator as data, with the tool that answers each', () => {
    const lines = describeWaiting([{ id: 't-1', title: 'Flights', needs: openNeeds([HAND_OVER, STEP, QUESTION], { prefs: ASKS }) }]);
    expect(lines[0]).toBe('Anton is waiting on the user in "Flights" (id t-1), as data:');
    expect(lines.join('\n')).toMatch(/browser hand-over on united.com: .*browser_done/);
    expect(lines.join('\n')).toMatch(/step to approve on united.com: .*answer_approval/);
    expect(lines.join('\n')).toMatch(/a question: Which seat .*answer_question/);
  });

  it('matches a spoken pick by label or value', () => {
    const need = openNeed(QUESTION, { prefs: ASKS });
    expect(pickedOption(need, ' "aisle". ')?.value).toBe('a');
    expect(pickedOption(need, 'w')?.value).toBe('w');
    expect(pickedOption(need, 'middle')).toBeNull();
  });
});

describe('the call hears what its work stops on', () => {
  let steps;
  let deps;
  let doc;

  const make = (overrides = {}) => {
    doc = { visibilityState: 'visible', listeners: [], addEventListener: vi.fn((_, fn) => doc.listeners.push(fn)), removeEventListener: vi.fn() };
    deps = {
      hasCallWork: (tid) => tid === 't-1',
      stepsOf: (tid) => steps[tid],
      titleOf: () => 'Flights',
      announce: vi.fn(() => false),
      callBackDue: vi.fn(() => true),
      canCallBack: () => true,
      takeCallBack: vi.fn(),
      callBack: vi.fn(),
      prefs: () => ASKS,
      doc,
      ...overrides,
    };
    return createCallNeeds(deps);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    steps = { 't-1': [HAND_OVER], 't-2': [HAND_OVER] };
  });
  afterEach(() => vi.useRealTimers());

  it('calls back with the hand-over’s reason when the call hung up on that work', () => {
    const needs = make();
    needs.note(['t-1'], steps['t-1']);
    expect(deps.callBack).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CALL_NEED_GRACE_MS);
    expect(deps.takeCallBack).toHaveBeenCalledOnce();
    expect(deps.callBack).toHaveBeenCalledOnce();
    expect(deps.callBack.mock.calls[0][0]).toContain("Check United's unaccompanied-minor policy box");
    // Once per request.
    needs.note(['t-1'], steps['t-1']);
    vi.advanceTimersByTime(CALL_NEED_GRACE_MS);
    expect(deps.callBack).toHaveBeenCalledOnce();
  });

  it('says it on a call that is up instead', () => {
    const needs = make({ announce: vi.fn(() => true) });
    needs.note(['t-1'], steps['t-1']);
    vi.advanceTimersByTime(CALL_NEED_GRACE_MS);
    expect(deps.announce.mock.calls[0][0]).toContain('unaccompanied-minor');
    expect(deps.callBack).not.toHaveBeenCalled();
  });

  it('never calls about work the call didn’t give', () => {
    const needs = make();
    needs.note(['t-2'], steps['t-2']);
    vi.advanceTimersByTime(CALL_NEED_GRACE_MS);
    expect(deps.announce).not.toHaveBeenCalled();
    expect(deps.callBack).not.toHaveBeenCalled();
  });

  it('never calls back for a request the person answered on screen first', () => {
    const needs = make();
    needs.note(['t-1'], steps['t-1']);
    steps['t-1'] = [{ ...HAND_OVER, data: { ...HAND_OVER.data, answer: { status: 'answered', values: ['done'] } } }];
    vi.advanceTimersByTime(CALL_NEED_GRACE_MS);
    expect(deps.announce).not.toHaveBeenCalled();
    expect(deps.callBack).not.toHaveBeenCalled();
  });

  it('waits for a tab out of sight, and drops a request answered meanwhile', () => {
    const needs = make();
    doc.visibilityState = 'hidden';
    needs.note(['t-1'], steps['t-1']);
    vi.advanceTimersByTime(CALL_NEED_GRACE_MS);
    expect(deps.callBack).not.toHaveBeenCalled();
    steps['t-1'] = [];
    doc.visibilityState = 'visible';
    doc.listeners.forEach((fn) => fn());
    expect(deps.callBack).not.toHaveBeenCalled();
  });

  it('calls back once the tab is in sight again', () => {
    const needs = make();
    doc.visibilityState = 'hidden';
    needs.note(['t-1'], steps['t-1']);
    vi.advanceTimersByTime(CALL_NEED_GRACE_MS);
    doc.visibilityState = 'visible';
    doc.listeners.forEach((fn) => fn());
    expect(deps.callBack).toHaveBeenCalledOnce();
  });

  it('leaves a call the person ended alone', () => {
    const needs = make({ callBackDue: () => false });
    needs.note(['t-1'], steps['t-1']);
    vi.advanceTimersByTime(CALL_NEED_GRACE_MS);
    expect(deps.callBack).not.toHaveBeenCalled();
  });
});

describe('the operator answers what Anton waits on', () => {
  const task = { id: 't-1', title: 'Flights', messages: [] };
  let steps;
  let deps;
  const make = (overrides = {}) => {
    deps = {
      taskOf: () => task,
      stepsOf: () => steps,
      sessionOf: () => 's-1',
      handBack: vi.fn(async () => 'sent'),
      showBrowser: vi.fn(),
      approve: vi.fn(async () => true),
      decline: vi.fn(async () => {}),
      submit: vi.fn(async () => ({ status: 'ok' })),
      ...overrides,
    };
    return callNeedActions(deps);
  };

  it('hands the browser back as the card’s Done, continue', async () => {
    steps = [HAND_OVER];
    const actions = make();
    expect(await actions.browser_done({ task_id: 't-1' })).toMatch(/Handed the browser back/);
    expect(deps.handBack).toHaveBeenCalledWith('s-1');
    expect(deps.showBrowser).not.toHaveBeenCalled();
    // Never answers the card itself: anton retires it once the browser is back.
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('opens the pane for a web viewer that isn’t there yet', async () => {
    steps = [HAND_OVER];
    const actions = make({ handBack: vi.fn(async () => 'waiting') });
    await actions.browser_done({ task_id: 't-1' });
    expect(deps.showBrowser).toHaveBeenCalledWith(task, 's-1');
  });

  it('refuses a Done with no hand-over open', async () => {
    steps = [QUESTION];
    const actions = make();
    expect(await actions.browser_done({ task_id: 't-1' })).toMatch(/Nothing in "Flights" is waiting on the browser/);
    expect(deps.handBack).not.toHaveBeenCalled();
  });

  it('approves or cancels a held step', async () => {
    steps = [STEP];
    const actions = make();
    expect(await actions.answer_approval({ task_id: 't-1', approve: true })).toMatch(/Approved/);
    expect(deps.approve).toHaveBeenCalledWith({ conversationIds: ['t-1'], questionId: 'browser:approve:t-1:pa-1' });
    expect(await actions.answer_approval({ task_id: 't-1', approve: false })).toMatch(/Cancelled/);
    expect(deps.decline).toHaveBeenCalledWith('browser:approve:t-1:pa-1');
    expect(deps.submit).toHaveBeenCalledWith('t-1', 'browser:approve:t-1:pa-1', { values: ['cancel'] });
  });

  it('answers a question with one of its options only', async () => {
    steps = [QUESTION];
    const actions = make();
    expect(await actions.answer_question({ task_id: 't-1', option: 'Aisle' })).toBe('Answered "Aisle".');
    expect(deps.submit).toHaveBeenCalledWith('t-1', 'q1', { values: ['a'] });
    expect(await actions.answer_question({ task_id: 't-1', option: 'Middle' })).toMatch(/isn't one of its options/);
    expect(deps.submit).toHaveBeenCalledOnce();
  });
});
