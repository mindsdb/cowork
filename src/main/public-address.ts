/*
 * Which addresses the main process may connect to for a server the user typed
 * in (a custom MCP server and its login endpoints). Only addresses on the
 * public internet pass: private, loopback, link-local, shared (CGNAT),
 * multicast, reserved, documentation and translation ranges are refused.
 *
 * The same rule as anton's `is_public_destination` (anton/core/mcp/egress.py),
 * which the server applies to the same servers. Both are tested against one
 * list of addresses (`__fixtures__/public-address-cases.json`).
 */

import { BlockList, isIP } from 'node:net';

// Two lists, not one: a BlockList also matches an IPv4 address against IPv6
// ranges through its ::ffff: form, which ::/8 below would refuse.
const REFUSED_V4 = new BlockList();
const REFUSED_V6 = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  REFUSED_V4.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  // ::/8 covers ::, ::1, IPv4-compatible and NAT64 (64:ff9b::/96) addresses.
  ['::', 8],
  ['100::', 64],
  // Teredo and the other IETF protocol assignments.
  ['2001::', 23],
  ['2001:db8::', 32],
  // 6to4 carries an IPv4 address the host could be steered to.
  ['2002::', 16],
  // Documentation (RFC 9637) and segment routing SIDs (RFC 9602).
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  REFUSED_V6.addSubnet(network, prefix, 'ipv6');
}

/** Whether `address`, an IP address in any form `URL` or a resolver gives,
 *  is on the public internet. Anything that is not an IP address is not. */
export function isPublicAddress(address: string): boolean {
  const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const v4 = mappedIpv4(bare);
  if (v4 !== null) return isPublicAddress(v4);
  const family = isIP(bare);
  if (family === 4) return !REFUSED_V4.check(bare, 'ipv4');
  if (family === 6) return !REFUSED_V6.check(bare, 'ipv6');
  return false;
}

/** Whether `hostname` (as `URL` renders it) is an IP literal rather than a name. */
export function isIpLiteralHost(hostname: string): boolean {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return isIP(bare) !== 0;
}

/* The IPv4 address inside an IPv4-mapped IPv6 address (::ffff:a.b.c.d or the
   hex form ::ffff:xxxx:yyyy that `URL` writes), else null. Judged as IPv4 so
   a refused address cannot pass by changing its spelling. */
function mappedIpv4(address: string): string | null {
  const host = address.toLowerCase();
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}
