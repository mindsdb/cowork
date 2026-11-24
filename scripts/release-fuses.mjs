import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const { flipFuses, getCurrentFuseWire, FuseV1Options, FuseVersion } = require('@electron/fuses'); // dep of electron-builder
const { FuseState } = require('@electron/fuses/dist/constants.js'); // the package index does not re-export the states
const execute = promisify(execFile);

/* The fuses every release build sets, keyed by their place in the fuse wire.
   Fuses not named here keep Electron's default. */
export const RELEASE_FUSES = Object.freeze({
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
});

/* The setup smokes' copy of a release app. Playwright attaches through Node's
   inspector, so the copy differs from the release in that fuse alone. */
export const INSPECTABLE_FUSES = Object.freeze({ ...RELEASE_FUSES, [FuseV1Options.EnableNodeCliInspectArguments]: true });

const STATES = Object.freeze({ [FuseState.ENABLE]: 'on', [FuseState.DISABLE]: 'off', [FuseState.REMOVED]: 'removed' });

function stateName(value) {
  return value === undefined ? 'missing' : STATES[value] ?? `unknown (${value})`;
}

/* Each fuse in a wire read by getCurrentFuseWire, by name, with its state. */
export function fuseStates(wire) {
  return Object.fromEntries(Object.entries(wire).filter(([key]) => key !== 'version').map(([index, value]) => [FuseV1Options[index] ?? `fuse ${index}`, stateName(value)]));
}

/* The fuses in a wire read by getCurrentFuseWire that differ from `expected`,
   one line each, naming the fuse. A fuse the wire is too short to hold differs,
   and a wire of another version differs as a whole. */
export function fuseMismatches(wire, expected = RELEASE_FUSES) {
  if (wire?.version !== FuseVersion.V1) return [`fuse wire version ${wire?.version ?? 'missing'} is not ${FuseVersion.V1}`];
  return Object.entries(expected).flatMap(([index, enabled]) => {
    const want = enabled ? FuseState.ENABLE : FuseState.DISABLE;
    return wire[index] === want ? [] : [`${FuseV1Options[index]} is ${stateName(wire[index])}, expected ${STATES[want]}`];
  });
}

/* Reads the fuse wires of a release app: a .app bundle on macOS, the executable
   elsewhere. getCurrentFuseWire reads the first wire in a file, and a universal
   macOS framework holds one per architecture, so lipo writes each slice out to
   be read on its own. Returns the wires keyed by architecture, or by file name
   for a file outside a bundle. */
export async function readFuseWires(app) {
  if (!app.endsWith('.app')) return { [basename(app)]: await getCurrentFuseWire(app) };
  const framework = join(app, 'Contents/Frameworks/Electron Framework.framework/Electron Framework');
  const archs = (await execute('/usr/bin/lipo', ['-archs', framework])).stdout.trim().split(/\s+/);
  /* getCurrentFuseWire reads a path that holds `.app` but doesn't end in it as
     the app's main executable, and looks for the framework two folders up, so
     a single-arch app is read through its bundle path. */
  if (archs.length === 1) return { [archs[0]]: await getCurrentFuseWire(app) };
  const folder = await mkdtemp(join(tmpdir(), 'cowork-fuses-'));
  try {
    const wires = {};
    for (const arch of archs) {
      const slice = join(folder, arch);
      await execute('/usr/bin/lipo', [framework, '-thin', arch, '-output', slice]);
      wires[arch] = await getCurrentFuseWire(slice);
    }
    return wires;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/* Reads a release app's fuses and compares every wire in it with `expected`. */
export async function checkFuses(app, expected = RELEASE_FUSES) {
  const wires = Object.entries(await readFuseWires(app));
  return {
    states: Object.fromEntries(wires.map(([slice, wire]) => [slice, fuseStates(wire)])),
    mismatches: wires.flatMap(([slice, wire]) => fuseMismatches(wire, expected).map((line) => `${slice}: ${line}`)),
  };
}

/* Turns Node's inspector arguments on in a copy of a release app, in every
   architecture, and leaves every other fuse as shipped. The change breaks the
   copy's signature; on macOS the caller signs the copy again. */
export function enableInspector(app) {
  return flipFuses(app, { version: FuseVersion.V1, [FuseV1Options.EnableNodeCliInspectArguments]: true });
}
