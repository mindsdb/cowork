import { describe, expect, it, vi } from 'vitest';
import approveFixture from '../__fixtures__/browser-router/approve.json';
import {
  autoApprovePositionClick,
  isPositionClickCard,
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
  it('approves held browser steps unless the person approves steps', () => {
    expect(isBrowserStepCard(hold(approve))).toBe(true);
    expect(isAutoApprovedCard(hold(approve), { askToApprove: false })).toBe(true);
    expect(isAutoApprovedCard(hold(approve), { askToApprove: true })).toBe(false);
  });
  it('always approves clicks by position, and never another question', () => {
    const position = { question_id: 'q1', options: [{ value: 'approve', detail: POSITION_APPROVE_DETAIL }] };
    expect(isAutoApprovedCard(position, { askToApprove: true })).toBe(true);
    expect(isAutoApprovedCard({ question_id: 'q2', options: approve }, { askToApprove: false })).toBe(false);
    expect(isAutoApprovedCard(hold([{ value: 'cancel' }]), { askToApprove: false })).toBe(false);
  });
  it("approves the desktop's step cards too, which carry no commit-hold id", () => {
    const desktop = { question_id: 'q-7', options: [{ value: 'approve', detail: STEP_APPROVE_DETAIL }, { value: 'cancel' }] };
    expect(isAutoApprovedCard(desktop, { askToApprove: false })).toBe(true);
    expect(isAutoApprovedCard(desktop, { askToApprove: true })).toBe(false);
  });
});
