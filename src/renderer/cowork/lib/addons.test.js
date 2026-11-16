import { afterEach, describe, it, expect } from 'vitest';

import {
  addonEligibility,
  addonOutcome,
  addonRowLabel,
  applyAddonEvent,
  foldAddonMessages,
  isAddonMessage,
  newAddonLocalKey,
  isValidLocalKey,
  newlyReturnedAddons,
  normalizeDecidedBy,
  queuedReasonKey,
  rememberOwnAddon,
  isOwnAddon,
  forgetOwnAddons,
  __resetOwnAddonsForTests,
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
    expect(addonOutcome(result)).toMatchObject({ action: 'queue', reason });
  });

  it('marks the answers that do not say whether it was added', () => {
    for (const status of ['timeout', 'error', 'something_new']) expect(addonOutcome({ status }).unclear).toBe(true);
    for (const status of ['queued', 'not_found', 'unsupported']) expect(addonOutcome({ status }).unclear).toBe(false);
  });

  it('normalises decided_by', () => {
    expect(addonOutcome({ status: 'added', addon_id: 'a', decided_by: 'robot' }).decidedBy).toBe('jev');
    expect(normalizeDecidedBy('user')).toBe('user');
    expect(normalizeDecidedBy('JEV')).toBe('jev');
    expect(normalizeDecidedBy(undefined)).toBeNull();
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
    // Taken back out: the same words as returned, no move.
    expect(addonRowLabel('withdrawn')).toEqual({ key: 'returned', canMove: false });
  });
});

const tool = { id: 'step-1', badge: 'Tool', status: 'completed' };
// Every key is this client's own unless a test says otherwise.
const OWN = { isOwn: (k) => Boolean(k) };
const apply = (steps, ev, ts) => applyAddonEvent(steps, ev, ts, OWN);
const addonState = (steps) => steps.filter((s) => s.badge === 'Addon').map((s) => [s.data.addon_id, s.data.state]);

describe('applyAddonEvent', () => {
  it('shows a pending row, then adopts the server id on added', () => {
    let steps = apply([tool], { state: 'sending', local_key: 'k1', text: 'hi' }, 10);
    expect(steps[1]).toMatchObject({ badge: 'Addon', id: 'addon-k1', data: { state: 'sending', text: 'hi' } });
    steps = apply(steps, { state: 'added', local_key: 'k1', addon_id: 'ad1', decided_by: 'jev' });
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ id: 'addon-k1', data: { addon_id: 'ad1', state: 'added', decided_by: 'jev' } });
  });

  it('removes a pending row the server queued instead', () => {
    const steps = apply([tool], { state: 'sending', local_key: 'k1', text: 'hi' });
    expect(apply(steps, { state: 'discarded', local_key: 'k1' })).toEqual([tool]);
  });

  it('does not show the message twice when the stream event beats the request', () => {
    let steps = apply([], { state: 'sending', local_key: 'k1', text: 'hi' });
    // The server's own event names the app's local key.
    steps = apply(steps, { state: 'added', addon_id: 'ad1', local_key: 'k1', text: 'hi', decided_by: 'jev' });
    expect(addonState(steps)).toEqual([['ad1', 'added']]);
    // Then the request answers.
    steps = apply(steps, { state: 'added', local_key: 'k1', addon_id: 'ad1', text: 'hi' });
    expect(addonState(steps)).toEqual([['ad1', 'added']]);
  });

  it('matches rows by id, never by their words', () => {
    // Two sends of the same words are two rows.
    let steps = apply([], { state: 'sending', local_key: 'k1', text: 'yes' });
    steps = apply(steps, { state: 'sending', local_key: 'k2', text: 'yes' });
    steps = apply(steps, { state: 'added', local_key: 'k2', addon_id: 'ad2', text: 'yes' });
    expect(steps.map((s) => [s.data.local_key, s.data.addon_id, s.data.state]))
      .toEqual([['k1', null, 'sending'], ['k2', 'ad2', 'added']]);
  });

  it('drops a lingering pending row once the id is already shown', () => {
    let steps = apply([], { state: 'added', addon_id: 'ad1', text: 'hi' });
    steps = apply(steps, { state: 'sending', local_key: 'k1', text: 'other words' });
    steps = apply(steps, { state: 'added', local_key: 'k1', addon_id: 'ad1', text: 'hi' });
    expect(addonState(steps)).toEqual([['ad1', 'added']]);
  });

  it('is idempotent over a replayed added event', () => {
    const steps = apply([], { state: 'added', addon_id: 'ad1', text: 'hi' });
    expect(apply(steps, { state: 'added', addon_id: 'ad1', text: 'hi' })).toBe(steps);
  });

  it('never moves a read message back to added', () => {
    let steps = apply([], { state: 'added', addon_id: 'ad1', text: 'hi' });
    steps = apply(steps, { state: 'read', addon_id: 'ad1' });
    expect(apply(steps, { state: 'added', addon_id: 'ad1', text: 'hi' })).toBe(steps);
    expect(addonState(steps)).toEqual([['ad1', 'read']]);
  });

  it('runs the Move to queue round trip', () => {
    let steps = apply([tool], { state: 'added', addon_id: 'ad1', text: 'hi' });
    steps = apply(steps, { state: 'withdrawing', addon_id: 'ad1' });
    expect(addonState(steps)).toEqual([['ad1', 'withdrawing']]);
    // A failed withdraw puts the button back.
    const reverted = apply(steps, { state: 'added', addon_id: 'ad1', revert: true });
    expect(addonState(reverted)).toEqual([['ad1', 'added']]);
    // A successful one keeps the row, as moved to the queue, and final.
    const withdrawn = apply(steps, { state: 'withdrawn', addon_id: 'ad1' });
    expect(addonState(withdrawn)).toEqual([['ad1', 'withdrawn']]);
    expect(apply(withdrawn, { state: 'read', addon_id: 'ad1' })).toBe(withdrawn);
    expect(apply(withdrawn, { state: 'added', addon_id: 'ad1', revert: true })).toBe(withdrawn);
  });

  it('takes the server\'s withdrawn for a message it shows as added', () => {
    const steps = apply([], { state: 'added', addon_id: 'ad1', text: 'hi' });
    expect(addonState(apply(steps, { state: 'withdrawn', addon_id: 'ad1' }))).toEqual([['ad1', 'withdrawn']]);
  });

  it('only withdraws a message that is still unread', () => {
    let steps = apply([], { state: 'added', addon_id: 'ad1', text: 'hi' });
    steps = apply(steps, { state: 'read', addon_id: 'ad1' });
    expect(apply(steps, { state: 'withdrawing', addon_id: 'ad1' })).toBe(steps);
  });

  it('marks a returned message and keeps it final', () => {
    let steps = apply([], { state: 'added', addon_id: 'ad1', text: 'hi' });
    steps = apply(steps, { state: 'returned', addon_id: 'ad1', text: 'hi' });
    expect(addonState(steps)).toEqual([['ad1', 'returned']]);
    expect(apply(steps, { state: 'read', addon_id: 'ad1' })).toBe(steps);
  });

  it('shows read or returned events for a message it never saw added', () => {
    expect(addonState(apply([], { state: 'read', addon_id: 'ad1', text: 'hi' }))).toEqual([['ad1', 'read']]);
    expect(addonState(apply([], { state: 'returned', addon_id: 'ad1', text: 'hi' }))).toEqual([['ad1', 'returned']]);
    // Without words there is nothing to show.
    expect(apply([], { state: 'read', addon_id: 'ad1' })).toEqual([]);
  });

  it('ignores states it does not know, and ready', () => {
    const steps = [tool];
    expect(apply(steps, { state: 'moved', addon_id: 'ad1', text: 'hi' })).toBe(steps);
    expect(apply(steps, { state: 'ready', addon_id: 'ad1', text: 'hi' })).toBe(steps);
    const added = apply(steps, { state: 'added', addon_id: 'ad1', text: 'hi' });
    expect(apply(added, { state: 'ready', addon_id: 'ad1' })).toBe(added);
  });

  it('normalises decided_by on the row', () => {
    const steps = apply([], { state: 'added', addon_id: 'ad1', text: 'hi', decided_by: 'robot' });
    expect(steps[0].data.decided_by).toBe('jev');
  });
});

describe('applyAddonEvent — whose add-on it is', () => {
  const nobody = { isOwn: () => false };
  const mine = (...keys) => ({ isOwn: (k) => keys.includes(k) });

  it('shows the server\'s rows for an add-on another client sent, in every state (ENG-4208)', () => {
    for (const state of ['added', 'read', 'returned', 'withdrawn']) {
      const steps = applyAddonEvent([tool], { state, addon_id: 'theirs', text: 'hi' }, 1, nobody);
      expect(addonState(steps)).toEqual([['theirs', state]]);
      // Shown, never marked as this client's: no Move to queue, never queued.
      expect(steps[1].data.own).toBeFalsy();
    }
    // A row needs the server's text: an event without it shows nothing.
    expect(applyAddonEvent([tool], { state: 'read', addon_id: 'theirs' }, 1, nobody)).toEqual([tool]);
    // Only the app's own request shows a pending row.
    expect(applyAddonEvent([], { state: 'sending', local_key: 'k9', text: 'hi' }, 1, nobody)).toEqual([]);
  });

  it('marks a row as this client\'s once an event names one of its keys', () => {
    const theirs = applyAddonEvent([], { state: 'added', addon_id: 'ad1', text: 'hi' }, 1, nobody);
    expect(theirs[0].data.own).toBeFalsy();
    const mineNow = applyAddonEvent(theirs, { state: 'added', addon_id: 'ad1', local_key: 'k1' }, 2, mine('k1'));
    expect(mineNow[0].data).toMatchObject({ own: true, local_key: 'k1' });
    // Idempotent once marked.
    expect(applyAddonEvent(mineNow, { state: 'added', addon_id: 'ad1' }, 3, mine('ad1'))).toBe(mineNow);
  });

  it('creates rows for its own key or id', () => {
    expect(addonState(applyAddonEvent([], { state: 'added', addon_id: 'ad1', text: 'hi' }, 1, mine('ad1'))))
      .toEqual([['ad1', 'added']]);
    expect(addonState(applyAddonEvent([], { state: 'read', addon_id: 'ad1', local_key: 'k1', text: 'hi' }, 1, mine('k1'))))
      .toEqual([['ad1', 'read']]);
  });

  it('lets an unknown id update a row it already shows', () => {
    const saved = applyAddonEvent([], { state: 'added', addon_id: 'ad1', text: 'hi' }, 1, { replay: true, isOwn: () => false });
    const read = applyAddonEvent(saved, { state: 'read', addon_id: 'ad1' }, 2, nobody);
    expect(addonState(read)).toEqual([['ad1', 'read']]);
  });

  it('shows saved history replayed from the server', () => {
    const steps = applyAddonEvent([], { state: 'returned', addon_id: 'old', text: 'hi' }, 1, { replay: true, isOwn: () => false });
    expect(addonState(steps)).toEqual([['old', 'returned']]);
  });
});

describe('this client\'s own add-ons, per conversation (ENG-4208)', () => {
  afterEach(() => { __resetOwnAddonsForTests(); });

  it('remembers keys under their conversation and forgets them with it', () => {
    rememberOwnAddon('k1', 'conv-a');
    rememberOwnAddon('ad1', 'conv-a');
    rememberOwnAddon('k2', 'conv-b');
    expect(isOwnAddon('k1')).toBe(true);
    expect(isOwnAddon('k2')).toBe(true);
    forgetOwnAddons('conv-a');
    expect(isOwnAddon('k1')).toBe(false);
    expect(isOwnAddon('ad1')).toBe(false);
    expect(isOwnAddon('k2')).toBe(true);
    expect(isOwnAddon(null)).toBe(false);
  });
});

describe('local keys', () => {
  it('makes keys the server accepts', () => {
    const a = newAddonLocalKey();
    const b = newAddonLocalKey();
    expect(a).not.toBe(b);
    expect(isValidLocalKey(a)).toBe(true);
    expect(isValidLocalKey('has space')).toBe(false);
    expect(isValidLocalKey('x'.repeat(65))).toBe(false);
    expect(isValidLocalKey(null)).toBe(false);
  });
});

describe('newlyReturnedAddons', () => {
  it('lists returned messages not yet handled', () => {
    let steps = apply([], { state: 'returned', addon_id: 'ad1', text: 'one' });
    steps = apply(steps, { state: 'added', addon_id: 'ad2', text: 'two' });
    steps = apply(steps, { state: 'returned', addon_id: 'ad3', text: 'three' });
    expect(newlyReturnedAddons(steps, new Set(['ad3']), OWN))
      .toEqual([{ addonId: 'ad1', keys: ['ad1'], text: 'one', reason: 'returned' }]);
    expect(newlyReturnedAddons(null, new Set())).toEqual([]);
  });

  it('never queues another client\'s add-on, or one shown from saved history', () => {
    const steps = applyAddonEvent([], { state: 'returned', addon_id: 'theirs', text: 'hi' }, 1, { replay: true, isOwn: () => false });
    expect(newlyReturnedAddons(steps, new Set(), { isOwn: () => false })).toEqual([]);
  });

  it('queues a withdrawn message only when this client asked for the withdraw', () => {
    let steps = apply([], { state: 'added', addon_id: 'ad1', text: 'one' });
    steps = apply(steps, { state: 'withdrawn', addon_id: 'ad1' });
    expect(newlyReturnedAddons(steps, new Set(), OWN)).toEqual([]);
    expect(newlyReturnedAddons(steps, new Set(), { ...OWN, withdrawRequested: new Set(['ad1']) }))
      .toEqual([{ addonId: 'ad1', keys: ['ad1'], text: 'one', reason: 'moved' }]);
    // Already queued: never twice.
    expect(newlyReturnedAddons(steps, new Set(['ad1']), { ...OWN, withdrawRequested: new Set(['ad1']) })).toEqual([]);
  });

  it('counts a message handled under either of its keys', () => {
    let steps = apply([], { state: 'sending', local_key: 'k1', text: 'one' });
    steps = apply(steps, { state: 'returned', local_key: 'k1', addon_id: 'ad1' });
    expect(newlyReturnedAddons(steps, new Set(['k1']), OWN)).toEqual([]);
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

  it('drops the saved copy when the turn already shows it from its events, by id', () => {
    const shown = applyAddonEvent(assistant.steps, { state: 'read', addon_id: 'ad1', text: 'use the sales DB' }, 1, { replay: true });
    const withId = { ...addon, metadata: { ...addon.metadata, addon_id: 'ad1' } };
    const out = foldAddonMessages([user, withId, { ...assistant, steps: shown }]);
    expect(out[1].steps.filter((s) => s.badge === 'Addon')).toHaveLength(1);
  });

  it('keeps two add-ons with the same words, and drops a repeat of the same message', () => {
    const again = { ...addon, id: 'u3', created_at: '2026-11-11T10:00:06Z' };
    const out = foldAddonMessages([user, addon, again, addon, assistant]);
    expect(out[1].steps.filter((s) => s.badge === 'Addon').map((s) => s.id)).toEqual(['addon-u2', 'addon-u3']);
  });

  it('normalises decided_by on saved add-ons', () => {
    const out = foldAddonMessages([user, { ...addon, metadata: { ...addon.metadata, decided_by: 'robot' } }]);
    expect(out[1]._addon).toEqual({ decidedBy: 'jev' });
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
    for (const r of ['pod_timeout', 'no_turn', 'not_supported', 'not_found', 'timeout', 'unknown',
      'too_many', 'too_large', 'rate_limited', 'busy', 'internal', 'redis_error', 'constructor', 'toString']) {
      expect(queuedReasonKey(r)).toBe('unavailable');
    }
  });

  it('has nothing to say for a message the person queued themselves', () => {
    expect(queuedReasonKey(null)).toBeNull();
    expect(queuedReasonKey('moved')).toBeNull();
    expect(queuedReasonKey('empty')).toBeNull();
  });
});
