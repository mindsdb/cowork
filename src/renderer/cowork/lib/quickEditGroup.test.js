// The quick-edit group message in a chat (ENG-4227), and older one-edit notes.
import { describe, expect, it } from 'vitest';
import {
  isFoldedLegacyRequest, legacyQuickEditGroup, legacyQuickEditNote, planQuickEditCards, quickEditGroupOf, withQuickEditGroup,
} from './quickEditGroup';
import { hydrateMessagesFromServerEvents } from './conversationHistory';

const groupMessage = (edits, extra = {}) => ({
  id: 'm1',
  role: 'assistant',
  harness: 'cowork-quick-edit',
  // Model-facing text: never shown.
  content: 'Changes made directly in the viewer of artifact `launch-brief`: ...',
  events: [{
    type: 'response.quick_edit_group',
    kind: 'quick_edit_group',
    artifactId: 'a1',
    artifactSlug: 'launch-brief',
    artifactTitle: 'Launch brief',
    edits,
  }],
  ...extra,
});

const NOTE = 'I edited this artifact directly from its viewer (quick edit): Made the title blue.\nFiles changed: index.html, app.js.\nSaved as draft revision 2; not published.';

describe('quickEditGroupOf', () => {
  it('reads the group and normalizes its edits', () => {
    const group = quickEditGroupOf(groupMessage([
      { editId: 'e1', request: 'blue title', summary: 'Made the title blue.', changed: ['index.html'], revisionId: 'r2', at: '2026-11-12T10:00:00Z', model: 'm', undone: false },
      { editId: 'e2', request: 'bigger', summary: 'Bigger.', undone: true },
    ]));
    expect(group).toMatchObject({ artifactSlug: 'launch-brief', artifactTitle: 'Launch brief' });
    expect(group.edits).toHaveLength(2);
    expect(group.edits[1]).toEqual({
      editId: 'e2', request: 'bigger', summary: 'Bigger.', changed: [], revisionId: null, at: null, model: null, undone: true,
    });
  });

  it('is null for any other message', () => {
    expect(quickEditGroupOf({ role: 'assistant', content: 'hi' })).toBeNull();
    expect(quickEditGroupOf({ role: 'user', events: groupMessage([{ editId: 'e' }]).events })).toBeNull();
    expect(quickEditGroupOf(groupMessage([]))).toBeNull();
    expect(quickEditGroupOf({ role: 'assistant', events: [{ type: 'response.output_text.delta', delta: 'x' }] })).toBeNull();
    expect(quickEditGroupOf({ role: 'assistant', events: [{ type: 'response.quick_edit_group', kind: 'other', edits: [{}] }] })).toBeNull();
  });

  it('hydrates the group as a card, not a turn: no events, steps or answer text derived', () => {
    const raw = groupMessage([{ editId: 'e1', request: 'blue', summary: 'Blue.' }]);
    const [hydrated] = hydrateMessagesFromServerEvents([raw]);
    expect(hydrated.events).toBeUndefined();
    expect(hydrated.steps).toBeUndefined();
    expect(hydrated.quickEditGroup.type).toBe('response.quick_edit_group');
    expect(quickEditGroupOf(hydrated).edits[0].summary).toBe('Blue.');
    expect(withQuickEditGroup({ role: 'assistant', events: [{ type: 'response.completed' }] })).toBeNull();
  });
});

describe('older one-edit notes', () => {
  it('parses the note and takes the request from the message before it', () => {
    expect(legacyQuickEditNote({ role: 'assistant', content: NOTE }))
      .toEqual({ summary: 'Made the title blue.', changed: ['index.html', 'app.js'], revisionNumber: 2 });
    const group = legacyQuickEditGroup({ id: 'n1', role: 'assistant', content: NOTE }, { role: 'user', content: 'blue title' });
    expect(group.legacy).toBe(true);
    expect(group.artifactSlug).toBeNull();
    expect(group.edits[0]).toMatchObject({ request: 'blue title', summary: 'Made the title blue.' });
  });

  it('folds only the user message right before a note', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hi there.' },
      { role: 'user', content: 'blue title' },
      { role: 'assistant', content: NOTE },
    ];
    expect(isFoldedLegacyRequest(messages, 0)).toBe(false);
    expect(isFoldedLegacyRequest(messages, 2)).toBe(true);
  });

  it('leaves ordinary answers alone, even ones quoting the phrase', () => {
    expect(legacyQuickEditNote({ role: 'assistant', content: `As I said: ${NOTE}` })).toBeNull();
    expect(legacyQuickEditNote({ role: 'user', content: NOTE })).toBeNull();
  });
});

describe('planQuickEditCards', () => {
  const note = (summary, at) => ({
    role: 'assistant',
    content: `I edited this artifact directly from its viewer (quick edit): ${summary}\nSaved as draft revision 2; not published.`,
    created_at: at,
  });
  const request = (text) => ({ role: 'user', content: text });
  const serverGroup = (slug, edits) => ({
    role: 'assistant',
    harness: 'cowork-quick-edit',
    content: 'model-facing',
    quickEditGroup: { type: 'response.quick_edit_group', kind: 'quick_edit_group', artifactId: `id-${slug}`, artifactSlug: slug, artifactTitle: slug.toUpperCase(), edits },
  });
  const edit = (id, at) => ({ editId: id, request: id, summary: `${id} done`, at });

  it('merges three adjacent older pairs into one card at the first note', () => {
    const messages = [
      request('blue'), note('Blue.', '2026-11-12T12:08:00'),
      request('bigger'), note('Bigger.', '2026-11-12T12:12:00'),
      request('bold'), note('Bold.', '2026-11-12T12:13:00'),
    ];
    const { cards, hidden } = planQuickEditCards(messages);
    expect([...cards.keys()]).toEqual([1]);
    expect(cards.get(1).edits.map((e) => e.request)).toEqual(['blue', 'bigger', 'bold']);
    expect([...hidden].sort()).toEqual([0, 2, 3, 4, 5]);
  });

  it('merges an older note with an adjacent server group, which names the artifact, in time order', () => {
    const messages = [
      request('blue'), note('Blue.', '2026-11-12T12:08:00Z'),
      serverGroup('deck-1', [edit('e2', '2026-11-12T12:12:00Z'), edit('e3', '2026-11-12T12:13:00Z')]),
    ];
    const { cards } = planQuickEditCards(messages);
    const card = cards.get(1);
    expect(card.artifactSlug).toBe('deck-1');
    expect(card.artifactTitle).toBe('DECK-1');
    expect(card.edits.map((e) => e.editId)).toHaveLength(3);
    expect(card.edits.map((e) => e.summary)).toEqual(['Blue.', 'e2 done', 'e3 done']);
  });

  it('keeps cards split by a user message, or by an answer, apart', () => {
    const split = [
      serverGroup('deck-1', [edit('e1')]),
      request('what changed?'),
      serverGroup('deck-1', [edit('e2')]),
    ];
    expect([...planQuickEditCards(split).cards.keys()]).toEqual([0, 2]);
    const answered = [
      request('blue'), note('Blue.'),
      { role: 'assistant', content: 'Anything else?' },
      request('bold'), note('Bold.'),
    ];
    expect([...planQuickEditCards(answered).cards.keys()]).toEqual([1, 4]);
  });

  it('keeps groups for different artifacts separate', () => {
    const messages = [serverGroup('deck-1', [edit('e1')]), serverGroup('deck-2', [edit('e2')])];
    const { cards, hidden } = planQuickEditCards(messages);
    expect([...cards.keys()]).toEqual([0, 1]);
    expect(hidden.size).toBe(0);
  });

  it('merges two adjacent groups for the same artifact', () => {
    const messages = [serverGroup('deck-1', [edit('e1')]), serverGroup('deck-1', [edit('e2')])];
    const { cards, hidden } = planQuickEditCards(messages);
    expect(cards.get(0).edits.map((e) => e.editId)).toEqual(['e1', 'e2']);
    expect([...hidden]).toEqual([1]);
  });
});
