import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ fetchNotionPage: vi.fn() }));

import { MAX_INCLUDED_NOTION_CHARS, describeNotionReferencePages, loadNotionPageTexts } from './notionReferencePages';

const chip = (over = {}) => ({
  id: 'notion-p1', source: 'notion', name: 'Getting Started',
  notionPageId: 'p1', url: 'https://www.notion.so/p1', workspace: 'Team', connectionName: 'ws-a', ...over,
});

describe('loadNotionPageTexts', () => {
  it('fetches each picked page through its own connection', async () => {
    const fetchPage = vi.fn(async () => ({ title: 'Getting Started', text: 'Welcome', truncated: false }));
    const texts = await loadNotionPageTexts([chip(), { id: 'drive-1', source: 'gdrive' }], fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0].slice(0, 2)).toEqual(['ws-a', 'https://www.notion.so/p1']);
    expect(texts.get('notion-p1').text).toBe('Welcome');
  });

  it('leaves out a page that fails, is empty, or has no connection', async () => {
    const fetchPage = vi.fn()
      .mockRejectedValueOnce(new Error('409'))
      .mockResolvedValueOnce({ text: '' });
    const texts = await loadNotionPageTexts(
      [chip(), chip({ id: 'notion-p2' }), chip({ id: 'notion-p3', connectionName: undefined })],
      fetchPage,
    );
    expect(texts.size).toBe(0);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

describe('describeNotionReferencePages', () => {
  it('includes a fetched page’s text and says to answer from it', () => {
    const note = describeNotionReferencePages([chip()], new Map([['notion-p1', { text: 'Welcome', truncated: false }]]));
    expect(note).toContain('Their contents are included below');
    expect(note).toContain('--- Notion page: Getting Started (workspace: Team), https://www.notion.so/p1 ---\nWelcome\n--- end of page ---');
    expect(note).not.toContain('could not be loaded');
  });

  it('tells the agent to fetch the rest of a cut-short page', () => {
    const note = describeNotionReferencePages([chip()], new Map([['notion-p1', { text: 'Start', truncated: true }]]));
    expect(note).toContain('cut short');
    expect(note).toContain('notion__notion-fetch');
  });

  it('falls back to the fetch instruction for a page that was not loaded', () => {
    const note = describeNotionReferencePages([chip()]);
    expect(note).toContain('- Getting Started (workspace: Team): https://www.notion.so/p1');
    expect(note).toContain('could not be loaded here. Read it with the notion__notion-fetch tool');
  });

  it('includes pages in order until the total text limit, then points to notion-fetch', () => {
    const half = 'x'.repeat(MAX_INCLUDED_NOTION_CHARS / 2);
    const chips = [chip(), chip({ id: 'notion-p2', name: 'Second' }), chip({ id: 'notion-p3', name: 'Third', url: 'https://www.notion.so/p3' })];
    const texts = new Map(chips.map((c) => [c.id, { text: half, truncated: false }]));

    const note = describeNotionReferencePages(chips, texts);

    expect(note.split(half).length - 1).toBe(2);
    expect(note).toContain('--- Notion page: Second (workspace: Team)');
    expect(note).toContain('- Third (workspace: Team): https://www.notion.so/p3\n  Its contents are not included, to keep this message short. Read it with the notion__notion-fetch tool');
  });

  it('still includes a short page that fits after one that did not', () => {
    const chips = [chip(), chip({ id: 'notion-p2', name: 'Big' }), chip({ id: 'notion-p3', name: 'Small' })];
    const texts = new Map([
      ['notion-p1', { text: 'x'.repeat(MAX_INCLUDED_NOTION_CHARS - 10), truncated: false }],
      ['notion-p2', { text: 'y'.repeat(20), truncated: false }],
      ['notion-p3', { text: 'tiny', truncated: false }],
    ]);

    const note = describeNotionReferencePages(chips, texts);

    expect(note).toContain('- Big (workspace: Team)');
    expect(note).toContain('--- Notion page: Small (workspace: Team), https://www.notion.so/p1 ---\ntiny\n--- end of page ---');
  });

  it('adds nothing without Notion pages', () => {
    expect(describeNotionReferencePages([{ id: 'd', source: 'gdrive' }])).toBe('');
  });
});
