import { describe, it, expect } from 'vitest';

import {
  addonEligibility,
  addonOutcome,
  addonRowLabel,
  applyAddonEvent,
  foldAddonMessages,
  isAddonMessage,
  newlyReturnedAddons,
  queuedReasonKey,
} from './addons';

const live = { conversationId: 'conv-1', text: 'use the sales DB', attachments: [], liveStream: true };

describe('addonEligibility', () => {
  it('offers a plain text message to a live turn', () => {
    expect(addonEligibility(live)).toEqual({ ok: true });
  });

  it.each([
    ['empty', { text: '   ' }],
    ['attachments', { attachments: [{ id: 'f1' }] }],
    ['no_conversation', { conversationId: 'tmp-connect-1' }],
    ['no_conversation', { conversationId: null }],
    ['no_live_stream', { liveStream: false }],
    ['turn_ending', { ending: true }],
  ])('queues with reason %s', (reason, patch) => {
    expect(addonEligibility({ ...live, ...patch })).toEqual({ ok: false, reason });
  });
});

describe('addonOutcome', () => {
  it('adds only on an explicit added with an id', () => {
    expect(addonOutcome({ status: 'added', addon_id: 'ad1', decided_by: 'jev' }))
      .toEqual({ action: 'added', addonId: 'ad1', decidedBy: 'jev' });
    expect(addonOutcome({ status: 'added', addon_id: 'ad2', decided_by: 'user' }).decidedBy).toBe('user');
    expect(addonOutcome({ status: 'added' }).action).toBe('queue');
  });

  it.each([
    [{ status: 'queued', reason: 'new_request' }, 'new_request'],
    [{ status: 'queued' }, 'jev'],
    [{ status: 'not_found' }, 'not_found'],
    [{ status: 'unsupported' }, 'unsupported'],
    [{ status: 'timeout' }, 'timeout'],
    [{ status: 'error' }, 'error'],
    [{ status: 'something_new' }, 'unknown'],
    [null, 'unknown'],
  ])('queues %j with reason %s', (result, reason) => {
    expect(addonOutcome(result)).toEqual({ action: 'queue', reason });
  });
});

describe('addonRowLabel', () => {
  it('offers Move to queue only while added and unread', () => {
    expect(addonRowLabel('added')).toEqual({ key: 'added', canMove: true });
    expect(addonRowLabel('read')).toEqual({ key: 'read', canMove: false });
    expect(addonRowLabel('returned').key).toBe('returned');
    expect(addonRowLabel('saved')).toEqual({ key: 'added', canMove: false });
    expect(addonRowLabel('sending').canMove).toBe(false);
    expect(addonRowLabel('withdrawing').canMove).toBe(false);
  });
});

const tool = { id: 'step-1', badge: 'Tool', status: 'completed' };
const addonState = (steps) => steps.filter((s) => s.badge === 'Addon').map((s) => [s.data.addon_id, s.data.state]);

describe('applyAddonEvent', () => {
  it('shows a pending row, then adopts the server id on added', () => {
    let steps = applyAddonEvent([tool], { state: 'sending', local_key: 'k1', text: 'hi' }, 10);
    expect(steps[1]).toMatchObject({ badge: 'Addon', id: 'addon-k1', data: { state: 'sending', text: 'hi' } });
    steps = applyAddonEvent(steps, { state: 'added', local_key: 'k1', addon_id: 'ad1', decided_by: 'jev' });
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ id: 'addon-k1', data: { addon_id: 'ad1', state: 'added', decided_by: 'jev' } });
  });

  it('removes a pending row the server queued instead', () => {
    const steps = applyAddonEvent([tool], { state: 'sending', local_key: 'k1', text: 'hi' });
    expect(applyAddonEvent(steps, { state: 'discarded', local_key: 'k1' })).toEqual([tool]);
  });

  it('does not show the message twice when the stream event beats the request', () => {
    let steps = applyAddonEvent([], { state: 'sending', local_key: 'k1', text: 'hi' });
    // The server's own event: no local key, same words.
    steps = applyAddonEvent(steps, { state: 'added', addon_id: 'ad1', text: 'hi', decided_by: 'jev' });
    expect(addonState(steps)).toEqual([['ad1', 'added']]);
    // Then the request answers.
    steps = applyAddonEvent(steps, { state: 'added', local_key: 'k1', addon_id: 'ad1', text: 'hi' });
    expect(addonState(steps)).toEqual([['ad1', 'added']]);
  });

  it('drops a lingering pending row once the id is already shown', () => {
    let steps = applyAddonEvent([], { state: 'added', addon_id: 'ad1', text: 'hi' });
    steps = applyAddonEvent(steps, { state: 'sending', local_key: 'k1', text: 'other words' });
    steps = applyAddonEvent(steps, { state: 'added', local_key: 'k1', addon_id: 'ad1', text: 'hi' });
    expect(addonState(steps)).toEqual([['ad1', 'added']]);
  });

  it('is idempotent over a replayed added event', () => {
    const steps = applyAddonEvent([], { state: 'added', addon_id: 'ad1', text: 'hi' });
    expect(applyAddonEvent(steps, { state: 'added', addon_id: 'ad1', text: 'hi' })).toBe(steps);
  });

  it('never moves a read message back to added', () => {
    let steps = applyAddonEvent([], { state: 'added', addon_id: 'ad1', text: 'hi' });
    steps = applyAddonEvent(steps, { state: 'read', addon_id: 'ad1' });
    expect(applyAddonEvent(steps, { state: 'added', addon_id: 'ad1', text: 'hi' })).toBe(steps);
    expect(addonState(steps)).toEqual([['ad1', 'read']]);
  });

  it('runs the Move to queue round trip', () => {
    let steps = applyAddonEvent([tool], { state: 'added', addon_id: 'ad1', text: 'hi' });
    steps = applyAddonEvent(steps, { state: 'withdrawing', addon_id: 'ad1' });
    expect(addonState(steps)).toEqual([['ad1', 'withdrawing']]);
    // A failed withdraw puts the button back.
    const reverted = applyAddonEvent(steps, { state: 'added', addon_id: 'ad1', revert: true });
    expect(addonState(reverted)).toEqual([['ad1', 'added']]);
    // A successful one removes the row.
    expect(applyAddonEvent(steps, { state: 'withdrawn', addon_id: 'ad1' })).toEqual([tool]);
  });

  it('only withdraws a message that is still unread', () => {
    let steps = applyAddonEvent([], { state: 'added', addon_id: 'ad1', text: 'hi' });
    steps = applyAddonEvent(steps, { state: 'read', addon_id: 'ad1' });
    expect(applyAddonEvent(steps, { state: 'withdrawing', addon_id: 'ad1' })).toBe(steps);
  });

  it('marks a returned message and keeps it final', () => {
    let steps = applyAddonEvent([], { state: 'added', addon_id: 'ad1', text: 'hi' });
    steps = applyAddonEvent(steps, { state: 'returned', addon_id: 'ad1', text: 'hi' });
    expect(addonState(steps)).toEqual([['ad1', 'returned']]);
    expect(applyAddonEvent(steps, { state: 'read', addon_id: 'ad1' })).toBe(steps);
  });

  it('shows read or returned events for a message it never saw added', () => {
    expect(addonState(applyAddonEvent([], { state: 'read', addon_id: 'ad1', text: 'hi' }))).toEqual([['ad1', 'read']]);
    expect(addonState(applyAddonEvent([], { state: 'returned', addon_id: 'ad1', text: 'hi' }))).toEqual([['ad1', 'returned']]);
    // Without words there is nothing to show.
    expect(applyAddonEvent([], { state: 'read', addon_id: 'ad1' })).toEqual([]);
  });

  it('ignores states it does not know', () => {
    const steps = [tool];
    expect(applyAddonEvent(steps, { state: 'moved', addon_id: 'ad1', text: 'hi' })).toBe(steps);
  });
});

describe('newlyReturnedAddons', () => {
  it('lists returned messages not yet handled', () => {
    let steps = applyAddonEvent([], { state: 'returned', addon_id: 'ad1', text: 'one' });
    steps = applyAddonEvent(steps, { state: 'added', addon_id: 'ad2', text: 'two' });
    steps = applyAddonEvent(steps, { state: 'returned', addon_id: 'ad3', text: 'three' });
    expect(newlyReturnedAddons(steps, new Set(['ad3']))).toEqual([{ addonId: 'ad1', text: 'one' }]);
    expect(newlyReturnedAddons(null, new Set())).toEqual([]);
  });
});

describe('foldAddonMessages', () => {
  const user = { id: 'u1', role: 'user', content: 'build the report' };
  const addon = {
    id: 'u2', role: 'user', content: 'use the sales DB', created_at: '2026-11-11T10:00:05Z',
    metadata: { addon_of_turn: 'resp_1', decided_by: 'jev' },
  };
  const step = (id, at) => ({ id, badge: 'Tool', startedAt: Date.parse(at) });
  const assistant = {
    id: 'a1', role: 'assistant', content: 'done', _responseId: 'resp_1',
    steps: [step('s1', '2026-11-11T10:00:01Z'), step('s2', '2026-11-11T10:00:09Z')],
  };

  it('recognises saved add-ons', () => {
    expect(isAddonMessage(addon)).toBe(true);
    expect(isAddonMessage(user)).toBe(false);
    expect(isAddonMessage({ ...addon, role: 'assistant' })).toBe(false);
  });

  it('returns the same list when there is nothing to fold', () => {
    const msgs = [user, assistant];
    expect(foldAddonMessages(msgs)).toBe(msgs);
  });

  it('folds an add-on into its turn, placed by time', () => {
    const out = foldAddonMessages([user, addon, assistant]);
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(out[1].steps.map((s) => s.id)).toEqual(['s1', 'addon-u2', 's2']);
    expect(out[1].steps[1].data).toMatchObject({ text: 'use the sales DB', state: 'saved', decided_by: 'jev' });
  });

  it('finds its turn by response id even when saved after the answer', () => {
    const next = { id: 'u3', role: 'user', content: 'thanks' };
    const out = foldAddonMessages([user, assistant, next, addon]);
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 'u3']);
    expect(out[1].steps.some((s) => s.id === 'addon-u2')).toBe(true);
  });

  it('drops the saved copy when the turn already shows it from its events', () => {
    const shown = applyAddonEvent(assistant.steps, { state: 'read', addon_id: 'ad1', text: 'use the sales DB' });
    const out = foldAddonMessages([user, addon, { ...assistant, steps: shown }]);
    expect(out[1].steps.filter((s) => s.badge === 'Addon')).toHaveLength(1);
  });

  it('keeps an add-on with no turn on the page as a labelled user row', () => {
    const out = foldAddonMessages([user, addon]);
    expect(out[1]).toMatchObject({ id: 'u2', role: 'user', _addon: { decidedBy: 'jev' } });
  });
});


describe('queuedReasonKey', () => {
  it('says why a message waits, without naming the decision model', () => {
    expect(queuedReasonKey('next_task')).toBe('separate');
    expect(queuedReasonKey('low_confidence')).toBe('unsure');
    // The check could not run: how a missing decision shows up.
    for (const r of ['jev_off', 'jev_error', 'jev_timeout']) expect(queuedReasonKey(r)).toBe('unchecked');
    expect(queuedReasonKey('attachments')).toBe('files');
    expect(queuedReasonKey('returned')).toBe('notRead');
    for (const r of ['pod_timeout', 'no_turn', 'not_supported', 'not_found', 'timeout', 'unknown']) {
      expect(queuedReasonKey(r)).toBe('unavailable');
    }
  });

  it('has nothing to say for a message the person queued themselves', () => {
    expect(queuedReasonKey(null)).toBeNull();
    expect(queuedReasonKey('moved')).toBeNull();
    expect(queuedReasonKey('empty')).toBeNull();
  });
});
