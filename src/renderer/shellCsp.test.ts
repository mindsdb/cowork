/*
 * The two shells' Content-Security-Policy, pinned.
 *
 * A preview rendered into the iframe through `srcdoc` INHERITS its embedder's
 * policy, so index-web.html's script-src still decides whether a chart in such
 * a preview renders or the panel sits blank. With draft links on, the web
 * preview is a frame navigated to a signed link on a draft host instead: the
 * draft follows that host's policy, and the page only has to let the frame
 * load. The hosted build (web with the platform UI on) appends the draft hosts
 * to frame-src/child-src at build time, through withDraftLinkFrameSources; the
 * template names none of them, because self-hosted and white-label pages are
 * built from it too.
 *
 * Desktop navigates its preview frame to its loopback server, so its policy
 * governs the app alone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DRAFT_LINK_ORIGINS, withDraftLinkFrameSources } from '../shared/draft-link-origins';

const ARTIFACT_CDN = 'https://cdn.jsdelivr.net';

const webTemplate = readFileSync(join(__dirname, 'index-web.html'), 'utf8');
const platformWebPage = withDraftLinkFrameSources(webTemplate);
const desktopPage = readFileSync(join(__dirname, 'index.html'), 'utf8');

const WEB_PAGES: [string, string][] = [
  ['the web template', webTemplate],
  ['the platform-UI web page', platformWebPage],
];

function policy(html: string): string[][] {
  const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
  if (!meta) throw new Error('no CSP meta tag');
  return meta[1].split(';').map((part) => part.trim().split(/\s+/));
}

function directive(html: string, name: string): string[] {
  const found = policy(html).find(([directiveName]) => directiveName === name);
  if (!found) throw new Error(`no ${name} directive`);
  return found.slice(1);
}

// Wildcard https sources other than the Drive picker's image host.
function artifactWildcards(sources: string[]): string[] {
  return sources.filter(
    (source) => source.startsWith('https://*.') && source !== 'https://*.googleusercontent.com',
  );
}

// Sources on the artifact domain or on one of our own app domains, apex included.
function ourDomains(sources: string[]): string[] {
  return sources.filter((source) => /(^|[/.])mindshub\.(co|ai)(:|\/|$)/.test(source));
}

// A scheme source such as https: or a bare * would admit every host.
function schemeSources(sources: string[]): string[] {
  return sources.filter((source) => source === '*' || /^[a-z][a-z0-9+.-]*:$/i.test(source));
}

describe('shell CSP', () => {
  /*
   * The visual editor, the revision comparison and the srcdoc fallback (any
   * deployment that issues no draft links, self-hosted ones included) still
   * inherit this policy, and anton's dashboards load Tailwind and ECharts from
   * this host. It comes out only when nothing renders through srcdoc.
   */
  it.each(WEB_PAGES)('keeps the chart CDN in %s for previews that still render through srcdoc', (_name, html) => {
    expect(directive(html, 'script-src')).toContain(ARTIFACT_CDN);
  });

  it.each(WEB_PAGES)('keeps script-src in %s to the Drive picker and that one CDN', (_name, html) => {
    const hosts = directive(html, 'script-src').filter((token) => token.startsWith('https://'));
    expect(hosts).toEqual(['https://apis.google.com', ARTIFACT_CDN]);
  });

  it('gives the platform-UI web page the template script-src unchanged', () => {
    expect(directive(platformWebPage, 'script-src')).toEqual(directive(webTemplate, 'script-src'));
  });

  /*
   * Self-hosted and white-label pages are the template as it is, so it names
   * no draft host and nothing else on our domains anywhere in its policy.
   */
  it('keeps the web template free of the draft hosts and our domains', () => {
    for (const origin of DRAFT_LINK_ORIGINS) expect(webTemplate).not.toContain(origin);
    expect(ourDomains(policy(webTemplate).flatMap((parts) => parts.slice(1)))).toEqual([]);
  });

  /*
   * One build serves every environment, so all three draft hosts are listed,
   * and nothing else on our domains: no wildcard, which would also admit every
   * published artifact host, and never one of our app domains, which would let
   * a frame load the console or cowork itself.
   */
  it.each(['frame-src', 'child-src'])('lets the platform-UI web page frame exactly the draft hosts in %s', (name) => {
    const sources = directive(platformWebPage, name);
    expect(artifactWildcards(sources)).toEqual([]);
    expect(ourDomains(sources)).toEqual([...DRAFT_LINK_ORIGINS]);
    expect(schemeSources(sources)).toEqual([]);
  });

  it.each(['frame-src', 'child-src'])('lets the web template frame no draft host in %s', (name) => {
    const sources = directive(webTemplate, name);
    expect(artifactWildcards(sources)).toEqual([]);
    expect(ourDomains(sources)).toEqual([]);
    expect(schemeSources(sources)).toEqual([]);
  });

  it.each(WEB_PAGES)('gives frame-src and child-src the same sources in %s', (_name, html) => {
    expect(directive(html, 'child-src')).toEqual(directive(html, 'frame-src'));
  });

  /*
   * Desktop never frames a draft host (it navigates to its loopback server),
   * so neither the draft hosts nor the CDN belong in its policy.
   */
  it('does not widen the desktop shell', () => {
    expect(directive(desktopPage, 'script-src')).not.toContain(ARTIFACT_CDN);
    expect(ourDomains(directive(desktopPage, 'frame-src'))).toEqual([]);
    expect(ourDomains(directive(desktopPage, 'child-src'))).toEqual([]);
  });
});
