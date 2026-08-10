// Classifies the legacy per-user web host shape: `cw-<id>` as the first label.
// Live zones are `cw-<id>.4nton.ai` (prod) and `cw-<id>.<env>.mindshub.ai`
// (staging / the four dev envs).
//
// These hosts predate the k8s multitenant deployment. Their first label is an
// opaque per-user token `cw-<id>` (e.g. cw-e075837b), and access to them is
// gated upstream by the **Cloudflare Worker's `instance_session` cookie** —
// not by the SPA's own Keycloak login. They were never registered as Keycloak
// redirect URIs and Keycloak (26.5) cannot subdomain-wildcard a dynamic
// per-user host, so web-main.tsx skips the Keycloak wrapper on them during the
// SaaS transition (see the note there). Canonical hosts (cowork.<env>,
// cowork-<pr>.<env>) and localhost dev are NOT legacy and still require a
// Keycloak login.
//
// NOTE — the predicate is deliberately zone-agnostic, which makes it broader
// than the gate it relies on. Worker routes exist for `*.4nton.ai`,
// `*.staging.mindshub.ai` and `*.dev.mindshub.ai` only; there is no
// `*.mindshub.ai` route (that apex goes straight to the k8s nginx-ingress), so
// a `cw-<id>.mindshub.ai` host would take this bypass with no Worker gate
// behind it. That combination is unreachable today — the apex returns
// ingress `default backend - 404`, and with no login there is no bearer token
// for the cowork-server ingress auth subrequest either, so it fails closed.
// Kept zone-agnostic on purpose: an allowlist here would have to mirror the
// Cloudflare routes in the terraform repo, and a zone added there without a
// matching edit here would silently reintroduce the very redirect_uri
// dead-end this module exists to prevent. Tracked on ENG-1281, which owns the
// durable fix (one registered callback + a domain-wide session cookie).
//
// `cowork` does not start with `cw-` (index 1 is 'o', not 'w'), so canonical
// hosts are safely excluded.
export function isLegacyTenantHost(hostname: string): boolean {
  return hostname.startsWith('cw-');
}
