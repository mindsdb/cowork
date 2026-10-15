import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { BRAND_SCRIPT_PATH, BRAND_STYLESHEET_PATH, withDeploymentBrand } from './deployment-brand';

const webPage = readFileSync(path.resolve(__dirname, '../renderer/index-web.html'), 'utf-8');

describe('withDeploymentBrand', () => {
  const page = withDeploymentBrand(webPage);
  const at = (needle: string) => {
    const index = page.indexOf(needle);
    expect(index, needle).toBeGreaterThan(-1);
    return index;
  };

  it('loads the config as a blocking classic script right after the title', () => {
    const script = `<script src="${BRAND_SCRIPT_PATH}"></script>`;
    expect(at(script)).toBeGreaterThan(at('</title>'));
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

  it('leaves the source page, which hosted web builds from, without the brand', () => {
    expect(webPage).not.toContain('/brand/');
  });

  it('fails the build when the page lacks a single title or head end', () => {
    expect(() => withDeploymentBrand('<html><head></head></html>')).toThrow('</title>');
    expect(() => withDeploymentBrand('<title>a</title><title>b</title></head>')).toThrow('</title>');
    expect(() => withDeploymentBrand('<head><title>a</title>')).toThrow('</head>');
  });
});
