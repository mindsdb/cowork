// Hand-written types for customMcpWebConnect.js, same pattern as consoleHandoff.d.ts.
// Only the members imported from TypeScript are declared.

export type CustomMcpWebFailure = { ok: false; code: string; reason: string };
export type CustomMcpWebAnswer = { ok: true; data: any } | CustomMcpWebFailure;

export interface CustomMcpSignIn {
  popup: Window | null;
  cancelled: boolean;
  whenCancelled: Promise<CustomMcpWebFailure>;
}

export const CUSTOM_MCP_LISTING_TIMEOUT_MS: number;
export const CUSTOM_MCP_REQUEST_TIMEOUT_MS: number;
export const CUSTOM_MCP_RELAY_TIMEOUT_MS: number;

export function beginCustomMcpSignIn(win?: Window): CustomMcpSignIn;
export function cancelCustomMcpSignIn(): void;
export function endCustomMcpSignIn(signIn: CustomMcpSignIn | null): void;
export function openLoginPage(signIn: CustomMcpSignIn, authUrl: unknown): { ok: true } | CustomMcpWebFailure;
export function unlessCancelled<T>(signIn: CustomMcpSignIn | null, request: Promise<T>): Promise<T | CustomMcpWebFailure>;
export function pollCustomMcpSignIn(
  signIn: CustomMcpSignIn,
  readStatus: () => Promise<CustomMcpWebAnswer>,
): Promise<CustomMcpWebAnswer>;
export function customMcpFailure(status: number, body: unknown): CustomMcpWebFailure;
export function connectedFrom(
  data: any,
  name: string,
): { ok: true; id: string; label: string; serverUrl: string; toolsOn: number; toolsUnavailable: boolean };
export function toolsFrom(data: any): {
  ok: true;
  tools: Array<{ name: string; description: string; readOnly: boolean; allowed: boolean; usable: boolean; reason: string | null }>;
  revision: number | null;
  stale?: boolean;
  staleCode?: string;
};
