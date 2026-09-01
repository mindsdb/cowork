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
 * The requests that put LLM work on the wire and therefore need the Minds
 * credential settled first.
 *
 * `/responses` starts a turn. `/responses/answer` releases a turn parked on an
 * elicitation card, whose next model call runs on whatever credential the
 * sidecar holds — a sleep shorter than the elicitation timeout but longer than
 * the access token's life lands exactly there. Reads, cancels and the SSE tail
 * are deliberately absent: none of them spends the credential, and gating the
 * cancel would make Stop unusable while the barrier is up.
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
 * Start the asynchronous resume gate when this is a response-creation request.
 * Returns false for every other loopback request so the caller can forward it
 * synchronously and untouched.
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
