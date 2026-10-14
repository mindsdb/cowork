// Pure decision logic for the OAUTH_CONNECT IPC handler's extraFields
// (a connector's own non-OAuth required fields declared alongside
// browser_oauth_builtin, e.g. Google Ads' developer_token) — no fs, no
// network, no electron, so it can be unit-tested directly (same pattern as
// update-logic.ts). app.ts owns the I/O (fetching the connector spec) and
// delegates the filtering decision here.

/**
 * Restrict a caller-supplied extraFields payload to exactly the field names
 * a connector's own browser_oauth_builtin spec declares, dropping anything
 * else — mirrors cowork-server's own web-flow equivalent (OAuthStateStore.
 * set_pending's _RESERVED_VAULT_KEYS + falsy-value filter in
 * cowork/services/connectors/oauth/state.py), so the two entry points that
 * are supposed to behave the same way actually do.
 *
 * Without this, extraFields could be used to write an arbitrary key (e.g.
 * _picked_files) into a connection's stored values, since nothing else
 * restricts it to a connector's own declared fields.
 *
 * `raw` is untrusted IPC input, not a typed value — `typeof x === 'object'`
 * alone is true for arrays too, so that's checked separately rather than
 * trusted to fall out of the allow-list loop.
 */
export function filterExtraFields(
  raw: unknown,
  declaredFieldNames: readonly string[],
): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const allowed = new Set(declaredFieldNames);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    // Also excludes a non-string value (e.g. a future boolean-typed field)
    // rather than persisting it as-is — the declared shape is string-only.
    if (typeof value !== 'string' || !value) continue;
    result[key] = value;
  }
  return result;
}
