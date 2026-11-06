import { describe, it, expect } from 'vitest';
import { stripNotionPageNote, withoutNotionPageNotes } from './notionPageNote';
import { describeNotionReferencePages } from './notionReferencePages';

const page = { id: 'notion-p1', source: 'notion', name: 'Roadmap', notionPageId: 'p1', url: 'https://www.notion.so/p1', connectionName: 'ws-a' };

describe('stripNotionPageNote', () => {
  it('returns the user text a reloaded message was sent with', () => {
    const note = describeNotionReferencePages([page], new Map([['notion-p1', { text: 'Q3 goals', truncated: false }]]));
    expect(stripNotionPageNote(`what changed here?\n\n${note}`)).toBe('what changed here?');
  });

  it('leaves a message without a note unchanged', () => {
    expect(stripNotionPageNote('plain question')).toBe('plain question');
  });
});

describe('withoutNotionPageNotes', () => {
  it('strips user messages only', () => {
    const note = describeNotionReferencePages([page]);
    const assistant = { role: 'assistant', content: `quoted\n\n${note}` };
    const out = withoutNotionPageNotes([{ role: 'user', content: `hi\n\n${note}` }, assistant]);
    expect(out[0].content).toBe('hi');
    expect(out[1]).toBe(assistant);
  });
});
