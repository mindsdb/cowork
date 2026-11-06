import { describe, expect, it } from 'vitest';
import { ORG_BRAND_IMAGE_ORIGINS, withOrgBrandImageSources } from './org-brand-image-origins';

const page = (policy: string) => `<html><head><meta http-equiv="Content-Security-Policy" content="${policy}" /></head></html>`;
const policyOf = (html: string) => /content="([^"]*)"/.exec(html)![1];

describe('withOrgBrandImageSources', () => {
  it('appends the auth hosts to img-src and changes nothing else', () => {
    const html = withOrgBrandImageSources(page("default-src 'self'; img-src 'self' data:; frame-src 'self'"));
    expect(policyOf(html)).toBe(`default-src 'self'; img-src 'self' data: ${ORG_BRAND_IMAGE_ORIGINS.join(' ')}; frame-src 'self'`);
  });

  it('names only auth hosts and the dev domain, over https', () => {
    for (const origin of ORG_BRAND_IMAGE_ORIGINS) {
      expect(origin).toMatch(/^https:\/\/(auth(\.staging)?\.mindshub\.ai|\*\.dev\.mindshub\.ai)$/);
    }
  });

  it.each([
    ['no meta tag', '<html></html>'],
    ['two meta tags', page("img-src 'self'") + page("img-src 'self'")],
    ['no img-src', page("default-src 'self'")],
    ['two img-src', page("img-src 'self'; img-src data:")],
    ['a host already listed', page(`img-src 'self' ${ORG_BRAND_IMAGE_ORIGINS[0]}`)],
  ])('refuses %s', (_name, html) => {
    expect(() => withOrgBrandImageSources(html)).toThrow();
  });
});
