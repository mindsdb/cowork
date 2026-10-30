import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { DRAFT_LINK_ORIGINS, withDraftLinkFrameSources } from './draft-link-origins';

const webPage = readFileSync(path.resolve(__dirname, '../renderer/index-web.html'), 'utf-8');
const META = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/;
const FRAME_DIRECTIVES = ['frame-src', 'child-src'];

function policyOf(html: string): string {
  const meta = META.exec(html);
  if (!meta) throw new Error('no CSP meta tag');
  return meta[1];
}

function directives(html: string): string[][] {
  return policyOf(html).split(';').map((part) => part.trim().split(/\s+/));
}

function directive(html: string, name: string): string[] {
  const found = directives(html).find(([directiveName]) => directiveName === name);
  if (!found) throw new Error(`no ${name} directive`);
  return found.slice(1);
}

// The template with its policy's directives rewritten by `edit`.
function withPolicy(edit: (parts: string[]) => string[]): string {
  const policy = policyOf(webPage);
  return webPage.replace(policy, () => edit(policy.split(';')).join(';'));
}

const isFrameDirective = (part: string) => FRAME_DIRECTIVES.includes(part.trim().split(/\s+/)[0]);

describe('DRAFT_LINK_ORIGINS', () => {
  it('is exactly the three draft hosts, with no wildcard', () => {
    expect(DRAFT_LINK_ORIGINS).toEqual([
      'https://draft.mindshub.co',
      'https://draft-staging.mindshub.co',
      'https://draft-dev.mindshub.co',
    ]);
  });
});

describe('withDraftLinkFrameSources', () => {
  const page = withDraftLinkFrameSources(webPage);

  it.each(FRAME_DIRECTIVES)('appends exactly the draft hosts to %s', (name) => {
    expect(directive(page, name)).toEqual([...directive(webPage, name), ...DRAFT_LINK_ORIGINS]);
  });

  it('keeps frame-src and child-src equal', () => {
    expect(directive(page, 'child-src')).toEqual(directive(page, 'frame-src'));
  });

  it('leaves every other directive as it was', () => {
    const others = (html: string) => directives(html).filter(([name]) => !FRAME_DIRECTIVES.includes(name));
    expect(others(page)).toEqual(others(webPage));
    expect(directive(page, 'script-src')).toEqual(directive(webPage, 'script-src'));
  });

  it('changes nothing in the page but the two appended source lists', () => {
    const appended = ` ${DRAFT_LINK_ORIGINS.join(' ')}`;
    expect(page.split(appended)).toHaveLength(3);
    expect(page.split(appended).join('')).toBe(webPage);
  });

  it('keeps the whitespace around each directive it widens', () => {
    const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; frame-src 'self' ; child-src 'self'" />`;
    const hosts = DRAFT_LINK_ORIGINS.join(' ');
    expect(withDraftLinkFrameSources(html)).toBe(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; frame-src 'self' ${hosts} ; child-src 'self' ${hosts}" />`,
    );
  });

  it('refuses a page without a CSP meta tag', () => {
    const html = webPage.replace('http-equiv="Content-Security-Policy"', 'http-equiv="X-UA-Compatible"');
    expect(() => withDraftLinkFrameSources(html)).toThrow('meta tag');
  });

  it('refuses a page with a second CSP meta tag', () => {
    const second = `<meta http-equiv="Content-Security-Policy" content="frame-src 'self'; child-src 'self'" />`;
    expect(() => withDraftLinkFrameSources(webPage.replace('<title>', `${second}\n    <title>`))).toThrow('meta tag');
  });

  it('refuses a CSP meta tag whose policy it cannot find', () => {
    const html = `<meta content="frame-src 'self'; child-src 'self'" http-equiv="Content-Security-Policy" />`;
    expect(() => withDraftLinkFrameSources(html)).toThrow('meta tag');
  });

  it.each(FRAME_DIRECTIVES)('refuses a policy without %s', (name) => {
    const html = withPolicy((parts) => parts.filter((part) => part.trim().split(/\s+/)[0] !== name));
    expect(() => withDraftLinkFrameSources(html)).toThrow(`exactly one ${name} directive`);
  });

  it.each(FRAME_DIRECTIVES)('refuses a policy with %s twice', (name) => {
    const html = withPolicy((parts) => [...parts, ` ${name} 'self'`]);
    expect(() => withDraftLinkFrameSources(html)).toThrow(`exactly one ${name} directive`);
  });

  it.each([...DRAFT_LINK_ORIGINS])('refuses a policy that already lists %s', (origin) => {
    const html = withPolicy((parts) => parts.map((part) => (isFrameDirective(part) ? `${part} ${origin}` : part)));
    expect(() => withDraftLinkFrameSources(html)).toThrow(`already lists ${origin}`);
  });

  it('refuses its own output, so a page never takes the hosts twice', () => {
    expect(() => withDraftLinkFrameSources(page)).toThrow('already lists');
  });
});
