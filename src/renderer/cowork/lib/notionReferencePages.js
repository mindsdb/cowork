import { fetchNotionPage } from '../api';

const NOTION_PAGE_FETCH_TIMEOUT_MS = 10_000;
// The included text stays in the conversation and is resent every turn, so
// pages past this total are left for the agent to read with notion-fetch.
// Two pages fit at the server's per-page limit of 20,000 characters.
export const MAX_INCLUDED_NOTION_CHARS = 40_000;

// Fetch each picked Notion page's text before sending, so it rides in the
// message like an uploaded file's contents. Left to fetch it themselves,
// some models (MindsHub Air) stall in a loop instead of calling the tool.
// A page that can't be fetched in time falls back to a one-line pointer to
// notion-fetch; how to use it is in notion.json's usage_notes.
export async function loadNotionPageTexts(reference, fetchPage = fetchNotionPage) {
  const pages = (reference || []).filter((a) => a.source === 'notion' && a.connectionName);
  const loaded = await Promise.all(pages.map(async (p) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NOTION_PAGE_FETCH_TIMEOUT_MS);
    try {
      const page = await fetchPage(p.connectionName, p.url || p.notionPageId, { signal: ctrl.signal });
      return page?.text ? [p.id, page] : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }));
  return new Map(loaded.filter(Boolean));
}

export function describeNotionReferencePages(reference, texts = new Map()) {
  const pages = (reference || []).filter((a) => a.source === 'notion');
  if (!pages.length) return '';
  const label = (p) => `${p.name || 'Untitled'}${p.workspace ? ` (workspace: ${p.workspace})` : ''}`;
  let budget = MAX_INCLUDED_NOTION_CHARS;
  const blocks = pages.map((p) => {
    const url = p.url || p.notionPageId;
    const page = texts.get(p.id);
    if (!page) {
      return `- ${label(p)}: ${url}\n  Its contents could not be loaded here; fetch it with notion__notion-fetch.`;
    }
    if (page.text.length > budget) {
      return `- ${label(p)}: ${url}\n  Its contents are not included, to keep this message short; fetch it with notion__notion-fetch.`;
    }
    budget -= page.text.length;
    return [
      `--- Notion page: ${label(p)}, ${url} ---`,
      page.text,
      page.truncated
        ? '--- (cut short: this is the beginning of the page; fetch the rest with notion__notion-fetch) ---'
        : '--- end of page ---',
    ].join('\n');
  });
  return [
    '[Notion pages added for this message — Anton-only context, do not echo back]',
    'The user just added the following Notion page(s). When they refer to "this page"/"these pages" '
      + 'in the message above, they mean these. Their contents are included below; answer from them directly.',
    ...blocks,
  ].join('\n');
}
