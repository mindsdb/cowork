import { describe, expect, it, vi } from 'vitest';
import approveFixture from '../__fixtures__/browser-router/approve.json';
import { resetBrowserPrefsForTests } from './browserPrefs';
import {
  approveIfApprovalsOff,
  autoApprovePositionClick,
  isPositionClickCard,
  isPersonsBrowserTurn,
  isAutoApprovedCard,
  isBrowserStepCard,
  STEP_APPROVE_DETAIL,
  POSITION_APPROVE_DETAIL,
  approvalRefusalText,
  browserApprovalIds,
  declineBrowserApproval,
  isBrowserApprovalCard,
  recordBrowserApproval,
} from './browserApproval';

const APPROVED = approveFixture.examples.approved.body;
const PENDING = APPROVED.pending_id;

describe('browserApprovalIds', () => {
  it('reads both ids from a commit-hold card', () => {
    expect(browserApprovalIds(`browser:approve:t-abc:${PENDING}`)).toEqual({ sessionId: 't-abc', pendingId: PENDING });
  });

  it('marks a card by its prefix, whether or not its ids can be read', () => {
    for (const id of [`browser:approve:t-abc:${PENDING}`, 'browser:approve:t-abc:pa-1:extra', 'browser:approve:t a:pa-1', 'browser:approve:']) {
      expect(isBrowserApprovalCard(id)).toBe(true);
    }
    for (const id of ['ask:1', 'write:held:pa-1:abc', 'browser:approved:t-abc:pa-1', null, 42]) {
      expect(isBrowserApprovalCard(id)).toBe(false);
    }
  });

  it('is null for any other card', () => {
    for (const id of ['ask:1', 'write:held:pa-1:abc', 'browser:approve:t-abc', 'browser:approve:t-abc:pa-1:extra', 'browser:approve:t a:pa-1', `browser:approve:${'x'.repeat(65)}:pa-1`, null, 42]) {
      expect(browserApprovalIds(id)).toBeNull();
    }
  });
});

describe('recordBrowserApproval', () => {
  const ids = { sessionId: 't-abc', pendingId: PENDING };

  it("takes the browser's confirmation of that step (cowork-server's approve.json)", async () => {
    const approve = vi.fn(async () => APPROVED);
    await expect(recordBrowserApproval(ids, approve)).resolves.toEqual({ ok: true });
    expect(approve).toHaveBeenCalledWith('t-abc', PENDING);
  });

  it('refuses a confirmation of another step or one that does not say approved', async () => {
    for (const answer of [{ ...APPROVED, pending_id: 'pa-other' }, { ...APPROVED, approved: false }, null]) {
      const result = await recordBrowserApproval(ids, async () => answer);
      expect(result.ok).toBe(false);
    }
  });

  it('says why when the browser refuses', async () => {
    const refuse = (status, code, message = `API /browse/approve returned ${status}`) => async () => {
      throw Object.assign(new Error(message), { status, code });
    };
    await expect(recordBrowserApproval(ids, refuse(424, 'approval_lapsed'))).resolves.toEqual({ ok: false, message: 'This step is no longer waiting in the browser, so nothing ran.' });
    // No running browser holds no step either.
    await expect(recordBrowserApproval(ids, refuse(424, 'session_not_found'))).resolves.toEqual({ ok: false, message: 'This step is no longer waiting in the browser, so nothing ran.' });
    await expect(recordBrowserApproval(ids, refuse(409, 'unavailable'))).resolves.toEqual({ ok: false, message: "The browser isn't available here, so nothing ran." });
    await expect(recordBrowserApproval(ids, refuse(424, 'browser_unreachable', 'The browser isn\'t reachable.'))).resolves.toEqual({ ok: false, message: "Couldn't approve this step in the browser: The browser isn't reachable." });
    expect(approvalRefusalText(Object.assign(new Error('API /browse/approve returned 500'), { status: 500 }))).toBe("Couldn't approve this step in the browser. Try again.");
  });

  it("never shows a network or parse error's own text", async () => {
    for (const err of [new TypeError('Failed to fetch'), new SyntaxError('Unexpected token \'<\', "<!doctype "... is not valid JSON')]) {
      await expect(recordBrowserApproval(ids, async () => { throw err; })).resolves.toEqual({ ok: false, message: "Couldn't approve this step in the browser. Try again." });
    }
  });
});

describe('declineBrowserApproval', () => {
  const ids = { sessionId: 't-abc', pendingId: PENDING };

  it('declines that step', async () => {
    const decline = vi.fn(async () => ({}));
    await declineBrowserApproval(ids, decline);
    expect(decline).toHaveBeenCalledWith('t-abc', PENDING);
  });

  it('never throws, whatever the browser answers', async () => {
    for (const err of [
      Object.assign(new Error('API /browse/decline returned 404'), { status: 404 }),
      Object.assign(new Error('API /browse/decline returned 424'), { status: 424, code: 'approval_lapsed' }),
      new TypeError('Failed to fetch'),
    ]) {
      await expect(declineBrowserApproval(ids, async () => { throw err; })).resolves.toBeUndefined();
    }
  });
});

describe('position clicks', () => {
  const POSITION = { options: [{ value: 'approve', label: 'Approve', detail: POSITION_APPROVE_DETAIL }, { value: 'cancel' }] };
  const COMMIT = { options: [{ value: 'approve', label: 'Approve', detail: 'Take this step once' }] };

  it('tells a position card from a commit card', () => {
    expect(isPositionClickCard(POSITION)).toBe(true);
    expect(isPositionClickCard(COMMIT)).toBe(false);
    expect(isPositionClickCard(null)).toBe(false);
  });

  it('records the approval in the web browser before answering the card', async () => {
    const order = [];
    const approve = vi.fn(async () => { order.push('approve'); return { approved: true, pending_id: PENDING }; });
    const submit = vi.fn(async () => { order.push('submit'); return { status: 'ok' }; });
    const ok = await autoApprovePositionClick({
      conversationIds: ['c1'], questionId: `browser:approve:t-abc:${PENDING}`, isWeb: true, approve, submit,
    });
    expect(ok).toBe(true);
    expect(order).toEqual(['approve', 'submit']);
    expect(submit).toHaveBeenCalledWith('c1', `browser:approve:t-abc:${PENDING}`, { values: ['approve'] });
  });

  it('leaves the card for the person when the browser refuses', async () => {
    const approve = vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'approval_lapsed' }); });
    const submit = vi.fn();
    const ok = await autoApprovePositionClick({
      conversationIds: ['c1'], questionId: `browser:approve:t-abc:${PENDING}`, isWeb: true, approve, submit,
    });
    expect(ok).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it('answers a desktop card directly, under the first id the server knows', async () => {
    const approve = vi.fn();
    const submit = vi.fn(async (cid) => (cid === 'pending-1' ? { status: 'not_found' } : { status: 'ok' }));
    const ok = await autoApprovePositionClick({
      conversationIds: [null, 'pending-1', 'c1'], questionId: 'ask:q1', isWeb: false, approve, submit,
    });
    expect(ok).toBe(true);
    expect(approve).not.toHaveBeenCalled();
    expect(submit).toHaveBeenLastCalledWith('c1', 'ask:q1', { values: ['approve'] });
  });
});

describe('position clicks, refused answers', () => {
  it('does not answer a web card whose ids cannot be read', async () => {
    const submit = vi.fn();
    expect(await autoApprovePositionClick({ conversationIds: ['c1'], questionId: 'browser:approve:bad id', isWeb: true, approve: vi.fn(), submit })).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });
  it('reports a failed or refused answer, and no id the server knows', async () => {
    for (const status of ['error', 'rejected']) {
      expect(await autoApprovePositionClick({ conversationIds: ['c1'], questionId: 'ask:q', isWeb: false, submit: vi.fn(async () => ({ status })) })).toBe(false);
    }
    expect(await autoApprovePositionClick({ conversationIds: ['c1'], questionId: 'ask:q', isWeb: false, submit: vi.fn(async () => ({ status: 'not_found' })) })).toBe(false);
  });
});

describe('which cards the app approves for the person', () => {
  const hold = (options) => ({ question_id: 'browser:approve:t-abc:pa-1', options });
  const approve = [{ value: 'approve', label: 'Approve' }, { value: 'cancel', label: 'Cancel' }];
  it('approves held browser steps only once the person turned approvals off', () => {
    expect(isBrowserStepCard(hold(approve))).toBe(true);
    expect(isAutoApprovedCard(hold(approve), { askToApprove: false })).toBe(true);
    expect(isAutoApprovedCard(hold(approve), { askToApprove: true })).toBe(false);
  });
  it('asks by default: a held step shows with no settings read', () => {
    resetBrowserPrefsForTests();
    expect(isAutoApprovedCard(hold(approve))).toBe(false);
    expect(isAutoApprovedCard(hold(approve), {})).toBe(false);
  });
  it('always approves clicks by position, whatever the setting, and never another question', () => {
    const position = { question_id: 'q1', options: [{ value: 'approve', detail: POSITION_APPROVE_DETAIL }] };
    resetBrowserPrefsForTests();
    expect(isAutoApprovedCard(position)).toBe(true);
    expect(isAutoApprovedCard(position, { askToApprove: true })).toBe(true);
    expect(isAutoApprovedCard(position, { askToApprove: false })).toBe(true);
    const heldPosition = { question_id: 'browser:approve:t-abc:pa-1', options: [{ value: 'approve', detail: POSITION_APPROVE_DETAIL }] };
    expect(isAutoApprovedCard(heldPosition, { askToApprove: true })).toBe(true);
    expect(isAutoApprovedCard({ question_id: 'q2', options: approve }, { askToApprove: false })).toBe(false);
    expect(isAutoApprovedCard(hold([{ value: 'cancel' }]), { askToApprove: false })).toBe(false);
  });
  it("approves the desktop's step cards too, which carry no commit-hold id", () => {
    const desktop = { question_id: 'q-7', options: [{ value: 'approve', detail: STEP_APPROVE_DETAIL }, { value: 'cancel' }] };
    expect(isAutoApprovedCard(desktop, { askToApprove: false })).toBe(true);
    expect(isAutoApprovedCard(desktop, { askToApprove: true })).toBe(false);
  });
  /* On the desktop, whose browser holds nothing, the one-step card anton
     raises for a click by position that may land in a frame is the only
     gate on that click: anton sends into_frame only once it is approved,
     and the desktop refuses a press into a frame without it. So it must
     reach the person by default, though every position card is approved
     for them. */
  it("shows the one-step card for a click by position that may land in a frame by default, though it approves every position card", () => {
    const frameStep = {
      question_id: 'q-frame',
      options: [
        { value: 'approve', label: 'Approve', detail: STEP_APPROVE_DETAIL },
        { value: 'cancel', label: 'Cancel', detail: 'Leave the page as it is' },
      ],
    };
    const position = { question_id: 'q-position', options: [{ value: 'approve', label: 'Approve', detail: POSITION_APPROVE_DETAIL }] };
    resetBrowserPrefsForTests();
    expect(isAutoApprovedCard(position)).toBe(true);
    expect(isPositionClickCard(frameStep)).toBe(false);
    expect(isAutoApprovedCard(frameStep)).toBe(false);
    expect(isAutoApprovedCard(frameStep, { askToApprove: true })).toBe(false);
    expect(isPersonsBrowserTurn({ badge: 'AskUser', data: frameStep })).toBe(true);
  });
});

describe('approving for the person only with approvals off on the server', () => {
  const args = { conversationIds: ['c1'], questionId: 'ask:q', isWeb: false };
  it('reads the setting fresh and approves only when it says off', async () => {
    const submit = vi.fn(async () => ({}));
    expect(await approveIfApprovalsOff({ ...args, submit, readAsks: async () => false })).toBe('approved');
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('leaves the card to the person when approvals are on, or the setting cannot be read', async () => {
    const submit = vi.fn(async () => ({}));
    expect(await approveIfApprovalsOff({ ...args, submit, readAsks: async () => true })).toBe('asks');
    expect(await approveIfApprovalsOff({ ...args, submit, readAsks: async () => null })).toBe('unread');
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("the person's turn in the browser", () => {
  const ask = (data) => ({ badge: 'AskUser', data });
  const STEP = [{ value: 'approve', label: 'Approve', detail: 'Take this step once' }, { value: 'cancel', label: 'Cancel' }];
  it('is an unanswered held step, sign-in or other hand-over, not a click by position or an answered card', () => {
    resetBrowserPrefsForTests();
    expect(isPersonsBrowserTurn(ask({ question_id: 'browser:approve:t:p', options: STEP }))).toBe(true);
    expect(isPersonsBrowserTurn(ask({ question_id: 'browser:9f2c', options: [{ value: 'later' }, { value: 'stop' }] }))).toBe(true);
    expect(isPersonsBrowserTurn(ask({ question_id: 'q1', options: [{ value: 'approve', detail: POSITION_APPROVE_DETAIL }] }))).toBe(false);
    expect(isPersonsBrowserTurn(ask({ question_id: 'browser:9f2c', options: [], answer: { status: 'answered' } }))).toBe(false);
    expect(isPersonsBrowserTurn(ask({ question_id: 'ask:q', options: [{ value: 'yes' }] }))).toBe(false);
    expect(isPersonsBrowserTurn({ badge: 'Tool', data: { question_id: 'browser:x' } })).toBe(false);
  });
});
