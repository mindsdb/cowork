import { describe, expect, it } from 'vitest';
import { GALLERY_CONSOLE_ORIGINS, galleryImageOrigins, withGalleryImageSources } from './gallery-image-origins';

const page = (policy: string) => `<html><head><meta http-equiv="Content-Security-Policy" content="${policy}" /></head></html>`;
const policyOf = (html: string) => /content="([^"]*)"/.exec(html)![1];

describe('withGalleryImageSources', () => {
  it('appends the console hosts to img-src and changes nothing else', () => {
    const html = withGalleryImageSources(page("default-src 'self'; img-src 'self' data:; frame-src 'self'"));
    expect(policyOf(html)).toBe(`default-src 'self'; img-src 'self' data: ${GALLERY_CONSOLE_ORIGINS.join(' ')}; frame-src 'self'`);
  });

  it("names only its own environment's console, and a dev host only in development", () => {
    expect(galleryImageOrigins('production')).toEqual(['https://console.mindshub.ai']);
    expect(galleryImageOrigins('staging')).toEqual(['https://console.staging.mindshub.ai']);
    expect(galleryImageOrigins('development')).toEqual(['https://*.dev.mindshub.ai']);
    for (const env of ['production', 'staging', undefined, '', 'something-else']) {
      expect(galleryImageOrigins(env).some((o) => o.includes('.dev.'))).toBe(false);
    }
  });

  it('leaves a host the page already lists, as the dev wildcard is for org brand images', () => {
    const html = page("img-src 'self' https://*.dev.mindshub.ai");
    expect(withGalleryImageSources(html, galleryImageOrigins('development'))).toBe(html);
  });

  it.each([
    ['no meta tag', '<html></html>'],
    ['two meta tags', page("img-src 'self'") + page("img-src 'self'")],
    ['no img-src', page("default-src 'self'")],
    ['two img-src', page("img-src 'self'; img-src data:")],
  ])('refuses %s', (_name, html) => {
    expect(() => withGalleryImageSources(html)).toThrow();
  });
});
