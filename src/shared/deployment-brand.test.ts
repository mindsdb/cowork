import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { BRAND_SCRIPT_PATH, BRAND_STYLESHEET_PATH, withDeploymentBrand } from './deployment-brand';

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

  it('leaves hosted web and desktop source pages without deployment hooks', () => {
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
