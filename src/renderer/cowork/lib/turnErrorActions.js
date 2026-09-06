// Pure button-decision logic for turn-error cards, extracted from ChatView so
// the invariants are unit-testable without rendering.

// Managed MindsHub users can only retry; BYOK users are offered MindsHub setup for cross-provider
// failover.
// Route setup through Settings to handle existing subscribers. Treat missing reconnectable on old
// failures as unmanaged.
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
