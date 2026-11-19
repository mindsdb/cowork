import { describe, expect, it } from 'vitest';
import { orgBrandImageOrigins, withOrgBrandImageSources } from './org-brand-image-origins';

const ORG_BRAND_IMAGE_ORIGINS = orgBrandImageOrigins(undefined);

const page = (policy: string) => `<html><head><meta http-equiv="Content-Security-Policy" content="${policy}" /></head></html>`;
const policyOf = (html: string) => /content="([^"]*)"/.exec(html)![1];

describe('withOrgBrandImageSources', () => {
  it('appends the auth hosts to img-src and changes nothing else', () => {
    const html = withOrgBrandImageSources(page("default-src 'self'; img-src 'self' data:; frame-src 'self'"));
    expect(policyOf(html)).toBe(`default-src 'self'; img-src 'self' data: ${ORG_BRAND_IMAGE_ORIGINS.join(' ')}; frame-src 'self'`);
  });

  it("names only its own environment's auth host, and never a dev host outside development", () => {
    expect(orgBrandImageOrigins('production')).toEqual(['https://auth.mindshub.ai']);
    expect(orgBrandImageOrigins('staging')).toEqual(['https://auth.staging.mindshub.ai']);
    expect(orgBrandImageOrigins('development')).toEqual(['https://*.dev.mindshub.ai']);
    for (const env of ['production', 'staging', undefined, '', 'something-else']) {
      expect(orgBrandImageOrigins(env).some((o) => o.includes('.dev.'))).toBe(false);
    }
  });

  it("puts only the given environment's origins into img-src", () => {
    const html = withOrgBrandImageSources(page("img-src 'self'"), orgBrandImageOrigins('production'));
    expect(policyOf(html)).toBe("img-src 'self' https://auth.mindshub.ai");
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
