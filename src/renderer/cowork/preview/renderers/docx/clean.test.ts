/*
 * Cleaning for the Word preview's nodes. The cases in clean.test.yaml each
 * clean one piece of HTML the way render.ts does, inside a holder owned by an
 * inert document. The link tests drive keepLinksInPage with real events.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';

import { cleanRenderedNodes, keepLinksInPage } from './clean';

interface CleaningCase { name: string; html: string; present?: string[]; absent?: string[] }

type CleaningCases = Record<string, CleaningCase[]>;

const CASES = load(readFileSync(join(__dirname, 'clean.test.yaml'), 'utf8')) as CleaningCases;

function cleaned(html: string): string {
  const holder = document.implementation.createHTMLDocument('').createElement('div');
  holder.innerHTML = html;
  cleanRenderedNodes(holder);
  return holder.innerHTML;
}

describe('cleanRenderedNodes', () => {
  for (const [group, cases] of Object.entries(CASES)) {
    describe(group, () => {
      it.each(cases)('$name', ({ html, present = [], absent = [] }) => {
        const out = cleaned(html);
        for (const text of present) expect(out).toContain(text);
        for (const text of absent) expect(out).not.toContain(text);
      });
    });
  }
});

describe('keepLinksInPage', () => {
  function pageWithLinks(): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = '<a id="outside" href="https://docs.google.com/x"><span>Docs</span></a>'
      + '<a id="jump" href="#later">Jump</a><p id="later">Later</p><p id="plain">Plain</p>';
    document.body.append(root);
    keepLinksInPage(root);
    return root;
  }

  function dispatch(target: Element, event: Event): boolean {
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('cancels a click, a middle click and Enter on a link, before the link sees them', () => {
    const root = pageWithLinks();
    const inner = root.querySelector('#outside span')!;
    const linkSaw = vi.fn((event: Event) => event.defaultPrevented);
    root.querySelector('#outside')!.addEventListener('click', linkSaw);

    expect(dispatch(inner, new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true);
    expect(linkSaw).toHaveReturnedWith(true);
    expect(dispatch(inner, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))).toBe(true);
    expect(dispatch(inner, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }))).toBe(true);
    root.remove();
  });

  it('leaves other keys and clicks off links alone', () => {
    const root = pageWithLinks();
    expect(dispatch(root.querySelector('#outside')!, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' }))).toBe(false);
    expect(dispatch(root.querySelector('#plain')!, new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false);
    root.remove();
  });

  it('scrolls a #fragment link to its target instead of navigating', () => {
    const root = pageWithLinks();
    const target = root.querySelector('#later')!;
    const scrollIntoView = vi.fn();
    Object.assign(target, { scrollIntoView });

    expect(dispatch(root.querySelector('#jump')!, new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    root.remove();
  });
});
