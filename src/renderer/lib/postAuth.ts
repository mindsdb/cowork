// Sync settings, then replay any deferred onboarding model. Model writes are excluded from bulk
// sync and startup migration, so failed replay must remain retryable.

export interface PostAuthDeps {
  /** Read the local .env settings (IPC on desktop). */
  readSettings: () => Promise<Record<string, string>>;
  /** Bulk .env → DB sync (provider/keys/etc; excludes model keys, ENG-739). */
  syncSettingsToDb: (lines: string[]) => Promise<boolean>;
  /** Model replay with retry/backoff; true also includes permanent 400/422 refusal. */
  replayModels: (lines: string[]) => Promise<boolean>;
  /** Deferred onboarding model lines to replay, or null when nothing is owed. */
  deferredModelLines: string[] | null;
}

export interface PostAuthResult {
  /** Page to route to next. */
  next: 'terminal' | 'setupError';
  /** Drop the payload only when replay was handled or nothing was owed. */
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
        // Retain the model payload; bulk sync cannot repair a lost model write.
        return { next: 'setupError', clearDeferred: false };
      }
    }
    return { next: 'terminal', clearDeferred: true };
  } catch {
    // An owed model keeps this failure retryable. Without one, preserve best-effort entry; settings
    // can reconcile on restart.
    if (deps.deferredModelLines && deps.deferredModelLines.length) {
      return { next: 'setupError', clearDeferred: false };
    }
    return { next: 'terminal', clearDeferred: false };
  }
}
