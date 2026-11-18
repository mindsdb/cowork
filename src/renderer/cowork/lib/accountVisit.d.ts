// Hand-written types for accountVisit.js, same pattern as consoleHandoff.d.ts.
// Only the members imported from TypeScript are declared.

/**
 * Record that the token's account opened Cowork web in this browser. The first
 * call per account decides `first_visit` for this document. Never throws.
 */
export function noteAccountVisit(accessToken?: string, storage?: Storage | null): void;
