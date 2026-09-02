// Hand-written declarations for resolve-server-channel.mjs so the contract
// test in src/main/server-source.test.ts can import it under `npm run typecheck:test`.
export declare function resolveServerChannel(input?: {
  channel?: string;
  ref?: string;
  buildKind?: string;
}): 'git' | 'pypi';
