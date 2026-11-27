// Hand-written declarations for sign-ui-bundle.mjs so the desktop verifier's
// cross-check tests typecheck under `npm run typecheck:test`. Only the names
// the tests import are declared.
export interface SignOptions {
  dir: string;
  version: string;
  minServerVersion: string | null | undefined;
  outDir: string;
  privateKeyPem: string;
  expectedPublicKey: string | null;
}

export interface SignedLatest {
  signed: string;
  signature: string;
}

export interface SignResult {
  manifest: {
    kind: 'cowork-ui-bundle';
    schema: 1;
    version: string;
    minServerVersion: string | null;
    files: Record<string, string>;
  };
  latest: {
    kind: 'cowork-ui-latest';
    schema: 1;
    version: string;
    sha256: string;
    minServerVersion: string | null;
  };
  signedLatest: SignedLatest;
}

export declare const TARBALL_NAME: 'ui-bundle.tar.gz';
export declare const SIGNATURE_JSON_NAME: 'ui-signature.json';
export declare function signUiBundle(options: SignOptions): SignResult;
export declare function readReleasePublicKey(source: string): string;
