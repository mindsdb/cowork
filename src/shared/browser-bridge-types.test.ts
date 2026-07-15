import { describe, it, expect } from 'vitest';
import {
  isReadonlyCdpMethod,
  registrableHost,
  toInternalResultCode,
  toServerBridgeState,
  FORBIDDEN_CDP_METHODS,
  READONLY_CDP_DOMAINS,
} from './browser-bridge-types';

// The read-only CDP guard is allowlist-based (WS review item 7): a method is
// permitted ONLY when its domain is one of the read-only domains AND it is not
// a forbidden method / write-input-cookie-storage verb. Anything outside the
// allowlisted domains is refused outright — a blocklist alone would let a new
// write surface through.
describe('isReadonlyCdpMethod (allowlist)', () => {
  it('allows the read-only primitives the bridge uses', () => {
    for (const m of [
      'Page.navigate',
      'Page.enable',
      'Runtime.enable',
      'Runtime.evaluate',
      'DOM.enable',
      'Accessibility.getFullAXTree',
    ]) {
      expect(isReadonlyCdpMethod(m), m).toBe(true);
    }
  });

  it('refuses any method outside the allowlisted domains (even a read-y name)', () => {
    // Network / Storage / Input / Target / Fetch etc. are NOT in the read-only
    // domain allowlist, so even an innocuous-looking getter is refused.
    for (const m of [
      'Network.getCookies',
      'Network.getResponseBody',
      'Storage.getCookies',
      'Input.dispatchMouseEvent',
      'Target.createTarget',
      'Fetch.enable',
      'Browser.getVersion',
    ]) {
      expect(isReadonlyCdpMethod(m), m).toBe(false);
    }
  });

  it('refuses write/input/cookie verbs even inside an allowlisted domain', () => {
    for (const m of [
      'Page.setBypassCSP',
      'Page.captureScreenshot',
      'Page.printToPDF',
      'DOM.setNodeValue',
      'DOM.removeNode',
      'Runtime.addBinding',
    ]) {
      expect(isReadonlyCdpMethod(m), m).toBe(false);
    }
  });

  it('refuses every explicitly forbidden method', () => {
    for (const m of FORBIDDEN_CDP_METHODS) {
      expect(isReadonlyCdpMethod(m), m).toBe(false);
    }
  });

  it('refuses malformed / empty input', () => {
    expect(isReadonlyCdpMethod('')).toBe(false);
    // @ts-expect-error — guard must tolerate non-string input at runtime.
    expect(isReadonlyCdpMethod(undefined)).toBe(false);
    expect(isReadonlyCdpMethod('NotADomain')).toBe(false);
  });

  it('every allowlisted domain is a real read-only domain', () => {
    expect([...READONLY_CDP_DOMAINS].sort()).toEqual(
      ['Accessibility', 'DOM', 'Page', 'Runtime'].sort(),
    );
  });
});

describe('registrableHost', () => {
  it('reduces a URL to its registrable host (www/subdomains collapse)', () => {
    // Subdomains of one registrable domain are the SAME grant: approving
    // shop.example.com scopes the whole example.com site (www included).
    expect(registrableHost('https://shop.example.com/a/b?x=1#y')).toBe('example.com');
    expect(registrableHost('https://www.example.com')).toBe('example.com');
    expect(registrableHost('https://example.com')).toBe('example.com');
    expect(registrableHost('http://a.b.c.example.co/x')).toBe('example.co');
  });

  it('isolates sites under a multi-label PUBLIC suffix (co.uk, …)', () => {
    // The old last-two-labels heuristic collapsed bank.co.uk and other.co.uk
    // to 'co.uk' — approving one would have granted the other. The PSL keeps
    // each registrable domain distinct.
    expect(registrableHost('https://bank.co.uk/login')).toBe('bank.co.uk');
    expect(registrableHost('https://other.co.uk/')).toBe('other.co.uk');
    expect(registrableHost('https://bank.co.uk')).not.toBe(registrableHost('https://other.co.uk'));
    expect(registrableHost('https://app.bank.co.uk')).toBe('bank.co.uk');
  });

  it('isolates sites under a PRIVATE suffix (github.io, …)', () => {
    // github.io is a private PSL entry: every *.github.io user site is an
    // unrelated origin, so foo and bar must be distinct grant values.
    expect(registrableHost('https://foo.github.io/docs')).toBe('foo.github.io');
    expect(registrableHost('https://bar.github.io/')).toBe('bar.github.io');
    expect(registrableHost('https://foo.github.io')).not.toBe(
      registrableHost('https://bar.github.io'),
    );
  });

  it('fails safe to the exact host when no registrable domain exists', () => {
    // IP literals, localhost, and single-label intranet hosts have no eTLD+1;
    // the grant then matches only that exact host.
    expect(registrableHost('http://192.168.0.1/x')).toBe('192.168.0.1');
    expect(registrableHost('http://localhost:3000/x')).toBe('localhost');
    expect(registrableHost('http://intranet/x')).toBe('intranet');
  });

  it('returns "" for unparseable input', () => {
    expect(registrableHost('not a url')).toBe('');
    expect(registrableHost('')).toBe('');
    expect(registrableHost('about:blank')).toBe('');
  });
});

// The wire boundary to cowork-server speaks the SERVER enums: result_code
// (internal codes) on /commands/{id}/result and underscore bridge states on
// /bridge/state. These mappers are the single place that translation lives.
describe('toInternalResultCode (server BridgeCommandResult enum)', () => {
  it('maps every external status onto a server-accepted internal code', () => {
    expect(toInternalResultCode('ok')).toBe('ok');
    expect(toInternalResultCode('permission_denied')).toBe('permission_denied');
    expect(toInternalResultCode('tab_closed')).toBe('target_lost');
    expect(toInternalResultCode('bridge_disconnected')).toBe('timeout');
    expect(toInternalResultCode('navigation_failed')).toBe('error');
    expect(toInternalResultCode('unsupported_action')).toBe('error');
  });
});

describe('toServerBridgeState (underscore enum)', () => {
  it('maps the hyphenated internal state to the server form', () => {
    expect(toServerBridgeState('awaiting-approval')).toBe('awaiting_approval');
    expect(toServerBridgeState('disconnected')).toBe('disconnected');
    expect(toServerBridgeState('connected')).toBe('connected');
    expect(toServerBridgeState('lost')).toBe('lost');
  });
});
