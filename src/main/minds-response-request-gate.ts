import { MINDS_RESUME_READY_TIMEOUT_MS } from './minds-resume-gate';

interface LoopbackRequestDetails {
  method: string;
  url: string;
}

/** Read the server's exact health-contract field without coercing unknown data. */
export function mindsRuntimeCredentialRequirementFromHealth(data: unknown): boolean | null {
  if (!data || typeof data !== 'object') return null;
  const required = (data as Record<string, unknown>).minds_runtime_credential_required;
  return typeof required === 'boolean' ? required : null;
}

/**
 * Gate response creation and elicitation answers, which can spend a stale credential after wake.
 * Do not gate reads, cancels or SSE tails; Stop must remain usable.
 * Connector probes are retryable and outside the renderer’s response reservation/reap deadline.
 */
const GATED_RESPONSE_PATHS = new Set([
  '/api/v1/responses',
  '/api/v1/responses/answer',
]);

export function isMindsResponseCreationRequest(
  details: LoopbackRequestDetails,
  serverPort: number,
): boolean {
  if (details.method.toUpperCase() !== 'POST') return false;
  try {
    const url = new URL(details.url);
    const path = url.pathname.replace(/\/$/, '');
    return url.port === String(serverPort) && GATED_RESPONSE_PATHS.has(path);
  } catch {
    return false;
  }
}

/**
 * Gate response requests asynchronously; return false to forward other loopback requests
 * immediately.
 */
export function gateMindsResponseCreationRequest(
  details: LoopbackRequestDetails,
  serverPort: number,
  gateActive: boolean,
  runtimeCredentialRequired: () => Promise<boolean | null>,
  waitUntilReady: (timeoutMs?: number) => Promise<boolean>,
  forward: (ready: boolean) => void,
): boolean {
  if (!gateActive || !isMindsResponseCreationRequest(details, serverPort)) return false;
  const deadline = Date.now() + MINDS_RESUME_READY_TIMEOUT_MS;
  const decision = (async () => {
    try {
      if (await runtimeCredentialRequired() === false) return true;
    } catch {
      // An older or unreachable sidecar cannot prove that required roles are
      // independent of the runtime JWT, so probe failures stay fail-closed.
    }
    try {
      const remainingMs = deadline - Date.now();
      return remainingMs > 0 ? await waitUntilReady(remainingMs) : false;
    } catch {
      return false;
    }
  })();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const bounded = Promise.race([
    decision,
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), MINDS_RESUME_READY_TIMEOUT_MS);
    }),
  ]);
  void bounded.then(
    (ready) => {
      if (timeout) clearTimeout(timeout);
      forward(ready);
    },
    () => {
      if (timeout) clearTimeout(timeout);
      forward(false);
    },
  );
  return true;
}
