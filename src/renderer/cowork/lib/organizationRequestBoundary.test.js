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

const ORG_A = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const ORG_B = '4e27728a-a002-48b5-8961-0e1ca339d13f';

describe('expectedOrganizationHeaders', () => {
  it('pins the object claim from the first readable access token', () => {
    expect(expectedOrganizationHeaders(accessToken({ id: ORG_A, name: 'Acme' }))).toEqual({
      [EXPECTED_ORGANIZATION_HEADER]: ORG_A,
    });
    expect(expectedOrganizationHeaders('not-a-jwt')).toEqual({
      [EXPECTED_ORGANIZATION_HEADER]: ORG_A,
    });
  });

  it.each([
    ['an object claim', { id: ORG_A }],
    ['a JSON object string', JSON.stringify({ id: ORG_A })],
  ])('reads %s activate_organization claim', (_description, claim) => {
    expect(expectedOrganizationHeaders(accessToken(claim))).toEqual({
      [EXPECTED_ORGANIZATION_HEADER]: ORG_A,
    });
  });

  /*
   * The server answers anything it cannot parse as a UUID with a mandatory
   * reload, so pinning one of these would reload, pin it again, and reload
   * again. Sending no header is the recoverable answer.
   */
  it.each([
    ['a bare id string', ORG_A],
    ['a JSON id string', JSON.stringify(ORG_A)],
    ['a name without an id', { name: 'Acme' }],
    ['a non-UUID id', { id: 'org-a' }],
  ])('sends no header for %s', (_description, claim) => {
    expect(expectedOrganizationHeaders(accessToken(claim))).toEqual({});
  });

  it('waits for the first token with a readable organization claim', () => {
    expect(expectedOrganizationHeaders('malformed')).toEqual({});
    expect(expectedOrganizationHeaders(accessToken(null))).toEqual({});
    expect(expectedOrganizationHeaders(accessToken({ id: ORG_A }))).toEqual({
      [EXPECTED_ORGANIZATION_HEADER]: ORG_A,
    });
  });

  it('clears and reloads instead of accepting a later token organization', () => {
    expectedOrganizationHeaders(accessToken({ id: ORG_A }));

    expect(() => expectedOrganizationHeaders(accessToken({ id: ORG_B })))
      .toThrow('The active organization changed; reload required');
    expect(transitionMock.prepareForOrganizationReload).toHaveBeenCalledTimes(1);
  });

  it('can pin a new organization after the test reset', () => {
    expectedOrganizationHeaders(accessToken({ id: ORG_A }));
    __resetOrganizationRequestBoundaryForTests();

    expect(expectedOrganizationHeaders(accessToken({ id: ORG_B }))).toEqual({
      [EXPECTED_ORGANIZATION_HEADER]: ORG_B,
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
