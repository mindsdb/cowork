import { describe, expect, it } from 'vitest';
import { AUTH_IMAGE_HOST } from '../../lib/orgBranding';
import { dataUriIcons, getOrgIcons, parseOrgIcons, setOrgIcons } from './orgIcons';

const icon = (id) => `https://${AUTH_IMAGE_HOST}/v1/organizations/${id}/branding/icon?v=1`;

describe('parseOrgIcons', () => {
  it('maps org id to a trusted absolute icon URL', () => {
    expect(parseOrgIcons({ reachable: true, orgs: [{ id: 'org-acme', iconUrl: icon('org-acme') }] }))
      .toEqual({ 'org-acme': icon('org-acme') });
  });

  it.each([
    ['a root-relative URL', '/v1/organizations/org-acme/branding/icon'],
    ['another host', 'https://images.globex.com/icon.png'],
    ['plain http', icon('org-acme').replace('https:', 'http:')],
    ['no URL', null],
  ])('drops %s', (_name, iconUrl) => {
    expect(parseOrgIcons({ orgs: [{ id: 'org-acme', iconUrl }] })).toEqual({});
  });

  it.each([null, {}, { orgs: 'x' }, { orgs: [{ iconUrl: icon('x') }] }])('reads %j as no icons', (raw) => {
    expect(parseOrgIcons(raw)).toEqual({});
  });
});

describe('dataUriIcons', () => {
  it('keeps only PNG, JPEG or WebP data URIs', () => {
    expect(dataUriIcons({ a: 'data:image/png;base64,AA==', b: 'data:image/svg+xml;base64,AA==', c: icon('c') }))
      .toEqual({ a: 'data:image/png;base64,AA==' });
  });
});

describe('the store', () => {
  it('holds the latest answer', () => {
    setOrgIcons({ 'org-acme': icon('org-acme') });
    expect(getOrgIcons()).toEqual({ 'org-acme': icon('org-acme') });
    setOrgIcons({});
    expect(getOrgIcons()).toEqual({});
  });
});
