import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { BRAND_SCRIPT_PATH, BRAND_STYLESHEET_PATH, withDeploymentBrand } from './deployment-brand';
import { DRAFT_LINK_ORIGINS, withDraftLinkFrameSources } from './draft-link-origins';

const webPage = readFileSync(path.resolve(__dirname, '../renderer/index-web.html'), 'utf-8');
const desktopPage = readFileSync(path.resolve(__dirname, '../renderer/index.html'), 'utf-8');
const start = '<!-- cowork-deployment-brand:start -->';
const end = '<!-- cowork-deployment-brand:end -->';
const icon = '<link rel="icon" type="image/svg+xml" href="/minds-icon.svg" />';
const touchIcon = '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />';
const anchors = ['<head>', '<title>', '</title>', icon, touchIcon, '</head>'];

describe('withDeploymentBrand', () => {
  const page = withDeploymentBrand(webPage);
  const at = (needle: string) => {
    const index = page.indexOf(needle);
    expect(index, needle).toBeGreaterThan(-1);
    return index;
  };

  it('marks only the existing title, stock comment and icons for a deployment to replace', () => {
    expect(page.split(start)).toHaveLength(2);
    expect(page.split(end)).toHaveLength(2);
    const stock = webPage.slice(webPage.indexOf('<title>'), webPage.indexOf(touchIcon) + touchIcon.length);
    expect(page.slice(at(start) + start.length, at(end))).toBe(`\n    ${stock}\n    `);
    expect(at(start)).toBeGreaterThan(at('http-equiv="Content-Security-Policy"'));
    expect(at(end)).toBeLessThan(at('/gravity-field/gravity-field.css'));
    // Replacing this one region removes every stock-brand mention and icon reference.
    const outside = page.slice(0, at(start)) + page.slice(at(end) + end.length);
    expect(outside).not.toMatch(/mindshub|\/minds-icon\.svg|\/apple-touch-icon\.png/i);
  });

  it('loads the config as a blocking classic script after the replaceable region', () => {
    const script = `<script src="${BRAND_SCRIPT_PATH}"></script>`;
    expect(at(script)).toBeGreaterThan(at(end));
    expect(at(script)).toBeGreaterThan(at('http-equiv="Content-Security-Policy"'));
    expect(page).not.toMatch(/<script[^>]*src="\/brand\/brand\.js"[^>]*(async|defer|type=)/);
  });

  it('sets the tab title from the config before the bundle loads', () => {
    expect(at('document.title=n')).toBeGreaterThan(at(BRAND_SCRIPT_PATH));
    expect(at('document.title=n')).toBeLessThan(at('<script type="module"'));
  });

  it('loads the stylesheet last in the head, after the bundle could add its own', () => {
    const link = `<link rel="stylesheet" href="${BRAND_STYLESHEET_PATH}" />`;
    expect(at(link)).toBeGreaterThan(at('/gravity-field/gravity-field.css'));
    expect(page.indexOf('</head>')).toBe(at(link) + link.length + '\n  '.length);
  });

  it('leaves the source pages without deployment hooks', () => {
    for (const source of [webPage, desktopPage]) {
      expect(source).not.toContain('/brand/');
      expect(source).not.toContain('cowork-deployment-brand:');
      expect(source).toContain('<title>MindsHub Cowork</title>');
    }
    expect(webPage).toContain(icon);
    expect(webPage).toContain(touchIcon);
  });

  it.each(anchors)('refuses a missing %s', (anchor) => {
    expect(() => withDeploymentBrand(webPage.replace(anchor, ''))).toThrow(anchor);
  });

  it.each(anchors)('refuses a duplicate %s', (anchor) => {
    expect(() => withDeploymentBrand(webPage.replace(anchor, anchor + anchor))).toThrow(anchor);
  });

  it.each(anchors.slice(1))('refuses %s before its preceding anchor', (anchor) => {
    const previous = anchors[anchors.indexOf(anchor) - 1];
    const reordered = webPage.replace(anchor, '').replace(previous, anchor + previous);
    expect(() => withDeploymentBrand(reordered)).toThrow('order');
  });

  it.each([start, end])('refuses an existing deployment marker %s', (marker) => {
    expect(() => withDeploymentBrand(webPage.replace('<title>', marker + '<title>'))).toThrow('marker');
  });
});

// The hosted build runs both web-entry transforms (renderer/vite.config.ts).
describe('withDeploymentBrand beside withDraftLinkFrameSources', () => {
  const brandFirst = withDraftLinkFrameSources(withDeploymentBrand(webPage));

  /** One CSP directive's sources, from the page's meta tag. */
  function sources(html: string, name: string): string[] {
    const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';
    const directive = policy.split(';').map((part) => part.trim().split(/\s+/)).find(([first]) => first === name);
    return directive ? directive.slice(1) : [];
  }

  it('gives the same page in either order', () => {
    expect(withDeploymentBrand(withDraftLinkFrameSources(webPage))).toBe(brandFirst);
  });

  it('keeps every brand tag and every draft host', () => {
    expect(brandFirst.split(start)).toHaveLength(2);
    expect(brandFirst).toContain(`<script src="${BRAND_SCRIPT_PATH}"></script>`);
    expect(brandFirst).toContain(`<link rel="stylesheet" href="${BRAND_STYLESHEET_PATH}" />`);
    for (const origin of DRAFT_LINK_ORIGINS) {
      expect(sources(brandFirst, 'frame-src')).toContain(origin);
      expect(sources(brandFirst, 'child-src')).toContain(origin);
    }
  });

  it("lets the page's CSP load the brand's script, title line, stylesheet and images from its own origin", () => {
    expect(sources(brandFirst, 'script-src')).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'"]));
    expect(sources(brandFirst, 'style-src')).toContain("'self'");
    expect(sources(brandFirst, 'img-src')).toContain("'self'");
    // A CSP meta tag governs only what follows it.
    expect(brandFirst.indexOf(`<script src="${BRAND_SCRIPT_PATH}"></script>`))
      .toBeGreaterThan(brandFirst.indexOf('http-equiv="Content-Security-Policy"'));
  });
});
