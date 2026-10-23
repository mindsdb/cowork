/*
 * The two shells' Content-Security-Policy, pinned.
 *
 * A preview rendered into the iframe through `srcdoc` INHERITS its embedder's
 * policy, so index-web.html's script-src still decides whether a chart in such
 * a preview renders or the panel sits blank. With draft links on, the web
 * preview is a frame navigated to a signed link on a draft host instead: the
 * draft follows that host's policy, and this file only has to let the frame
 * load, through the draft hosts in frame-src/child-src.
 *
 * Desktop navigates its preview frame to its loopback server, so its policy
 * governs the app alone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DRAFT_LINK_ORIGINS } from './cowork/lib/draftLinkOrigins';

const ARTIFACT_CDN = 'https://cdn.jsdelivr.net';

function directive(file: string, name: string): string[] {
  const html = readFileSync(join(__dirname, file), 'utf8');
  const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
  if (!meta) throw new Error(`no CSP meta tag in ${file}`);
  const found = meta[1]
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  if (!found) throw new Error(`no ${name} directive in ${file}`);
  return found.split(/\s+/).slice(1);
}

// Wildcard https sources other than the Drive picker's image host.
function artifactWildcards(sources: string[]): string[] {
  return sources.filter(
    (source) => source.startsWith('https://*.') && source !== 'https://*.googleusercontent.com',
  );
}

// Sources on the artifact domain or on one of our own app domains.
function ourDomains(sources: string[]): string[] {
  return sources.filter((source) => /\.mindshub\.(co|ai)(:|\/|$)/.test(source));
}

describe('shell CSP', () => {
  /*
   * The visual editor, the revision comparison and the srcdoc fallback (any
   * deployment that issues no draft links, self-hosted ones included) still
   * inherit this policy, and anton's dashboards load Tailwind and ECharts from
   * this host. It comes out only when nothing renders through srcdoc.
   */
  it('keeps the chart CDN for previews that still render through srcdoc', () => {
    expect(directive('index-web.html', 'script-src')).toContain(ARTIFACT_CDN);
  });

  it('keeps web script-src to the Drive picker and that one CDN', () => {
    const hosts = directive('index-web.html', 'script-src').filter((token) => token.startsWith('https://'));
    expect(hosts).toEqual(['https://apis.google.com', ARTIFACT_CDN]);
  });

  /*
   * One build serves every environment, so all three draft hosts are listed,
   * and nothing else on our domains: no wildcard, which would also admit every
   * published artifact host, and never one of our app domains, which would let
   * a frame load the console or cowork itself.
   */
  it.each(['frame-src', 'child-src'])('lets the web shell frame exactly the draft hosts in %s', (name) => {
    const sources = directive('index-web.html', name);
    expect(artifactWildcards(sources)).toEqual([]);
    expect(ourDomains(sources)).toEqual([...DRAFT_LINK_ORIGINS]);
    // A scheme source such as https: or a bare * would admit every host.
    expect(sources.filter((source) => source === '*' || /^[a-z][a-z0-9+.-]*:$/i.test(source))).toEqual([]);
  });

  it('gives frame-src and child-src the same sources', () => {
    expect(directive('index-web.html', 'child-src')).toEqual(directive('index-web.html', 'frame-src'));
  });

  /*
   * Desktop never frames a draft host (it navigates to its loopback server),
   * so neither the draft hosts nor the CDN belong in its policy.
   */
  it('does not widen the desktop shell', () => {
    expect(directive('index.html', 'script-src')).not.toContain(ARTIFACT_CDN);
    expect(ourDomains(directive('index.html', 'frame-src'))).toEqual([]);
    expect(ourDomains(directive('index.html', 'child-src'))).toEqual([]);
  });
});
