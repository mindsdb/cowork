import { useState, useEffect, useMemo, useRef } from 'react';
import { host } from '../../platform/host';
import { type MindsOrg, needsOrgPick, organizationLabel, rankMindsOrgs } from '../../../shared/minds-orgs';
import { BASE, authFetch, fetchRecommendedModels } from '../../cowork/api';
import { recommendedModelOptions, type ProviderModel } from '../../cowork/lib/settingsTransform';
import { trackKeyProvisioningRefused } from '../../cowork/lib/analytics';
import { MINDS_API_BASE, MINDS_REGISTER_URL } from '../../lib/mindsUrls';
import { syncSettingsToDb, syncModelsToDb, modelLinesFrom } from '../../lib/syncSettings';
import { ArcadeShell, PixelMarquee } from './components';
import { PixelSprite, type SpriteName } from './sprites';
import { LegalViewer } from './TermsScreen';

type Provider = 'minds' | 'byok';
type ByokProvider = 'anthropic' | 'openai' | 'gemini' | 'openai-compatible';
// signup-wait may last through email verification; timeout becomes signup-verify, an informational
// sign-in prompt.
type Phase = 'choose' | 'validating' | 'pick-org' | 'signup-wait' | 'signup-verify' | 'minds-no-llm' | 'success' | 'error';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

const CUSTOM_MODEL = '__custom__';

/** Persist the cartridge choice as the `harness` setting (best-effort). */
async function syncHarness(harnessId: string): Promise<void> {
  try {
    await authFetch(`${BASE}/settings/harness`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: harnessId }),
    });
  } catch {}
}

// Use syncModelsToDb for model writes so onboarding and post-install replay share the permitted
// non-picker path.

export interface PersistDeps {
  /** .env write — best-effort in web (loopback-gated, ENG-817), throws on a real error. */
  saveSettings: (content: string) => Promise<boolean>;
  /** Authoritative DB write (PUT /settings/:key). Returns false if any key failed. */
  syncToDb: (lines: string[]) => Promise<boolean>;
  /** Model sync is best-effort after the authoritative config write. */
  syncModels: (lines: string[]) => Promise<unknown>;
  syncHarness: () => Promise<void>;
}

export type PersistResult =
  | { ok: true }
  // Distinguish a rejected/unreachable DB write from a thrown .env/IPC failure for
  // resolveFinalizeOutcome.
  | { ok: false; error: string; dbSyncFailed?: true };

// The DB write is authoritative; best-effort .env persistence alone must never advance onboarding
// to success.
export async function persistOnboarding(
  deps: PersistDeps,
  lines: string[],
): Promise<PersistResult> {
  const GENERIC = 'Could not save your settings. Please try again.';
  try {
    await deps.saveSettings(lines.join('\n'));
    const dbOk = await deps.syncToDb(lines);
    if (!dbOk) {
      return {
        ok: false,
        error: 'Could not save your settings to the server. Please try again.',
        dbSyncFailed: true,
      };
    }
    // Model and harness writes are best-effort after config persists; failure in one must not skip
    // the other.
    // Log failures because omitted model writes do not self-heal through bulk sync or startup
    // migration.
    try {
      await deps.syncModels(lines);
    } catch (e) {
      console.error('[onboarding] best-effort model sync failed', e);
    }
    try {
      await deps.syncHarness();
    } catch (e) {
      console.error('[onboarding] best-effort harness sync failed', e);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : GENERIC };
  }
}

export type FinalizeOutcome =
  | { action: 'success' }
  | { action: 'defer' }
  | { action: 'error'; error: string };

// Defer DB failure only while install/startup is incomplete; onComplete routes to setup and retries
// after install.
// A ready-server DB refusal or .env/IPC error must remain user-visible.
export function resolveFinalizeOutcome(
  res: PersistResult,
  installStatus: { antonInstalled: boolean; serverDepsReady: boolean } | null,
): FinalizeOutcome {
  if (res.ok) return { action: 'success' };
  const notReady = Boolean(installStatus) && (!installStatus!.antonInstalled || !installStatus!.serverDepsReady);
  if (res.dbSyncFailed && notReady) return { action: 'defer' };
  return { action: 'error', error: res.error };
}

function resolveValidationTarget(
  bp: ByokProvider,
  customBaseUrl: string,
): { provider: string; baseUrl: string | undefined } {
  const provider = bp === 'anthropic' ? 'anthropic' : 'openai-compatible';
  const baseUrl =
    bp === 'openai' ? 'https://api.openai.com/v1'
    : bp === 'gemini' ? GEMINI_BASE_URL
    : bp === 'openai-compatible' ? customBaseUrl.trim()
    : undefined;
  return { provider, baseUrl };
}

function buildProviderEnv(
  bp: ByokProvider,
  key: string,
  customBaseUrl: string,
  model: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (bp === 'anthropic') {
    env.ANTON_ANTHROPIC_API_KEY = key;
    env.ANTON_PLANNING_PROVIDER = 'anthropic';
    env.ANTON_CODING_PROVIDER = 'anthropic';
  } else if (bp === 'gemini') {
    env.ANTON_OPENAI_API_KEY = key;
    env.ANTON_OPENAI_BASE_URL = GEMINI_BASE_URL;
    env.ANTON_PLANNING_PROVIDER = 'openai-compatible';
    env.ANTON_CODING_PROVIDER = 'openai-compatible';
  } else if (bp === 'openai-compatible') {
    env.ANTON_OPENAI_API_KEY = key || 'not-needed';
    env.ANTON_OPENAI_BASE_URL = customBaseUrl.trim();
    env.ANTON_PLANNING_PROVIDER = 'openai-compatible';
    env.ANTON_CODING_PROVIDER = 'openai-compatible';
  } else {
    env.ANTON_OPENAI_API_KEY = key;
    env.ANTON_OPENAI_BASE_URL = 'https://api.openai.com/v1';
    env.ANTON_PLANNING_PROVIDER = 'openai-compatible';
    env.ANTON_CODING_PROVIDER = 'openai-compatible';
  }
  env.ANTON_PLANNING_MODEL = model;
  env.ANTON_CODING_MODEL = model;
  return env;
}

export default function OnboardingScreen({
  coworker,
  onComplete,
  onBack,
}: {
  /** Cartridge chosen on the select screen; persisted with the settings. */
  coworker: { id: string; label: string; sprite: SpriteName };
  /**
   * On setup deferral, pass the chosen ANTON_*_MODEL lines to onComplete for one post-install
   * replay.
   */
  onComplete: (deferredModelLines?: string[]) => void;
  /** Optional — returns to the coworker-select screen. */
  onBack?: () => void;
}) {
  const [provider, setProvider] = useState<Provider>('minds');
  const [byokProvider, setByokProvider] = useState<ByokProvider>('anthropic');
  const [selectedModel, setSelectedModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [mindsUrl] = useState(MINDS_API_BASE);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('choose');
  const [errorMsg, setErrorMsg] = useState('');
  const [skippedMinds, setSkippedMinds] = useState(false);
  // Track layout separately from phase so validating renders in the correct stage.
  const [step, setStep] = useState<'minds' | 'byok'>('minds');
  // Latch finalization so provider toggles cannot make the web auto-finalize effect save and
  // complete twice.
  const finalizedRef = useRef(false);
  const [legalDoc, setLegalDoc] = useState<'terms' | 'privacy' | null>(null);
  // Ask for an organization only when there are multiple company choices; an empty list means no
  // question.
  const [orgChoices, setOrgChoices] = useState<MindsOrg[]>([]);
  const [pickedOrgId, setPickedOrgId] = useState('');
  // The organization finalized by main, which entitlement fallback may change.
  const [mintedOrg, setMintedOrg] = useState<MindsOrg | null>(null);

  // Hosted config_ready deployments already have an unreadable server-held key; offer consent-only
  // entry.
  // null means the health check is pending; Electron follows SSO instead.
  const [webConfigured, setWebConfigured] = useState<boolean | null>(host.isWeb ? null : false);
  // Use state for Keycloak auto-finalization so boot routing re-renders; a ref alone can flash the
  // form.
  // Org deployments do not use this path.
  const [autoFinalizing, setAutoFinalizing] = useState(false);
  // Org deployments own provider config on the server; null means the check is pending.
  const [orgMode, setOrgMode] = useState<boolean | null>(host.isWeb ? null : false);
  useEffect(() => {
    if (!host.isWeb) return;
    let cancelled = false;
    host.checkConfigured()
      .then((r) => {
        if (cancelled) return;
        setWebConfigured(Boolean(r.configured));
        setOrgMode(Boolean(r.orgMode));
      })
      .catch(() => {
        if (cancelled) return;
        setWebConfigured(false); // unreachable → fall back to the full flow
        setOrgMode(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Fetch recommendations from cowork-server; missing or unreachable lists fall back to free-text
  // model entry.
  const [recModels, setRecModels] = useState<Record<string, string[]>>({});
  // Use catalog labels so model names match the Settings picker.
  const [recLabels, setRecLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetchRecommendedModels().then((rec) => {
      const map = (rec?.recommendedModels as Record<string, string[]> | undefined);
      if (!cancelled && map) setRecModels(map);
      const labels = (rec?.modelLabels as Record<string, string> | undefined);
      if (!cancelled && labels) setRecLabels(labels);
    });
    return () => { cancelled = true; };
  }, []);

  const ANTHROPIC_MODELS = useMemo(() => recommendedModelOptions(recModels, 'anthropic', recLabels), [recModels, recLabels]);
  const OPENAI_MODELS = useMemo(() => recommendedModelOptions(recModels, 'openai', recLabels), [recModels, recLabels]);
  const GEMINI_MODELS = useMemo(() => recommendedModelOptions(recModels, 'gemini', recLabels), [recModels, recLabels]);

  const models = byokProvider === 'anthropic'
    ? ANTHROPIC_MODELS
    : byokProvider === 'gemini'
      ? GEMINI_MODELS
      : byokProvider === 'openai'
        ? OPENAI_MODELS
        : [];

  // Use the free-text sentinel for an empty recommendation list so resolvedModel cannot retain a
  // stale id.
  const firstModelId = (list: ProviderModel[]) => list[0]?.id ?? CUSTOM_MODEL;

  // Seed only an empty model field; preserve explicit choices, including Custom.
  useEffect(() => {
    if (selectedModel) return;
    if (byokProvider === 'openai-compatible') return;
    if (models.length) setSelectedModel(firstModelId(models));
  }, [models, byokProvider, selectedModel]);

  const resolvedModel = selectedModel === CUSTOM_MODEL ? customModel.trim() : selectedModel;

  const canConnect =
    provider === 'minds'
      ? apiKey.trim().length > 0
      : byokProvider === 'openai-compatible'
        ? customBaseUrl.trim().length > 0 && resolvedModel.length > 0
        : apiKey.trim().length > 0 && resolvedModel.length > 0;

  const canConnectLlm =
    byokProvider === 'openai-compatible'
      ? customBaseUrl.trim().length > 0 && resolvedModel.length > 0
      : llmApiKey.trim().length > 0 && resolvedModel.length > 0;

  const handleSwitchByokProvider = (bp: ByokProvider) => {
    setByokProvider(bp);
    if (bp === 'anthropic') setSelectedModel(firstModelId(ANTHROPIC_MODELS));
    else if (bp === 'openai') setSelectedModel(firstModelId(OPENAI_MODELS));
    else if (bp === 'gemini') setSelectedModel(firstModelId(GEMINI_MODELS));
    else setSelectedModel(CUSTOM_MODEL);
    setCustomModel('');
    setCustomBaseUrl('');
    setLlmApiKey('');
    if (phase !== 'minds-no-llm') {
      setPhase('choose');
      setErrorMsg('');
      setApiKey('');
    } else {
      setErrorMsg('');
    }
  };

  // Share authoritative persistence and install-deferral decisions across every finalize path.
  const finalizeSettings = async (lines: string[]) => {
    const res = await persistOnboarding(
      {
        saveSettings: (c) => host.saveSettings(c),
        syncToDb: syncSettingsToDb,
        syncModels: syncModelsToDb,
        syncHarness: () => syncHarness(coworker.id),
      },
      lines,
    );
    const installStatus = res.ok ? null : await host.checkInstall().catch(() => null);
    const outcome = resolveFinalizeOutcome(res, installStatus);
    if (outcome.action === 'error') {
      finalizedRef.current = false;
      setPhase('error');
      setErrorMsg(outcome.error);
      return;
    }
    if (outcome.action === 'defer') {
      // The deferred DB write skipped model sync, and bulk .env replay excludes model keys.
      // Pass the in-memory model choice to onComplete for one post-install replay, then route
      // directly to setup.
      onComplete(modelLinesFrom(lines));
      return;
    }
    setPhase('success');
    setTimeout(onComplete, 2000);
  };

  const saveFinal = async (lines: string[]) => {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    lines.push('ANTON_MEMORY_MODE=autopilot');
    lines.push('ANTON_EPISODIC_MEMORY=true');
    await finalizeSettings(lines);
  };

  const handleConnect = async () => {
    setPhase('validating');
    setErrorMsg('');

    if (provider === 'minds') {
      const mindsBase = mindsUrl.trim().replace(/\/+$/, '');
      const result = await host.validateProvider('minds', apiKey.trim(), mindsBase);
      if (!result.ok) {
        setPhase('error');
        setErrorMsg(result.error || 'Invalid API key');
        return;
      }

      // Desktop keys go through main's keychain and sidecar hand-over; do not write long-lived
      // bearers to .env.
      // Web has no main process and persists the key on the server.
      const stored = await host.mindshubSetUserKey(apiKey.trim());
      if (stored.supported && !stored.ok) {
        setPhase('error');
        setErrorMsg(stored.reason || 'Could not save the MindsHub key.');
        return;
      }
      const mindsLines = [
        'ANTON_TERMS_CONSENT=true',
        `ANTON_MINDS_ENABLED=true`,
        ...(stored.supported ? [] : [`ANTON_MINDS_API_KEY=${apiKey.trim()}`]),
        `ANTON_MINDS_URL=${mindsBase}`,
      ];

      /*
       * The free-model probe already proved reachability and credentials. Do not probe a paid
       * model:
       * an empty wallet would wrongly reject a valid MindsHub setup.
       */
      // Set provider only; the backend resolves and reports default models.
      const lines = [
        ...mindsLines,
        'ANTON_PLANNING_PROVIDER=minds-cloud',
        'ANTON_CODING_PROVIDER=minds-cloud',
      ];
      await saveFinal(lines);
    } else {
      const { provider: validationProvider, baseUrl: validationBaseUrl } =
        resolveValidationTarget(byokProvider, customBaseUrl);

      const result = await host.validateProvider(
        validationProvider,
        apiKey.trim(),
        validationBaseUrl || undefined,
        resolvedModel
      );

      if (!result.ok) {
        setPhase('error');
        setErrorMsg(result.error || 'Validation failed');
        return;
      }

      const env = buildProviderEnv(byokProvider, apiKey.trim(), customBaseUrl, resolvedModel);
      const lines = ['ANTON_TERMS_CONSENT=true', ...Object.entries(env).map(([k, v]) => `${k}=${v}`)];
      await saveFinal(lines);
    }
  };

  const handleConnectLlm = async () => {
    setPhase('validating');
    setErrorMsg('');

    const { provider: validationProvider, baseUrl: validationBaseUrl } =
      resolveValidationTarget(byokProvider, customBaseUrl);
    const key = llmApiKey.trim() || (byokProvider === 'openai-compatible' ? 'not-needed' : '');

    // Before installation, an unreachable backend defers validation until first use; it is not a
    // credential rejection.
    let result: { ok: boolean; error?: string } | null = null;
    try {
      result = await host.validateProvider(
        validationProvider,
        key,
        validationBaseUrl || undefined,
        resolvedModel
      );
    } catch {
      result = null;
    }

    if (result && !result.ok) {
      setPhase('minds-no-llm');
      setErrorMsg(result.error || 'Validation failed');
      return;
    }

    // Preserve Stage 1 MindsHub settings for publishing and connectors while merging the new LLM
    // settings.
    const existing = await host.readSettings();
    const merged: Record<string, string> = {
      ...existing,
      ...buildProviderEnv(byokProvider, key, customBaseUrl, resolvedModel),
    };
    merged.ANTON_MEMORY_MODE = merged.ANTON_MEMORY_MODE || 'autopilot';
    merged.ANTON_EPISODIC_MEMORY = merged.ANTON_EPISODIC_MEMORY || 'true';
    // Continuing records the consent disclosed by the visible terms line.
    merged.ANTON_TERMS_CONSENT = 'true';

    if (finalizedRef.current) return;
    finalizedRef.current = true;
    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    await finalizeSettings(lines);
  };

  const handleMindsSSO = async () => {
    setPhase('validating');
    setErrorMsg('');
    const loginResult = await host.mindshubLogin();
    if (!loginResult.ok) {
      setPhase('error');
      const reason = String(loginResult.reason || '');
      const reloadKey = host.isMac() ? 'Cmd+R' : 'Ctrl+R';
      if (/timed out/i.test(reason)) {
        // A missing callback often means sign-in used a stale tab: the loopback port changes each
        // launch.
        setErrorMsg(
          `Sign-in timed out — the browser never finished authorizing. Try again and complete the newest tab it opens (close any older "You're authorized" tabs), or press ${reloadKey} to reload.`,
        );
      } else if (/cancelled/i.test(reason)) {
        setErrorMsg('Sign-in was cancelled. Try again whenever you’re ready.');
      } else {
        setErrorMsg(reason || 'Sign in failed. Please try again.');
      }
      return;
    }
    await completeMindsAuth();
  };

  // Registration can pause for minutes at email verification; timeout offers sign-in instead of an
  // error.
  const handleMindsSignup = async () => {
    setPhase('signup-wait');
    setErrorMsg('');
    const result = await host.mindshubSignup();
    if (!result.ok) {
      const reason = String(result.reason || '');
      if (/cancelled/i.test(reason)) {
        // A replacement flow owns phase; cancel must only reset a still-visible signup wait screen.
        setPhase((p) => (p === 'signup-wait' ? 'choose' : p));
        return;
      }
      if (/timed out/i.test(reason)) {
        setPhase('signup-verify');
        return;
      }
      setPhase('error');
      setErrorMsg(reason || 'Sign up failed. Please try again.');
      return;
    }
    await completeMindsAuth();
  };

  // Sign-in and sign-up share finalization; ask organization only when multiple company choices
  // exist.
  const completeMindsAuth = async () => {
    setPhase('validating');
    const { orgs } = await host.mindshubListOrgs();
    // Older shells cannot preserve an explicit organization choice; keep ranked selection until an
    // installer upgrade.
    if (needsOrgPick(orgs) && host.canPickOrganization()) {
      const ranked = rankMindsOrgs(orgs);
      setOrgChoices(ranked);
      setPickedOrgId(ranked[0].id);
      setPhase('pick-org');
      return;
    }
    await mintMindsKey();
  };

  // Only an explicit picker answer sets chosenByUser; main may otherwise choose an entitled
  // organization.
  const mintMindsKey = async (pick?: { organizationId: string; chosenByUser: boolean }) => {
    setPhase('validating');
    let finalizeResult: { ok: boolean; reason?: string; upgradeRequired?: boolean; organization?: MindsOrg };
    try {
      finalizeResult = await host.mindshubFinalize(pick?.organizationId, pick?.chosenByUser);
    } catch (e: any) {
      setPhase('error');
      setErrorMsg(`MindsHub setup failed: ${e?.message || 'Unexpected error. Please try again.'}`);
      return;
    }
    // Legacy bridge response: redirect upgradeRequired to BYOK and preserve consent.
    // Current shells no longer mint keys; entitlement failures surface at the gateway on first use.
    if (finalizeResult.upgradeRequired) {
      // Provisioning refusal offers BYOK, so record its outcome separately from paywall triggers.
      trackKeyProvisioningRefused('byok_offered');
      // Web .env consent is best-effort; completion also persists it client-side (see
      // host.saveSettings).
      await host.saveSettings('ANTON_TERMS_CONSENT=true');
      setStep('byok');
      setPhase('minds-no-llm');
      return;
    }
    if (!finalizeResult.ok) {
      setPhase('error');
      setErrorMsg(finalizeResult.reason || 'Failed to set up MindsHub. Please try again.');
      return;
    }
    // Set provider only: backend owns default models and main hands credentials directly to the
    // sidecar.
    const lines = [
      'ANTON_TERMS_CONSENT=true',
      'ANTON_MINDS_ENABLED=true',
      `ANTON_MINDS_URL=${MINDS_API_BASE}`,
      'ANTON_PLANNING_PROVIDER=minds-cloud',
      'ANTON_CODING_PROVIDER=minds-cloud',
    ];
    setMintedOrg(finalizeResult.organization ?? null);
    await saveFinal(lines);
  };

  // Web Keycloak authenticates before mounting and web-main.tsx writes token keys; finalize only
  // config here.
  // Electron returns before importing keycloak-js.
  useEffect(() => {
    if (!host.isWeb) return;
    if (provider !== 'minds') return;
    // Do not write admin-owned provider config in org deployments; null means the deployment check
    // is pending.
    if (orgMode !== false) return;
    if (finalizedRef.current) return;
    let cancelled = false;
    import('../../lib/keycloak').then(({ keycloak }) => {
      if (cancelled || finalizedRef.current || !keycloak.authenticated) return;
      setAutoFinalizing(true);
      saveFinal([
        'ANTON_TERMS_CONSENT=true',
        'ANTON_MINDS_ENABLED=true',
        `ANTON_MINDS_URL=${MINDS_API_BASE}`,
        'ANTON_PLANNING_PROVIDER=minds-cloud',
        'ANTON_CODING_PROVIDER=minds-cloud',
      ]);
    });
    return () => { cancelled = true; };
  }, [provider, orgMode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (legalDoc) {
    return <LegalViewer doc={legalDoc} onClose={() => setLegalDoc(null)} />;
  }

  // Hold while config_ready or Keycloak finalization is pending to avoid flashing provider/consent
  // screens.
  if (host.isWeb && (webConfigured === null || autoFinalizing) && phase !== 'success' && phase !== 'error') {
    return (
      <ArcadeShell title="Welcome" subtitle="getting things ready">
        <div className="arc-stack arc-fade-in" style={{ gap: 16, padding: '12px 0' }}>
          <PixelSprite name={coworker.sprite} size={72} bob title={coworker.label} />
        </div>
      </ArcadeShell>
    );
  }
  // Configured web deployments need only visible consent; auto-finalizing Keycloak handles entry
  // separately.
  if (host.isWeb && webConfigured && !autoFinalizing && phase !== 'success' && phase !== 'error') {
    return (
      <ArcadeShell title="MindsHub Cowork" subtitle="you're all set">
        <div className="arc-stack" style={{ gap: 18 }}>
          <PixelSprite name={coworker.sprite} size={84} bob title={coworker.label} />
          <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--arc-muted)', textAlign: 'center', maxWidth: 420 }}>
            Your workspace is ready. Give the agent a task. It does the work and hands back
            the results.
          </div>
          <button
            className="arc-btn"
            style={{ width: '100%' }}
            onClick={() => { if (finalizedRef.current) return; finalizedRef.current = true; onComplete(); }}
          >
            Continue
          </button>
          <div style={{ fontSize: 10.5, lineHeight: 1.5, letterSpacing: '0.04em', color: 'var(--arc-dim)', textAlign: 'center', maxWidth: 420 }}>
            By continuing, you agree to our{' '}
            <button type="button" className="arc-link" onClick={() => setLegalDoc('terms')}>Terms of Service</button>{' '}
            and{' '}
            <button type="button" className="arc-link" onClick={() => setLegalDoc('privacy')}>Privacy Policy</button>.
          </div>
        </div>
      </ArcadeShell>
    );
  }

  // Ask which organization pays only when multiple company organizations are available.
  if (phase === 'pick-org') {
    return (
      <ArcadeShell title="Choose an organization" subtitle="who pays for your usage">
        <div className="arc-stack arc-fade-in" style={{ gap: 18, width: 'min(420px, 100%)' }}>
          <div style={{ fontSize: 11.5, lineHeight: 1.65, letterSpacing: '0.03em', color: 'var(--arc-muted)', textAlign: 'center' }}>
            You belong to more than one organization. Pick the one this computer
            should work in — its credits pay for your usage, and its admins can
            see and revoke this computer's access. You can change it later from
            the account menu.
          </div>

          <div className="arc-panel" style={{ width: '100%', boxSizing: 'border-box', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
            {orgChoices.map((org) => (
              <label key={org.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="minds-organization"
                  value={org.id}
                  checked={pickedOrgId === org.id}
                  onChange={() => setPickedOrgId(org.id)}
                />
                <span style={{ fontSize: 12.5, letterSpacing: '0.03em' }} title={organizationLabel(org) ?? undefined}>
                  {organizationLabel(org)}
                </span>
              </label>
            ))}
          </div>

          <button
            type="button"
            className="arc-btn"
            disabled={!pickedOrgId}
            onClick={() => mintMindsKey({ organizationId: pickedOrgId, chosenByUser: true })}
          >
            Continue
          </button>
        </div>
      </ArcadeShell>
    );
  }

  if (phase === 'success') {
    return (
      <ArcadeShell title="All set" subtitle="you're signed in">
        <div className="arc-stack arc-pop" style={{ gap: 18 }}>
          <PixelSprite name={coworker.sprite} size={84} bob title={coworker.label} />
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--arc-green)' }}>
            You're all set!
          </div>
          {mintedOrg && (
            <div style={{ fontSize: 11.5, letterSpacing: '0.06em', color: 'var(--arc-muted)', textAlign: 'center', maxWidth: 340 }}>
              Working in <strong>{organizationLabel(mintedOrg)}</strong>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, letterSpacing: '0.1em', color: 'var(--arc-muted)' }}>
            <PixelSprite name="coin" size={18} /> Ready to go
          </div>
        </div>
      </ArcadeShell>
    );
  }

  const validatingBlock = (
    <div className="arc-stack arc-fade-in" style={{ gap: 16, padding: '12px 0' }}>
      <PixelSprite name="bolt" size={44} title="Validating" />
      <PixelMarquee cells={20} style={{ width: 280 }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--arc-muted)' }}>
        TESTING LINK…
      </span>
    </div>
  );

  // Registration may wait minutes for email verification; Cancel tears down the loopback listener.
  const signupWaitBlock = (
    <div className="arc-stack arc-fade-in" style={{ gap: 14, padding: '12px 0' }}>
      <PixelSprite name="bolt" size={44} title="Waiting for sign-up" />
      <PixelMarquee cells={20} style={{ width: 280 }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--arc-muted)' }}>
        FINISH SIGN-UP IN YOUR BROWSER
      </span>
      <span style={{ fontSize: 11, lineHeight: 1.6, letterSpacing: '0.04em', color: 'var(--arc-dim)', textAlign: 'center', maxWidth: 340 }}>
        Create your account, then open the verification email we send you —
        clicking its link signs you in here automatically.
      </span>
      <button type="button" className="arc-link" onClick={() => host.oauthCancel()}>Cancel</button>
    </div>
  );

  if (step === 'byok' && (phase === 'minds-no-llm' || phase === 'validating')) {
    const showLlmForm = phase === 'minds-no-llm';
    return (
      <ArcadeShell title="Use your own key" subtitle="add an LLM provider to continue">
        <div className="arc-stack arc-fade-in" style={{ gap: 18, width: 'min(420px, 100%)' }}>
          {phase === 'validating' && validatingBlock}

          {showLlmForm && (
            <>
              <div style={{ fontSize: 11.5, lineHeight: 1.65, letterSpacing: '0.03em', color: 'var(--arc-muted)', textAlign: 'center' }}>
                {skippedMinds
                  ? <>Pick an LLM provider to run on. You can connect MindsHub later in Settings → Providers (needed to share to the web).</>
                  : <>Your MindsHub account has no LLM credits yet. Top up to use managed models — or connect your own provider below.</>}
              </div>

              <button
                type="button"
                className="arc-link"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  setProvider('minds');
                  setStep('minds');
                  setPhase('choose');
                  setSkippedMinds(false);
                  setErrorMsg('');
                  setLlmApiKey('');
                }}
              >← back to account options</button>

              <div className="arc-panel" style={{ width: '100%', boxSizing: 'border-box', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18, textAlign: 'left' }}>
                <div>
                  <label className="arc-label">Select a provider</label>
                  <div className="arc-seg-row">
                    <button type="button" className={`arc-seg ${byokProvider === 'anthropic' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('anthropic')}>Anthropic</button>
                    <button type="button" className={`arc-seg ${byokProvider === 'openai' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('openai')}>OpenAI</button>
                    <button type="button" className={`arc-seg ${byokProvider === 'gemini' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('gemini')}>Gemini</button>
                    <button type="button" className={`arc-seg ${byokProvider === 'openai-compatible' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('openai-compatible')}>Custom</button>
                  </div>
                </div>

                {byokProvider === 'openai-compatible' && (
                  <div>
                    <label className="arc-label">Base URL</label>
                    <input
                      type="text"
                      className="arc-input"
                      placeholder="http://localhost:11434/v1"
                      value={customBaseUrl}
                      onChange={(e) => { setCustomBaseUrl(e.target.value); setErrorMsg(''); }}
                    />
                    <div className="arc-hint">Ollama, vLLM, Together, Groq, LM Studio, etc.</div>
                  </div>
                )}

                <div>
                  <label className="arc-label">Model</label>
                  {models.length > 0 ? (
                    <>
                      <select
                        className="arc-select"
                        value={selectedModel}
                        onChange={(e) => { setSelectedModel(e.target.value); setErrorMsg(''); }}
                      >
                        {models.map((m: { id: string; label: string }) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                        <option value={CUSTOM_MODEL}>Custom...</option>
                      </select>
                      {selectedModel === CUSTOM_MODEL && (
                        <input
                          type="text"
                          className="arc-input"
                          style={{ marginTop: 8 }}
                          placeholder="Enter model ID..."
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                          autoFocus
                        />
                      )}
                    </>
                  ) : (
                    <input
                      type="text"
                      className="arc-input"
                      placeholder="Enter model name..."
                      value={customModel}
                      onChange={(e) => { setCustomModel(e.target.value); setErrorMsg(''); }}
                    />
                  )}
                </div>

                <div>
                  <label className="arc-label">
                    {byokProvider === 'anthropic' ? 'Anthropic API Key'
                      : byokProvider === 'gemini' ? 'Google AI API Key'
                      : byokProvider === 'openai-compatible' ? 'API Key (optional)'
                      : 'OpenAI API Key'}
                  </label>
                  <input
                    type="password"
                    className="arc-input"
                    placeholder={byokProvider === 'anthropic' ? 'sk-ant-...'
                      : byokProvider === 'gemini' ? 'AIza...'
                      : byokProvider === 'openai-compatible' ? 'Enter to skip if not needed'
                      : 'sk-...'}
                    value={llmApiKey}
                    onChange={(e) => setLlmApiKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canConnectLlm) handleConnectLlm();
                    }}
                  />
                </div>
              </div>

              {errorMsg && (
                <div className="arc-error" role="alert">
                  <span style={{ fontWeight: 700, flex: 'none' }}>✗</span>
                  <span>{errorMsg}</span>
                </div>
              )}

              <button className="arc-btn" disabled={!canConnectLlm} onClick={handleConnectLlm}>
                Connect
              </button>
            </>
          )}
        </div>
      </ArcadeShell>
    );
  }

  return (
    <ArcadeShell title="Get started" subtitle="create a free account or sign in to continue">
      <div className="arc-stack arc-fade-in" style={{ gap: 18, width: 'min(420px, 100%)' }}>
        <div className="arc-panel" style={{ width: '100%', boxSizing: 'border-box', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'left', borderColor: 'color-mix(in srgb, var(--arc-cyan) 35%, transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <PixelSprite name="bolt" size={26} title="MindsHub" />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--arc-ink)' }}>MINDSHUB</div>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--arc-dim)', marginTop: 2 }}>MANAGED BY MINDSDB</div>
            </div>
          </div>

          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {['Smart model routing', 'Secure data connectors', 'Share dashboards'].map((b) => (
              <li key={b} style={{ fontSize: 11.5, letterSpacing: '0.05em', color: 'var(--arc-muted)', display: 'flex', gap: 9 }}>
                <span style={{ color: 'var(--arc-green)', fontWeight: 700 }}>+</span> {b}
              </li>
            ))}
          </ul>

          {host.isElectron ? (
            <>
              <button
                className="arc-btn"
                style={{ width: '100%' }}
                disabled={phase === 'validating' || phase === 'signup-wait'}
                onClick={handleMindsSignup}
              >
                {phase === 'validating' ? 'One moment…' : 'Create a free account'}
              </button>
              {/* Sign-in stays available to supersede a parked signup; main owns a single flight. */}
              <button
                type="button"
                className="arc-btn-ghost arc-btn-ghost-stacked"
                style={{ width: '100%' }}
                disabled={phase === 'validating'}
                onClick={handleMindsSSO}
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="arc-label">MindsHub API Key</label>
                <input
                  type="password"
                  className="arc-input"
                  placeholder="mdb_..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={phase === 'validating'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canConnect && phase !== 'validating') handleConnect();
                  }}
                />
              </div>
              <button
                className="arc-btn"
                style={{ width: '100%' }}
                disabled={!canConnect || phase === 'validating'}
                onClick={handleConnect}
              >
                {phase === 'validating' ? 'Connecting…' : 'Connect'}
              </button>
              <div style={{ fontSize: 10.5, letterSpacing: '0.05em', color: 'var(--arc-dim)', textAlign: 'center' }}>
                No account?{' '}
                <button
                  type="button"
                  className="arc-link"
                  onClick={() => host.openExternal(MINDS_REGISTER_URL)}
                >Create one for free →</button>
              </div>
            </>
          )}
        </div>

        {phase === 'validating' && validatingBlock}
        {phase === 'signup-wait' && signupWaitBlock}

        {phase === 'signup-verify' && (
          <div className="arc-panel" role="status" style={{ padding: '14px 18px', fontSize: 11.5, lineHeight: 1.7, letterSpacing: '0.04em', color: 'var(--arc-muted)', textAlign: 'center' }}>
            Verified your email? You're one click away — hit{' '}
            <b style={{ color: 'var(--arc-ink)' }}>Sign in</b> to finish.
            No need to register again.
          </div>
        )}

        {phase === 'error' && (
          <div className="arc-error" role="alert">
            <span style={{ fontWeight: 700, flex: 'none' }}>✗</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {phase !== 'validating' && (
          <button
            type="button"
            className="arc-link"
            onClick={() => {
              // Cancel parked signup before BYOK so a later email-link callback cannot change the
              // chosen path.
              if (phase === 'signup-wait') host.oauthCancel();
              setProvider('byok');
              setStep('byok');
              setApiKey('');
              setErrorMsg('');
              setSkippedMinds(true);
              setPhase('minds-no-llm');
            }}
          >Continue without an account →</button>
        )}

        {phase !== 'validating' && (
          <div style={{ fontSize: 10.5, lineHeight: 1.5, letterSpacing: '0.04em', color: 'var(--arc-dim)', textAlign: 'center', maxWidth: 420 }}>
            By continuing, you agree to our{' '}
            <button type="button" className="arc-link" onClick={() => setLegalDoc('terms')}>Terms of Service</button>{' '}
            and{' '}
            <button type="button" className="arc-link" onClick={() => setLegalDoc('privacy')}>Privacy Policy</button>.
          </div>
        )}

        {onBack && phase !== 'validating' && (
          <button type="button" className="arc-link" onClick={onBack} style={{ marginTop: 2 }}>
            ← back
          </button>
        )}
      </div>
    </ArcadeShell>
  );
}
