// Hand-written declarations for release-app-check.mjs so its TypeScript
// importers typecheck under `npm run typecheck:test`.
import type { checkFuses } from './release-fuses.mjs';

/* Entitlements a release must not hold; defined in macos-setup-contract.mjs. */
export declare const FORBIDDEN_ENTITLEMENTS: readonly string[];
export declare function printEntitlements(code: string): Promise<string>;
export declare function signedCode(bundle: string): Promise<string[]>;
export declare function heldEntitlements(bundle: string, print?: (code: string) => Promise<string>): Promise<string[]>;
export declare function checkReleaseApp(app: string): Promise<{
  fuses: Awaited<ReturnType<typeof checkFuses>>;
  problems: string[];
}>;
/* Resolves to the exit status. */
export declare function main(argv: string[]): Promise<number>;
