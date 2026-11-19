import { describe, it, expect } from 'vitest';
import cases from './__fixtures__/public-address-cases.json';
import { isIpLiteralHost, isPublicAddress } from './public-address';

describe('isPublicAddress', () => {
  it.each(cases.refused)('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(cases.public)('accepts %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each(['[::1]', '[::ffff:7f00:1]', '[fd00:ec2::254]'])('refuses the bracketed form %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('judges the hex IPv4-mapped form URL writes as its IPv4 address', () => {
    expect(new URL('https://[::ffff:169.254.169.254]/').hostname).toBe('[::ffff:a9fe:a9fe]');
    expect(isPublicAddress('[::ffff:a9fe:a9fe]')).toBe(false);
    expect(isPublicAddress('::ffff:5db8:d70e')).toBe(true);
  });

  it.each(['mcp.example.com', '', 'not an address'])('refuses %j, which is not an address', (value) => {
    expect(isPublicAddress(value)).toBe(false);
  });
});

describe('isIpLiteralHost', () => {
  it.each([
    ['https://127.0.0.1/', true],
    ['https://2130706433/', true],
    ['https://0x7f.1/', true],
    ['https://[::1]/', true],
    ['https://mcp.example.com/', false],
  ])('%s -> %s', (url, expected) => {
    expect(isIpLiteralHost(new URL(url).hostname)).toBe(expected);
  });
});
