import { beforeEach, describe, expect, it, vi } from 'vitest';

const transitionMock = vi.hoisted(() => ({ prepareForOrganizationReload: vi.fn() }));
vi.mock('./organizationTransition', () => transitionMock);

import {
  __resetOrganizationRequestBoundaryForTests,
  EXPECTED_ORGANIZATION_HEADER,
  expectedOrganizationHeaders,
  handleOrganizationBoundaryResponse,
} from './organizationRequestBoundary';

function base64UrlJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function accessToken(activateOrganization) {
  return `${base64UrlJson({ alg: 'none' })}.${base64UrlJson({
    activate_organization: activateOrganization,
    label: 'München',
  })}.signature`;
}

beforeEach(() => {
  __resetOrganizationRequestBoundaryForTests();
  transitionMock.prepareForOrganizationReload.mockReset();
});

describe('expectedOrganizationHeaders', () => {
  it('pins the object claim from the first readable access token', () => {
    expect(expectedOrganizationHeaders(accessToken({ id: 'org-a', name: 'Acme' }))).toEqual({
      [EXPECTED_ORGANIZATION_HEADER]: 'org-a',
    });
    expect(expectedOrganizationHeaders('not-a-jwt')).toEqual({
      [EXPECTED_ORGANIZATION_HEADER]: 'org-a',
    });
  });

  it.each([
    ['a JSON object string', JSON.stringify({ id: 'org-a' })],
    ['a JSON id string', JSON.stringify('org-a')],
    ['a raw id string', 'org-a'],
    ['the object name fallback', { name: 'org-a' }],
  ])('reads %s activate_organization claim', (_description, claim) => {
    expect(expectedOrganizationHeaders(accessToken(claim))).toEqual({
      [EXPECTED_ORGANIZATION_HEADER]: 'org-a',
    });
  });

  it('waits for the first token with a readable organization claim', () => {
    expect(expectedOrganizationHeaders('malformed')).toEqual({});
    expect(expectedOrganizationHeaders(accessToken(null))).toEqual({});
    expect(expectedOrganizationHeaders(accessToken({ id: 'org-a' }))).toEqual({
      [EXPECTED_ORGANIZATION_HEADER]: 'org-a',
    });
  });

  it('clears and reloads instead of accepting a later token organization', () => {
    expectedOrganizationHeaders(accessToken({ id: 'org-a' }));

    expect(() => expectedOrganizationHeaders(accessToken({ id: 'org-b' })))
      .toThrow('The active organization changed; reload required');
    expect(transitionMock.prepareForOrganizationReload).toHaveBeenCalledTimes(1);
  });

  it('can pin a new organization after the test reset', () => {
    expectedOrganizationHeaders(accessToken({ id: 'org-a' }));
    __resetOrganizationRequestBoundaryForTests();

    expect(expectedOrganizationHeaders(accessToken({ id: 'org-b' }))).toEqual({
      [EXPECTED_ORGANIZATION_HEADER]: 'org-b',
    });
  });
});

describe('handleOrganizationBoundaryResponse', () => {
  it('clears and reloads for the mandatory response instruction', () => {
    const response = new Response(null, {
      headers: { 'X-Cowork-Organization-Reload': ' Required ' },
    });

    expect(handleOrganizationBoundaryResponse(response)).toBe(true);
    expect(transitionMock.prepareForOrganizationReload).toHaveBeenCalledTimes(1);
  });

  it('leaves ordinary and malformed responses alone', () => {
    expect(handleOrganizationBoundaryResponse(new Response())).toBe(false);
    expect(handleOrganizationBoundaryResponse({ headers: { get: () => 'optional' } })).toBe(false);
    expect(handleOrganizationBoundaryResponse(null)).toBe(false);
    expect(transitionMock.prepareForOrganizationReload).not.toHaveBeenCalled();
  });
});
