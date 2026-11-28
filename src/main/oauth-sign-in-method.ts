// Which of a connector's built-in sign-ins a desktop OAuth flow runs.
//
// A connector can declare two sign-ins under the same label, e.g. Slack's
// `mcp` and its REST `browser_oauth_builtin`, and the server hides the one
// that is switched off. A reconnect names the method its connection was made
// with; a new connection takes the one the server shows.

const SIGN_IN_METHOD_IDS = new Set(['browser_oauth_builtin', 'mcp']);

export interface SignInMethod {
  id?: string;
  hidden?: boolean;
  oauth?: Record<string, any>;
  fields?: Array<{ name?: unknown }>;
}

export function pickSignInMethod(methods: unknown, wanted?: string): SignInMethod | undefined {
  const signIns = (Array.isArray(methods) ? methods : []).filter(
    (m: any): m is SignInMethod => Boolean(m) && SIGN_IN_METHOD_IDS.has(m.id),
  );
  if (wanted) {
    const named = signIns.find((m) => m.id === wanted);
    if (named) return named;
  }
  return signIns.find((m) => !m.hidden) ?? signIns[0];
}
