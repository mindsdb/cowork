import { describe, it, expect } from 'vitest';
import { computeHeroView, providerNameFromSpec, orderMethods } from './methodHero';

const OAUTH = { id: 'browser_oauth_builtin', label: 'In-Browser Connect', recommended: true, fields: [] };
const PAT = { id: 'fine-grained-pat', label: 'Fine-grained personal access token', fields: [{ name: 'token', required: true }] };
const APP_OAUTH = { id: 'oauth', label: 'OAuth (GitHub App)', fields: [{ name: 'client_id', required: true }] };
const GITHUB_SPEC = { label: 'GitHub', title: 'Connect GitHub', logo: 'code' };

describe('providerNameFromSpec', () => {
  it('prefers the connector label', () => {
    expect(providerNameFromSpec({ label: 'GitHub', title: 'Connect GitHub' })).toBe('GitHub');
  });
  it('falls back to the title with the "Connect " prefix stripped', () => {
    expect(providerNameFromSpec({ title: 'Connect Google Drive' })).toBe('Google Drive');
  });
  it('falls back to the connector id with known display casing', () => {
    // The browser-OAuth form spec has no label AND (often) no title —
    // resolve from the connector id so the success copy says "GitHub
    // connected", not "Provider connected" (ENG-1534).
    expect(providerNameFromSpec({ _connector_id: 'github' })).toBe('GitHub');
    expect(providerNameFromSpec({ engine: 'google_drive' })).toBe('Google Drive');
  });
  it('prettifies an unknown connector id rather than going generic', () => {
    expect(providerNameFromSpec({ _connector_id: 'acme_crm' })).toBe('Acme Crm');
  });
  it('falls back to a generic word when nothing is available', () => {
    expect(providerNameFromSpec({})).toBe('the provider');
    expect(providerNameFromSpec(null)).toBe('the provider');
  });
});

describe('orderMethods', () => {
  it('floats recommended methods to the front, preserving order otherwise', () => {
    const out = orderMethods([PAT, OAUTH, APP_OAUTH]);
    expect(out.map((m) => m.id)).toEqual(['browser_oauth_builtin', 'fine-grained-pat', 'oauth']);
  });
  it('tolerates a non-array', () => {
    expect(orderMethods(undefined)).toEqual([]);
  });
});

describe('computeHeroView', () => {
  it('promotes the recommended OAuth method as a one-click "Authorize with <Provider>" hero', () => {
    const v = computeHeroView([OAUTH, PAT, APP_OAUTH], GITHUB_SPEC);
    expect(v.hero.id).toBe('browser_oauth_builtin');
    expect(v.heroIsOAuth).toBe(true);
    expect(v.heroOneClick).toBe(true); // fields: [] → nothing to fill first
    expect(v.heroLabel).toBe('Authorize with GitHub');
    expect(v.heroHelper).toBe('Opens GitHub authorization in your browser — one click to wire.');
    // Everything else falls under "See other options".
    expect(v.rest.map((m) => m.id)).toEqual(['fine-grained-pat', 'oauth']);
  });

  it('does NOT one-click when the OAuth method has a required field (reveal fields first)', () => {
    const oauthWithField = { ...OAUTH, fields: [{ name: 'developer_token', required: true }] };
    const v = computeHeroView([oauthWithField, PAT], { label: 'Google Ads' });
    expect(v.heroIsOAuth).toBe(true);
    expect(v.heroOneClick).toBe(false);
    expect(v.heroLabel).toBe('Authorize with Google Ads');
  });

  it('promotes a non-OAuth recommended method with its own label (no "Authorize with", no one-click)', () => {
    const recommendedPat = { ...PAT, recommended: true };
    const v = computeHeroView([recommendedPat, APP_OAUTH], { label: 'GitHub' });
    expect(v.hero.id).toBe('fine-grained-pat');
    expect(v.heroIsOAuth).toBe(false);
    expect(v.heroOneClick).toBe(false);
    expect(v.heroLabel).toBe('Fine-grained personal access token');
    expect(v.heroHelper).toBe(PAT.description || '');
  });

  it('returns hero:null (flat card list) when no method is recommended', () => {
    const v = computeHeroView([PAT, APP_OAUTH], { label: 'GitHub' });
    expect(v.hero).toBeNull();
    expect(v.rest.map((m) => m.id)).toEqual(['fine-grained-pat', 'oauth']);
  });
});
