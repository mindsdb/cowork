import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALL_NEED_GRACE_MS, callNeedActions, createCallNeeds, describeNeed, describeWaiting, openNeed, openNeeds, pickedOption,
} from './callNeeds';
import { runOperator } from './operator';
import { createSeenCallBack } from './seenCallBack';

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
// A held send: anton words its typed text as a JSON string, line break escaped.
const SEND = card(
  'browser:approve:t-1:pa-2',
  '**Approve this browser step?**\n\nThis step may commit something for you:\n\n```\nhttps://mail.example.test/compose\n'
    + 'type "Pay the invoice to IBAN DE89 3704\\nThanks" into textbox "Message" and press Enter\n```\n\nIt runs only if you approve.',
  [{ value: 'approve', label: 'Approve', detail: 'Take this step once' }, { value: 'cancel', label: 'Cancel' }],
);
/* A live app's launch with every slot taken (anton's ask_approval_choice in
   live_app_slots.py): choosing which running app to stop approves the
   launch, so only the screen approves it, as Approve on any gate card. */
const LAUNCH_CHOOSER = card(
  'write:0123456789abcdef0123456789abcdef',
  'Launch "Flight tracker" with your Gmail connection?\n\nChoose which of your running apps to stop and replace. Nothing changes until you choose.',
  [
    { value: 'a1b2c3', label: 'Stop Sales dashboard', detail: 'Started 9:02; last request none yet; slot 1' },
    { value: 'cancel', label: 'Cancel', detail: 'Leave things as they are' },
  ],
);
// The token limit's question: Keep going's detail is what it grants.
const LIMIT = card('q-limit', 'This turn reached its 25,000,000-token limit. Keep going?', [
  { value: 'continue', label: 'Keep going', detail: 'Allow up to 100,000,000 more tokens' },
  { value: 'stop', label: 'Stop here' },
]);

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
    // A held step the app approves: held after approvals went off, by the server's clock.
    const heldLater = { ...STEP, data: { ...STEP.data, held_at_ms: 200 } };
    expect(openNeed(heldLater, { prefs: { askToApprove: false, approvalsOffAtMs: 100 } })).toBeNull();
    // One that was waiting when they went off stays the person's.
    expect(openNeed(heldLater, { prefs: { askToApprove: false, approvalsOffAtMs: 300 } })).toMatchObject({ kind: 'approval' });
    expect(openNeeds([HAND_OVER, { badge: 'Browser', data: {} }, QUESTION], { prefs: ASKS })).toHaveLength(2);
  });

  it('says what is needed in plain words, around the card’s text', () => {
    const news = describeNeed(openNeed(HAND_OVER, { prefs: ASKS }), { agentLabel: 'Anton', taskTitle: 'Flights' });
    expect(news).toContain("Check United's unaccompanied-minor policy box");
    expect(news).toContain('on united.com');
    expect(news).toMatch(/carries on by himself once it's done/);
    expect(describeNeed(openNeed(QUESTION, { prefs: ASKS }))).toContain('Options:\n- "Window"\n- "Aisle"');
  });

  it('lists them for the operator as data, with the tool that answers each', () => {
    const lines = describeWaiting([{ id: 't-1', title: 'Flights', needs: openNeeds([HAND_OVER, STEP, QUESTION], { prefs: ASKS }) }]);
    expect(lines[0]).toBe('Anton is waiting on the user in task t-1 ("Flights"), as data:');
    expect(lines.join('\n')).toMatch(/browser hand-over \(.*browser_done\) on united.com: Check United/);
    expect(lines.join('\n')).toMatch(/step to approve \(they approve it on the screen; .*cancel_step\) on united.com: Type into/);
    expect(lines.join('\n')).toMatch(/a question \(answer_question, with one of the options below\): Which seat/);
    expect(lines.join('\n')).not.toMatch(/answer_approval/);
  });

  // The operator's snapshot cuts each line at 300 characters; a hostname can run to 253.
  it('names the tool before the page’s site, so a long site never cuts it off', () => {
    const site = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(48)}.com`;
    const lines = describeWaiting([{ id: 't-1', title: 'Flights', needs: [
      { questionId: 'h', kind: 'handOver', site, text: 'Sign in', options: [] },
      { questionId: 's', kind: 'approval', site, text: 'Click "Pay"', options: [] },
    ] }]);
    expect(lines[1].slice(0, 300)).toContain('browser_done');
    expect(lines[2].slice(0, 300)).toContain('cancel_step');
  });

  // browser_done, cancel_step and answer_question all take the task's id.
  it('names the task’s id before its title, so a long title never cuts it off', () => {
    const id = 'c0ffee00-1234-4abc-8def-0123456789ab';
    const lines = describeWaiting([{ id, title: 'Book flights '.repeat(23).slice(0, 290), needs: [
      { questionId: 'h', kind: 'handOver', site: 'united.com', text: 'Sign in', options: [] },
    ] }]);
    expect(lines[0].length).toBeGreaterThan(300);
    expect(lines[0].slice(0, 300)).toContain(id);
  });

  it('never gives the call the text a held step types', () => {
    const need = openNeed(SEND, { prefs: ASKS });
    expect(need).toMatchObject({ kind: 'approval', site: 'mail.example.test', text: 'Type into textbox "Message" and press Enter' });
    const said = [
      JSON.stringify(need),
      describeNeed(need, { taskTitle: 'Invoices' }),
      ...describeWaiting([{ id: 't-1', title: 'Invoices', needs: [need] }]),
    ].join('\n');
    expect(said).not.toMatch(/IBAN|Thanks|Pay the invoice/);
  });

  it('says a held step is approved on the screen, and only cancelled by voice', () => {
    expect(describeNeed(openNeed(STEP, { prefs: ASKS }))).toMatch(/They approve it on the screen; by voice they can only cancel it\./);
  });

  it('says each option with its detail, one per line, so a long question keeps them', () => {
    const need = openNeed(LIMIT, { prefs: ASKS });
    expect(need.options[0]).toEqual({ value: 'continue', label: 'Keep going', detail: 'Allow up to 100,000,000 more tokens' });
    expect(describeNeed(need).split('\n')).toEqual([
      'Anton asks the user: "This turn reached its 25,000,000-token limit. Keep going?". Options:',
      '- "Keep going": Allow up to 100,000,000 more tokens',
      '- "Stop here"',
    ]);
    // A question longer than the operator's 300-character line cut still has its options on lines of their own.
    const long = openNeed(card('q-long', `${'Which of these flights should I book for the conference trip? '.repeat(8)}`, LIMIT.data.options), { prefs: ASKS });
    const lines = describeWaiting([{ id: 't-1', title: 'Trip', needs: [long] }]);
    expect(lines.slice(-2)).toEqual([
      '  - option "Keep going": Allow up to 100,000,000 more tokens',
      '  - option "Stop here"',
    ]);
    expect(lines[1].slice(0, 300)).toMatch(/^- a question \(answer_question, with one of the options below\): Which/);
    lines.forEach((line) => expect(line.length).toBeLessThanOrEqual(400));
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
  let seen;
  // The call back the hung-up call left armed (App.jsx's callBackRef).
  let armed;

  const make = (overrides = {}) => {
    doc = {
      visibilityState: 'visible',
      listeners: [],
      addEventListener: vi.fn((_, fn) => doc.listeners.push(fn)),
      removeEventListener: vi.fn((_, fn) => { doc.listeners = doc.listeners.filter((f) => f !== fn); }),
      show: () => {
        doc.visibilityState = 'visible';
        [...doc.listeners].forEach((fn) => fn());
      },
    };
    armed = true;
    deps = {
      hasCallWork: (tid) => tid === 't-1',
      stepsOf: (tid) => steps[tid],
      titleOf: () => 'Flights',
      announce: vi.fn(() => false),
      callBackDue: vi.fn(() => armed),
      canCallBack: () => true,
      take: vi.fn(() => { armed = false; }),
      callBack: vi.fn(),
      prefs: () => ASKS,
      ...overrides,
    };
    // The one call back that waits for the tab, as App.jsx wires it.
    seen = createSeenCallBack({
      announce: (news) => deps.announce(news), canCallBack: deps.canCallBack, take: deps.take, callBack: deps.callBack, doc,
    });
    return createCallNeeds({ ...deps, seen });
  };
  // A result of the call's work, reported as App.jsx's reportCallWork does.
  const reportResult = (news) => {
    if (deps.announce(news)) return;
    if (seen.join(news)) return;
    if (!armed) return;
    armed = false;
    seen.callBack(news);
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
    expect(deps.take).toHaveBeenCalledOnce();
    expect(deps.callBack).toHaveBeenCalledOnce();
    expect(deps.callBack.mock.calls[0][0]).toContain("Check United's unaccompanied-minor policy box");
    expect(deps.callBack.mock.calls[0][1]).toEqual({ asks: true });
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
    doc.show();
    expect(deps.callBack).not.toHaveBeenCalled();
    // The call back stays armed: the work's result still calls back.
    expect(armed).toBe(true);
    reportResult('Anton finished "flights": from $212.');
    expect(deps.callBack).toHaveBeenCalledWith('Anton finished "flights": from $212.', { asks: false });
  });

  it('calls back once the tab is in sight again', () => {
    const needs = make();
    doc.visibilityState = 'hidden';
    needs.note(['t-1'], steps['t-1']);
    vi.advanceTimersByTime(CALL_NEED_GRACE_MS);
    doc.show();
    expect(deps.callBack).toHaveBeenCalledOnce();
  });

  it('leaves a call the person ended alone', () => {
    const needs = make({ callBackDue: () => false });
    needs.note(['t-1'], steps['t-1']);
    vi.advanceTimersByTime(CALL_NEED_GRACE_MS);
    expect(deps.callBack).not.toHaveBeenCalled();
  });

  /* The call hung up with work running in two tasks, and the tab is out of
     sight. Task 1 stops on a hand-over and task 2 finishes, in either order:
     the one call back that waits for the tab says both. */
  it('says a hand-over and a result that came while the tab waited in one call back, in either order', () => {
    const result = 'Anton finished "hotels": from $140.';
    for (const order of ['hand-over first', 'result first']) {
      steps = { 't-1': [HAND_OVER] };
      const needs = make();
      doc.visibilityState = 'hidden';
      if (order === 'result first') reportResult(result);
      needs.note(['t-1'], steps['t-1']);
      vi.advanceTimersByTime(CALL_NEED_GRACE_MS);
      if (order === 'hand-over first') reportResult(result);
      expect(deps.callBack).not.toHaveBeenCalled();
      doc.show();
      expect(deps.callBack, order).toHaveBeenCalledOnce();
      const [news, options] = deps.callBack.mock.calls[0];
      expect(news, order).toContain("Check United's unaccompanied-minor policy box");
      expect(news, order).toContain(result);
      expect(options, order).toEqual({ asks: true });
    }
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

  it('opens the pane for a web viewer that isn’t there yet, and says the hand-back hasn’t gone yet', async () => {
    steps = [HAND_OVER];
    const actions = make({ handBack: vi.fn(async () => 'waiting') });
    expect(await actions.browser_done({ task_id: 't-1' })).toBe(
      'Opening the browser in "Flights" to hand it back: it goes once the browser shows, then Anton carries on. '
        + "If it doesn't open, they can click Done in the browser.",
    );
    expect(deps.showBrowser).toHaveBeenCalledWith(task, 's-1');
  });

  it('refuses a Done with no hand-over open', async () => {
    steps = [QUESTION];
    const actions = make();
    expect(await actions.browser_done({ task_id: 't-1' })).toMatch(/Nothing in "Flights" is waiting on the browser/);
    expect(deps.handBack).not.toHaveBeenCalled();
  });

  it('cancels a held step, declining it in the browser first', async () => {
    steps = [STEP];
    const actions = make();
    expect(await actions.cancel_step({ task_id: 't-1' })).toMatch(/Cancelled/);
    expect(deps.decline).toHaveBeenCalledWith('browser:approve:t-1:pa-1');
    expect(deps.submit).toHaveBeenCalledWith('t-1', 'browser:approve:t-1:pa-1', { values: ['cancel'] });
  });

  it('says a cancel the screen answered first cancelled nothing', async () => {
    for (const status of ['already_answered', 'not_found']) {
      steps = [STEP];
      const actions = make({ submit: vi.fn(async () => ({ status })) });
      const said = await actions.cancel_step({ task_id: 't-1' });
      // Approved on the screen a moment ago: the step may already have run.
      expect(said).not.toMatch(/^Cancelled/);
      expect(said).toMatch(/already answered on the screen/);
    }
  });

  it('only cancels a gate card that picks which app a launch replaces', async () => {
    steps = [LAUNCH_CHOOSER];
    const actions = make();
    expect(openNeed(LAUNCH_CHOOSER, { prefs: ASKS })).toMatchObject({ kind: 'approval' });
    // Choosing an app is the launch's approval: no voice answer picks one.
    expect(await actions.answer_question({ task_id: 't-1', option: 'Stop Sales dashboard' }))
      .toBe('Nothing in "Flights" is waiting for an answer.');
    expect(deps.submit).not.toHaveBeenCalled();
    expect(await actions.cancel_step({ task_id: 't-1' })).toMatch(/^Cancelled/);
    expect(deps.submit).toHaveBeenCalledWith('t-1', LAUNCH_CHOOSER.data.question_id, { values: ['cancel'] });
  });

  it('has no action that approves a held step', async () => {
    steps = [STEP];
    const actions = make();
    expect(Object.keys(actions).sort()).toEqual(['answer_question', 'browser_done', 'cancel_step']);
    // Whatever arguments it is given, cancel_step only ever cancels.
    await actions.cancel_step({ task_id: 't-1', approve: true });
    expect(deps.submit.mock.calls.map(([, , answer]) => answer)).toEqual([{ values: ['cancel'] }]);
    // An older server's answer_approval names no action here, so the operator runs nothing.
    expect(actions.answer_approval).toBeUndefined();
  });

  it('runs nothing for an answer_approval call from an older server', async () => {
    steps = [STEP];
    const actions = make();
    const operate = vi.fn()
      .mockResolvedValueOnce({ content: '', tool_calls: [{ id: 'c1', name: 'answer_approval', arguments: { task_id: 't-1', approve: true } }] })
      .mockResolvedValueOnce({ content: 'Approve it on the screen.', tool_calls: [] });
    const said = await runOperator({ request: 'yes', history: [], snapshot: () => '', actions, operate });
    expect(said).toBe('Approve it on the screen.');
    expect(operate.mock.calls[1][0].at(-1)).toMatchObject({ role: 'tool', content: 'There is no action called answer_approval.' });
    expect(deps.submit).not.toHaveBeenCalled();
    expect(deps.decline).not.toHaveBeenCalled();
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
