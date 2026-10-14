/*
 * The two shells' Content-Security-Policy, pinned (ENG-2818).
 *
 * These policies are not only the app's own protection: on web an artifact is
 * rendered into the preview iframe via `srcdoc`, and a srcdoc document
 * INHERITS its embedder's policy. So index-web.html's script-src decides
 * whether a user's chart renders or the panel sits blank — a connection
 * nothing else in the tree states, and one that cost a full investigation to
 * find. A test is the cheapest place to keep saying it.
 *
 * Desktop is deliberately the other way round: ENG-2818 made the Desktop
 * preview NAVIGATE the iframe, so artifacts there carry their own (empty)
 * policy and this file's script-src governs the app alone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ARTIFACT_CDN = 'https://cdn.jsdelivr.net';

function scriptSrc(file: string): string {
  const html = readFileSync(join(__dirname, file), 'utf8');
  const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
  if (!meta) throw new Error(`no CSP meta tag in ${file}`);
  const directive = meta[1]
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src'));
  if (!directive) throw new Error(`no script-src directive in ${file}`);
  return directive;
}

describe('shell CSP', () => {
  /*
   * Temporary, and its removal is the point: ENG-2822 gives web the same
   * navigation treatment Desktop got, after which artifacts stop inheriting
   * this policy and the host should come back out. If that ticket lands and
   * this assertion still passes, the entry has outlived its reason.
   */
  it('lets the web shell load the chart CDN anton mandates, for artifact previews', () => {
    expect(scriptSrc('index-web.html')).toContain(ARTIFACT_CDN);
  });

  /*
   * Not an oversight — a claim. Desktop navigates, so nothing an artifact
   * references is governed by this policy, and adding the host here would
   * widen the app's own policy while fixing nothing.
   */
  it('does not widen the desktop shell, which navigates instead of inheriting', () => {
    expect(scriptSrc('index.html')).not.toContain(ARTIFACT_CDN);
  });

  /*
   * The palliative is one host, not a growing allowlist: anton's dashboard
   * skill requires CSS, JS and data inlined and images as data:/sibling files,
   * so one deliberate remote reference is all an artifact should have. A
   * second CDN appearing here means that assumption broke and ENG-2822 got
   * more urgent, not that the list should grow.
   */
  it('keeps the web shell to a single artifact CDN', () => {
    const hosts = scriptSrc('index-web.html')
      .split(/\s+/)
      .filter((token) => token.startsWith('https://'));
    expect(hosts).toEqual(['https://apis.google.com', ARTIFACT_CDN]);
  });
});
