import { describe, expect, it, vi } from 'vitest';
import approveFixture from '../__fixtures__/browser-router/approve.json';
import { approvalRefusalText, browserApprovalIds, recordBrowserApproval } from './browserApproval';

const APPROVED = approveFixture.examples.approved.body;
const PENDING = APPROVED.pending_id;

describe('browserApprovalIds', () => {
  it('reads both ids from a commit-hold card', () => {
    expect(browserApprovalIds(`browser:approve:t-abc:${PENDING}`)).toEqual({ sessionId: 't-abc', pendingId: PENDING });
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
    await expect(recordBrowserApproval(ids, refuse(409, 'unavailable'))).resolves.toEqual({ ok: false, message: "The browser isn't available here, so nothing ran." });
    await expect(recordBrowserApproval(ids, refuse(424, 'browser_unreachable', 'The browser isn\'t reachable.'))).resolves.toEqual({ ok: false, message: "Couldn't approve this step in the browser: The browser isn't reachable." });
    expect(approvalRefusalText(Object.assign(new Error('API /browse/approve returned 500'), { status: 500 }))).toBe("Couldn't approve this step in the browser. Try again.");
  });
});
