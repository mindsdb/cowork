// Pure button-decision logic for turn-error cards, extracted from ChatView so
// the invariants are unit-testable without rendering.

// ProviderOverloadedCard (ENG-673): a transient provider incident that outlasted
// anton's retry budget. The MindsHub failover nudge is the ENG-514 guardrail's crux:
//   - managed user (already on MindsHub Cloud) → Retry ONLY (primary). Never
//     pitch MindsHub to someone already routed through it; there's nothing to
//     switch to when their whole managed set is down.
//   - BYOK/direct user → lead with "Set up MindsHub" as the PRIMARY action (the
//     ticket's emphasis: cross-provider failover is the durable fix for a
//     provider-wide incident), with Try again as the secondary. The button
//     routes to Settings — where connect/switch/subscribe are resolved for real
//     — deliberately NOT a raw "Subscribe", which would mis-nudge a subscriber
//     who chose BYOK.
// `reconnectable` is the "already on MindsHub Cloud" signal; a null/undefined
// value (e.g. an older persisted failure with no flag) is treated as NOT managed
// so the failover CTA still appears — never the reverse (which would wrongly
// suppress it for a BYOK user).
export function providerOverloadedButtons({ reconnectable, onRetry, onOpenSettings }) {
  const retry = { label: 'Try again', onClick: () => onRetry?.(), disabled: !onRetry };
  if (reconnectable) {
    // Managed: Retry is the only action, so it's primary.
    return [{ ...retry, primary: true }];
  }
  // BYOK/direct: MindsHub failover is primary, Retry secondary.
  return [
    { label: 'Set up MindsHub', onClick: () => onOpenSettings?.('agent'), primary: true },
    retry,
  ];
}
