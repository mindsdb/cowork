import { afterEach, describe, expect, it } from 'vitest';
import { askAgentAbout, clearDocView, docContextFor, setDocView, takeDocContext } from './docViewContext';

const view = { artifactId: 'a1', projectId: 'p1', title: 'Plan', tab: 't_1', rev: 4, mode: 'edit' };
const request = { artifactId: 'a1', projectId: 'p1', tab: 't_2', selection: { blockIds: ['b_1'], quote: 'Lead' }, request: 'Make it shorter' };

afterEach(() => { clearDocView('conv-1'); });

describe('docContextFor', () => {
  it('rides on every message while the doc is open', () => {
    setDocView('conv-1', view);
    expect(docContextFor('conv-1')).toEqual(view);
    expect(docContextFor('conv-1')).toEqual(view);
    expect(docContextFor('conv-2')).toBeNull();
    clearDocView('conv-1');
    expect(docContextFor('conv-1')).toBeNull();
  });

  it('forgets a doc the pane reports closed', () => {
    setDocView('conv-1', view);
    setDocView('conv-1', null);
    expect(docContextFor('conv-1')).toBeNull();
  });

  it('clears nothing for a chat with no conversation yet', () => {
    setDocView('conv-1', view);
    clearDocView(undefined);
    expect(docContextFor('conv-1')).toEqual(view);
  });

  it('puts a message\'s Edit-with-agent request on top of the view, for that message only', () => {
    setDocView('conv-1', { ...view, selection: { blockIds: ['b_9'] } });
    expect(docContextFor('conv-1', request)).toEqual({ ...view, ...request });
    expect(docContextFor('conv-1')).toEqual({ ...view, selection: { blockIds: ['b_9'] } });
  });

  it('keeps a request whose doc is no longer the one open', () => {
    // Queued behind a turn, it goes out after the person opened another doc
    // (or closed this one): it still names, and only names, its own doc.
    setDocView('conv-1', { ...view, artifactId: 'a2', title: 'Other' });
    expect(docContextFor('conv-1', request)).toEqual(request);
    clearDocView('conv-1');
    expect(docContextFor('conv-1', request)).toEqual(request);
    expect(docContextFor(undefined, request)).toEqual(request);
  });

  it('sends nothing without a doc', () => {
    expect(docContextFor('conv-3', { request: 'orphan' })).toBeNull();
    expect(docContextFor(null)).toBeNull();
    setDocView(null, view);
    expect(docContextFor(null)).toBeNull();
  });
});

describe('takeDocContext', () => {
  const picked = { blockIds: ['b_2'], quote: 'Acme leads' };

  it('sends a passage the person picked with one message only', () => {
    // Found in review: a passage picked once rode on every later message.
    setDocView('conv-1', { ...view, selection: picked });
    expect(takeDocContext('conv-1')).toEqual({ ...view, selection: picked });
    expect(takeDocContext('conv-1')).toEqual(view);
    // The pane reports the same pick with its next view (a new rev): still taken.
    setDocView('conv-1', { ...view, rev: 5, selection: picked });
    expect(takeDocContext('conv-1')).toEqual({ ...view, rev: 5 });
  });

  it('sends a new pick, even of the same words', () => {
    setDocView('conv-1', { ...view, selection: picked });
    takeDocContext('conv-1');
    setDocView('conv-1', { ...view, selection: { ...picked } });
    expect(takeDocContext('conv-1')).toEqual({ ...view, selection: picked });
  });

  it('takes nothing from another conversation, or from a message with no doc', () => {
    setDocView('conv-1', { ...view, selection: picked });
    expect(takeDocContext('conv-2')).toBeNull();
    expect(takeDocContext(null, { request: 'orphan' })).toBeNull();
    expect(docContextFor('conv-1')).toEqual({ ...view, selection: picked });
  });

  it('forgets what was taken once the doc closes', () => {
    setDocView('conv-1', { ...view, selection: picked });
    takeDocContext('conv-1');
    clearDocView('conv-1');
    setDocView('conv-1', { ...view, selection: picked });
    expect(takeDocContext('conv-1')).toEqual({ ...view, selection: picked });
  });
});

describe('askAgentAbout', () => {
  const doc = { artifactId: 'a1', projectId: 'p1' };
  const long = `Acme ${'leads on price '.repeat(20)}`;
  const message = (ask) => askAgentAbout(doc, { blockIds: ['b_1'], tabId: 't_1', ...ask }).message;

  it('quotes the passage on one line above the request', () => {
    expect(message({ quote: '  Acme\n  leads ', request: 'Shorter', mode: 'edit' })).toBe('> Acme leads\n\nShorter');
  });

  it('clips a long passage, and says it did', () => {
    const [quoted] = message({ quote: long, request: 'Shorter', mode: 'edit' }).split('\n');
    expect(quoted).toHaveLength(2 + 220);
    expect(quoted.endsWith('…')).toBe(true);
  });

  it('sends only the request for new writing, or with nothing picked', () => {
    expect(message({ quote: 'Heading', request: 'Write the intro', mode: 'write' })).toBe('Write the intro');
    expect(message({ quote: '', request: 'Add a summary', mode: 'edit' })).toBe('Add a summary');
  });

  it('names the doc, tab and blocks it is about in the request that goes with it', () => {
    const { docRequest } = askAgentAbout(doc, { blockIds: ['b_1', 'b_2'], quote: 'Acme', request: 'Shorter', tabId: 't_2', mode: 'edit' });
    expect(docRequest).toEqual({ artifactId: 'a1', projectId: 'p1', tab: 't_2', selection: { blockIds: ['b_1', 'b_2'], quote: 'Acme' }, request: 'Shorter' });
    expect(askAgentAbout(doc, { blockIds: ['b_3'], quote: '', request: 'Write it', tabId: 't_1', mode: 'write' }).docRequest.selection).toEqual({ blockIds: ['b_3'] });
  });
});
