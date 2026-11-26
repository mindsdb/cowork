// Hand-written declarations for release-fuses.mjs so its tests typecheck
// under `npm run typecheck:test`.
import type { FuseConfig, FuseV1Options } from '@electron/fuses';
import type { FuseState } from '@electron/fuses/dist/constants';

/* Expected fuse values keyed by their FuseV1Options index. */
export type FuseExpectation = Readonly<Partial<Record<FuseV1Options, boolean>>>;

/* A fuse wire as getCurrentFuseWire reads it. */
export type FuseWire = FuseConfig<FuseState>;

export declare const RELEASE_FUSES: FuseExpectation;
export declare const INSPECTABLE_FUSES: FuseExpectation;
export declare function fuseStates(wire: FuseWire): Record<string, string>;
export declare function fuseMismatches(wire: FuseWire, expected?: FuseExpectation): string[];
export declare function readFuseWires(app: string): Promise<Record<string, FuseWire>>;
export declare function checkFuses(app: string, expected?: FuseExpectation): Promise<{
  states: Record<string, Record<string, string>>;
  mismatches: string[];
}>;
/* Resolves to the number of fuse wires flipped. */
export declare function enableInspector(app: string): Promise<number>;
