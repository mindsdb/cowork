import { describe, expect, it } from 'vitest';
import { routesThroughProxy } from './loopback-proxy';

describe('routesThroughProxy', () => {
  it('passes a direct route, in any case and with whitespace around it', () => {
    expect(routesThroughProxy('DIRECT')).toBe(false);
    expect(routesThroughProxy('direct')).toBe(false);
    expect(routesThroughProxy('  Direct ; ')).toBe(false);
    expect(routesThroughProxy('DIRECT;DIRECT')).toBe(false);
  });

  it('refuses a proxy of any kind', () => {
    expect(routesThroughProxy('PROXY proxy.corp:8080')).toBe(true);
    expect(routesThroughProxy('HTTPS proxy.corp:443')).toBe(true);
    expect(routesThroughProxy('SOCKS5 127.0.0.1:1080')).toBe(true);
    expect(routesThroughProxy('SOCKS 127.0.0.1:1080')).toBe(true);
    expect(routesThroughProxy('socks5 127.0.0.1:1080')).toBe(true);
  });

  it('refuses a list that tries a proxy before or after the direct route', () => {
    expect(routesThroughProxy('PROXY a:1;DIRECT')).toBe(true);
    expect(routesThroughProxy('PROXY a:1; DIRECT')).toBe(true);
    expect(routesThroughProxy('DIRECT; PROXY a:1')).toBe(true);
  });

  it('refuses an answer that names no route', () => {
    expect(routesThroughProxy('')).toBe(true);
    expect(routesThroughProxy(' ; ')).toBe(true);
  });
});
