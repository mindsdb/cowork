import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildPreviewSrcdoc, previewFramePolicy } from './frameDocument';
import { newPreviewToken } from './runtime/protocol';
import { scriptSha256 } from '../../../../scripts/preview-bundles.mjs';
import { documentPreviewData } from '../../../../tests/helpers/documentPreviewData';

const data = documentPreviewData();
const SCRIPT = 'document.body.dataset.ran = "1";';
const HASH = scriptSha256(SCRIPT);
const TOKEN = '0123456789abcdef0123456789abcdef';

function srcdocFor(overrides: Partial<Parameters<typeof buildPreviewSrcdoc>[0]> = {}) {
  return buildPreviewSrcdoc({ policy: previewFramePolicy(HASH), token: TOKEN, scriptText: SCRIPT, scriptSha256: HASH, ...overrides });
}

describe('buildPreviewSrcdoc', () => {
  it('writes the policy meta first, then the token meta, then the hashed script last', () => {
    const srcdoc = srcdocFor();
    const policyMeta = `<meta http-equiv="Content-Security-Policy" content="${previewFramePolicy(HASH)}">`;
    const tokenMeta = `<meta name="cowork-preview-token" content="${TOKEN}">`;
    expect(srcdoc.startsWith(policyMeta)).toBe(true);
    expect(srcdoc.indexOf(tokenMeta)).toBeGreaterThan(policyMeta.length - 1);
    expect(srcdoc.endsWith(`<script>${SCRIPT}</script>`)).toBe(true);
    expect(srcdoc.indexOf(tokenMeta)).toBeLessThan(srcdoc.indexOf('<script>'));
    expect(srcdoc).toContain('<meta http-equiv="x-dns-prefetch-control" content="off">');
  });

  it('inlines the script byte for byte, so the policy hash matches it', () => {
    const srcdoc = srcdocFor();
    const script = srcdoc.match(/<script>([\s\S]*)<\/script>$/)?.[1];
    expect(script).toBe(SCRIPT);
    expect(scriptSha256(script!)).toBe(HASH);
  });

  it('takes only the frame policy for its own script', () => {
    expect(() => srcdocFor({ policy: previewFramePolicy(scriptSha256('other')) })).toThrow('only the frame policy');
    expect(() => srcdocFor({ policy: `${previewFramePolicy(HASH)}; script-src *` })).toThrow('only the frame policy');
    expect(() => srcdocFor({ policy: "default-src 'none'" })).toThrow('only the frame policy');
  });

  it('refuses a missing or malformed hash instead of building a frame', () => {
    expect(() => srcdocFor({ scriptSha256: '' })).toThrow('base64 sha256');
    expect(() => srcdocFor({ scriptSha256: 'unsafe-inline' })).toThrow('base64 sha256');
  });

  it.each(data.malformedTokens)('refuses a token that is $label', ({ token }) => {
    expect(() => srcdocFor({ token })).toThrow('128-bit hex token');
  });

  it('accepts a fresh token', () => {
    expect(() => srcdocFor({ token: newPreviewToken() })).not.toThrow();
  });

  it.each(data.unsafeSrcdocScriptText)('refuses script text with $label', ({ text }) => {
    expect(() => srcdocFor({ scriptText: text, scriptSha256: scriptSha256(text), policy: previewFramePolicy(scriptSha256(text)) }))
      .toThrow('script text');
  });

  it('is the only place a preview frame document is assembled', () => {
    const files = ['DocumentPreviewFrame.tsx', 'DocumentPreview.tsx'];
    for (const file of files) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/cowork-preview-token|Content-Security-Policy|<script/);
    }
  });

  it('imports nothing Vite-only anywhere in its import tree, so Node can load it', () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/import\.meta/);
      expect(source, file).not.toMatch(/\?(raw|url|worker|inline)['"]/);
      expect(source, file).not.toMatch(/['"]virtual:/);
      for (const [, specifier] of source.matchAll(/from '(\.[^']+)'/g)) {
        const base = resolve(dirname(file), specifier);
        visit(['.ts', '.tsx', '/index.ts'].map((ext) => `${base}${ext}`).find((candidate) => existsSync(candidate))!);
      }
    };
    visit(join(__dirname, 'frameDocument.ts'));
    expect(seen.size).toBeGreaterThan(2);
  });
});
