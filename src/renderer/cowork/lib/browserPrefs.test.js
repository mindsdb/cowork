import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  approvalsOffAtOf, getBrowserPrefs, heldAfterApprovalsOff, resetBrowserPrefsForTests, saveApproveSteps,
  setBrowserSettingSaver, syncBrowserPrefs,
} from './browserPrefs';
import { approveIfApprovalsOff, isAutoApprovedCard } from './browserApproval';

afterEach(() => resetBrowserPrefsForTests());

describe('when approvals went off', () => {
  it("reads the server's stamp from the settings, or null when they have none", () => {
    expect(approvalsOffAtOf({ browserApproveStepsOffAt: '1700000000123' })).toBe(1_700_000_000_123);
    expect(approvalsOffAtOf({ browserApproveStepsOffAt: 1_700_000_000_123 })).toBe(1_700_000_000_123);
    expect(approvalsOffAtOf({ browserApproveStepsOffAt: '0' })).toBe(0);
    for (const stored of [undefined, null, '', ' ', 'soon', true, Number.NaN]) {
      expect(approvalsOffAtOf({ browserApproveStepsOffAt: stored })).toBeNull();
    }
    expect(approvalsOffAtOf(null)).toBeNull();
    syncBrowserPrefs({ browserApproveSteps: false, browserApproveStepsOffAt: '42' });
    expect(getBrowserPrefs()).toMatchObject({ askToApprove: false, approvalsOffAtMs: 42 });
  });

  it("counts a step as the app's only when it was held after, both by the server's clock", () => {
    expect(heldAfterApprovalsOff(101, 100)).toBe(true);
    expect(heldAfterApprovalsOff(100, 100)).toBe(false);
    expect(heldAfterApprovalsOff(99, 100)).toBe(false);
    // A card with no time, or no time approvals went off, is never the app's.
    expect(heldAfterApprovalsOff(null, 100)).toBe(false);
    expect(heldAfterApprovalsOff('101', 100)).toBe(false);
    expect(heldAfterApprovalsOff(101, null)).toBe(false);
  });
});

describe('approvals off, on every device', () => {
  /* The server's settings, as saves write them and every device reads them:
     each write of approvals off stamps when, by the server's clock. */
  const server = () => {
    const clock = { now: 1_000 };
    const stored = { browserApproveSteps: true, browserApproveStepsOffAt: '0' };
    return {
      clock,
      stored,
      read: vi.fn(async () => ({ asks: stored.browserApproveSteps !== false, offAtMs: approvalsOffAtOf(stored) })),
      save: vi.fn(async (patch) => {
        Object.assign(stored, patch);
        if (patch.browserApproveSteps === false) stored.browserApproveStepsOffAt = String(clock.now);
      }),
    };
  };
  // A held step's card, as the stream gives it: held_at_ms is the server's stamp.
  const held = (name, heldAtMs) => ({
    question_id: `browser:approve:t-${name}:pa-${name}`,
    held_at_ms: heldAtMs,
    options: [{ value: 'approve', detail: 'Take this step once' }, { value: 'cancel' }],
  });
  const approveFor = async (read, card) => {
    const submit = vi.fn(async () => ({}));
    const outcome = await approveIfApprovalsOff({
      conversationIds: ['c1'], questionId: card.question_id, heldAtMs: card.held_at_ms, isWeb: false, submit, readAsks: read,
    });
    return { outcome, submit };
  };
  // A reload, or another device: no memory of this tab, only the server's settings.
  const reload = (stored) => {
    resetBrowserPrefsForTests();
    syncBrowserPrefs(stored);
  };

  /* The laptop shows a held "Place order" card X in task A. On the phone, in
     task B, the person skips approvals on card Y. The laptop reloads and X
     replays: the person saw it ask and never answered, so it still asks. A
     step held after the Skip is approved for them. */
  it('leaves every card that was waiting when approvals went off to the person, after a reload', async () => {
    const { clock, stored, read, save } = server();
    const x = held('x', 900);
    const y = held('y', 950);
    setBrowserSettingSaver(save);
    expect(await saveApproveSteps(false)).toBe(true);
    expect(save).toHaveBeenCalledWith({ browserApproveSteps: false });
    reload(stored);
    for (const card of [x, y]) {
      expect(isAutoApprovedCard(card)).toBe(false);
      const { outcome, submit } = await approveFor(read, card);
      expect(outcome).toBe('kept');
      expect(submit).not.toHaveBeenCalled();
    }
    clock.now = 1_200;
    const later = held('z', 1_001);
    expect(isAutoApprovedCard(later)).toBe(true);
    const { outcome, submit } = await approveFor(read, later);
    expect(outcome).toBe('approved');
    expect(submit).toHaveBeenCalledWith('c1', later.question_id, { values: ['approve'] });
  });

  /* X waits while approvals go off in Settings (which saves only the
     switch, as the card does), then back on, then off again from another
     card on another device: X was waiting each time, so it still asks. A
     card held while approvals were on asked, and still does. */
  it('keeps a waiting card through approvals going off in Settings, back on, and off again elsewhere', async () => {
    const { clock, stored, read, save } = server();
    setBrowserSettingSaver(save);
    const x = held('x', 900);
    await save({ browserApproveSteps: false });
    clock.now = 2_000;
    await save({ browserApproveSteps: true });
    const asked = held('asked', 2_100);
    clock.now = 3_000;
    expect(await saveApproveSteps(false)).toBe(true);
    reload(stored);
    for (const card of [x, asked]) {
      expect(isAutoApprovedCard(card)).toBe(false);
      expect((await approveFor(read, card)).outcome).toBe('kept');
    }
    expect((await approveFor(read, held('later', 3_001))).outcome).toBe('approved');
  });

  /* This tab still reads approvals off from long ago, so it hides a card
     held since. Another device turned them off again after the card was
     held: the fresh read keeps it, and nothing is approved. */
  it('keeps a card the fresh read says was waiting, whatever this tab last read', async () => {
    const { clock, stored, read, save } = server();
    setBrowserSettingSaver(save);
    await save({ browserApproveSteps: false });
    syncBrowserPrefs({ ...stored });
    const card = held('x', 1_500);
    expect(isAutoApprovedCard(card)).toBe(true);
    clock.now = 2_000;
    await save({ browserApproveSteps: false });
    const { outcome, submit } = await approveFor(read, card);
    expect(outcome).toBe('kept');
    expect(submit).not.toHaveBeenCalled();
  });

  it('approves nothing when the server says approvals are off but not since when', async () => {
    const read = vi.fn(async () => ({ asks: false, offAtMs: null }));
    syncBrowserPrefs({ browserApproveSteps: false });
    const card = held('x', 1_500);
    expect(isAutoApprovedCard(card)).toBe(false);
    const { outcome, submit } = await approveFor(read, card);
    expect(outcome).toBe('kept');
    expect(submit).not.toHaveBeenCalled();
  });

  it('saves nothing with no saver, and says when the save failed', async () => {
    expect(await saveApproveSteps(false)).toBe(false);
    setBrowserSettingSaver(vi.fn(async () => { throw new Error('offline'); }));
    expect(await saveApproveSteps(false)).toBe(false);
  });
});
