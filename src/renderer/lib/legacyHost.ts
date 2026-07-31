// Classifies the legacy per-user web host shape (cw-<id>.<env>.mindshub.ai).
//
// These hosts predate the k8s multitenant deployment. Their first label is an
// opaque per-user token `cw-<id>` (e.g. cw-e075837b), and access to them is
// gated upstream (Worker / ingress) rather than by the SPA's own Keycloak
// login. They were never registered as Keycloak redirect URIs and Keycloak
// (26.5) cannot subdomain-wildcard a dynamic per-user host, so web-main.tsx
// skips the Keycloak wrapper on them during the SaaS transition (see the note
// there). Canonical hosts (cowork.<env>, cowork-<pr>.<env>) and localhost dev
// are NOT legacy and still require a Keycloak login.
//
// `cowork` does not start with `cw-` (index 1 is 'o', not 'w'), so canonical
// hosts are safely excluded.
export function isLegacyTenantHost(hostname: string): boolean {
  return hostname.startsWith('cw-');
}
