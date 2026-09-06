// Legacy cw-<id> hosts bypass SPA Keycloak login and rely on the upstream Worker's instance_session
// gate; dynamic per-user origins are not registered redirect URIs. Canonical cowork hosts and
// localhost still require login.
// This predicate is deliberately zone-agnostic and broader than Worker routing: deployment must not
// expose a matching host without upstream authentication. Mirroring a zone allowlist here would
// drift from Terraform; ENG-1281 tracks a shared callback/session replacement.
export function isLegacyTenantHost(hostname: string): boolean {
  return hostname.startsWith('cw-');
}
