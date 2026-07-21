// Post-auth credential handshake decision, extracted as a pure-ish unit so the
// exhausted-model-replay transition is testable without rendering <App/>
// (ENG-922, #455 review).
//
// Runs after login/install: push .env credentials into the server DB, then
// replay any deferred onboarding model (see App.deferredModelRef). The model
// replay is load-bearing — a dropped model write is NOT self-healing (model
// keys are excluded from both the bulk .env re-sync (ENG-739) and the backend's
// startup migration), so if it can't be persisted we surface a retryable error
// instead of silently entering the app config-not-ready.

export interface PostAuthDeps {
  /** Read the local .env settings (IPC on desktop). */
  readSettings: () => Promise<Record<string, string>>;
  /** Bulk .env → DB sync (provider/keys/etc; excludes model keys, ENG-739). */
  syncSettingsToDb: (lines: string[]) => Promise<boolean>;
  /** Model replay WITH retry/backoff — returns whether the model persisted (2xx). */
  replayModels: (lines: string[]) => Promise<boolean>;
  /** Deferred onboarding model lines to replay, or null when nothing is owed. */
  deferredModelLines: string[] | null;
}

export interface PostAuthResult {
  /** Page to route to next. */
  next: 'terminal' | 'setupError';
  /** Whether the deferred payload can be dropped (persisted, or nothing owed). */
  clearDeferred: boolean;
}

export async function runPostAuthHandshake(deps: PostAuthDeps): Promise<PostAuthResult> {
  try {
    const saved = await deps.readSettings();
    if (saved && typeof saved === 'object') {
      const lines = Object.entries(saved).map(([k, v]) => `${k}=${v}`);
      await deps.syncSettingsToDb(lines);
    }
    const models = deps.deferredModelLines;
    if (models && models.length) {
      if (!(await deps.replayModels(models))) {
        // Couldn't persist the model even after retries — keep the payload and
        // route to a retryable error rather than strand the install
        // config-not-ready (#455 review).
        return { next: 'setupError', clearDeferred: false };
      }
    }
    return { next: 'terminal', clearDeferred: true };
  } catch {
    // Read / bulk sync threw (server unreachable / IPC error). If a model replay
    // was owed, surface the retryable error so the owed model isn't silently
    // lost — symmetric with the replay-returned-false case above. Otherwise fall
    // through to terminal (provider/keys reconcile from .env on next restart,
    // the existing best-effort contract).
    if (deps.deferredModelLines && deps.deferredModelLines.length) {
      return { next: 'setupError', clearDeferred: false };
    }
    return { next: 'terminal', clearDeferred: false };
  }
}
