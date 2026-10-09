import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { channelIdentity } from '../../scripts/channel-identity.mjs';

// Regression guard: the app icon rendered as pixel noise at small sizes on
// macOS (Spotlight, Finder list view) for every channel.
//
// The mac build was handed a PNG, and electron-builder's PNG → .icns
// conversion stores the 16/32/64px sizes as icp4/icp5/icp6 entries holding PNG
// data, which IconServices draws as garbage. The fix points the mac build at
// .icns files made by iconutil (scripts/generate-mac-icons.sh), which stores
// the small sizes as ic04/ic05 like Apple's own icons. This asserts the config
// still names an .icns, and that each file still has that layout.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = path.join(REPO, 'assets');

/** The four-character entry types in an .icns file, in file order. */
function icnsEntryTypes(file: string): string[] {
  const data = readFileSync(file);
  expect(data.subarray(0, 4).toString('latin1')).toBe('icns');
  const types: string[] = [];
  for (let i = 8; i < data.length; ) {
    const length = data.readUInt32BE(i + 4);
    if (length < 8) throw new Error(`corrupt .icns entry at byte ${i} in ${file}`);
    types.push(data.subarray(i, i + 4).toString('latin1'));
    i += length;
  }
  return types;
}

/** `mac.icon` from electron-builder.yml (the prod icon). */
function ymlMacIcon(): string {
  const yml = readFileSync(path.join(REPO, 'electron-builder.yml'), 'utf8');
  const match = yml.match(/^mac:\n(?:[ \t].*\n|\n)*?[ \t]+icon:[ \t]*(\S+)/m);
  if (!match) throw new Error('mac.icon not found in electron-builder.yml');
  return match[1];
}

const MAC_ICONS: Array<[string, string]> = [
  ['prod (electron-builder.yml)', ymlMacIcon()],
  ['stable', channelIdentity('stable')!.macIcon],
  ['preview', channelIdentity('preview')!.macIcon],
];

describe('macOS app icons', () => {
  it.each(MAC_ICONS)('%s names an .icns file that exists in assets/', (_kind, icon) => {
    expect(icon).toMatch(/\.icns$/);
    expect(existsSync(path.join(ASSETS, icon))).toBe(true);
  });

  it.each(MAC_ICONS)('%s stores its small sizes the way iconutil does', (_kind, icon) => {
    const types = icnsEntryTypes(path.join(ASSETS, icon));
    expect(types).toEqual(expect.arrayContaining(['ic04', 'ic05', 'ic11']));
    expect(types).not.toContain('icp4');
    expect(types).not.toContain('icp5');
    expect(types).not.toContain('icp6');
  });
});
