// Provider onboarding ("POWER UP"), arcade edition.
//
// The logic is a 1:1 port of the previous Onboarding page — same phase
// machine (choose / validating / minds-no-llm / success / error), same
// host calls, same .env lines, same backend sync — re-skinned as the
// stage where you plug a power source into the coworker you just chose.

import { useState, useEffect, useMemo, useRef } from 'react';
import { host } from '../../platform/host';
import { BASE, fetchRecommendedModels } from '../../cowork/api';
import { recommendedModelOptions, type ProviderModel } from '../../cowork/lib/settingsTransform';
import { MINDS_API_BASE, MINDS_REGISTER_URL } from '../../lib/mindsUrls';
import { syncSettingsToDb } from '../../lib/syncSettings';
import { ArcadeShell, PixelMarquee } from './components';
import { PixelSprite, type SpriteName } from './sprites';
import { LegalViewer } from './TermsScreen';

type Provider = 'minds' | 'byok';
type ByokProvider = 'anthropic' | 'openai' | 'gemini' | 'openai-compatible';
type Phase = 'choose' | 'validating' | 'minds-no-llm' | 'success' | 'error';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

const CUSTOM_MODEL = '__custom__';

// Last-resort MindsHub model, used only if the backend returns nothing. We
// avoid maintaining model names in this repo, but a single safe fallback is
// worth it: the validator's generic openai-compatible default is not served
// by MindsHub. `latest:*` is a stable alias, not a pinned version, so it
// won't drift. The backend's own default (apply_model_defaults) is the real
// source — this only guards a failed `/recommended-models` fetch.
const FALLBACK_MINDS_MODEL = 'latest:sonnet';

/**
 * The model to probe MindsHub LLM availability with, sourced from the
 * backend's recommended minds-cloud (planning, coding) pair. Returns the
 * coding model, falling back to planning, then to FALLBACK_MINDS_MODEL if the
 * backend is unreachable — never undefined, so the probe always sends a
 * MindsHub-served model rather than the validator's generic default.
 */
async function mindsProbeModel(): Promise<string> {
  const rec = await fetchRecommendedModels();
  const pair = rec?.recommendedPair?.['minds-cloud'];
  return pair?.[1] || pair?.[0] || FALLBACK_MINDS_MODEL;
}

/** Persist the cartridge choice as the `harness` setting (best-effort). */
async function syncHarness(harnessId: string): Promise<void> {
  try {
    await fetch(`${BASE}/settings/harness`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: harnessId }),
    });
  } catch {}
}

// The provider→validation-target and provider→env-vars mappings are
// identical whether BYOK runs directly (Stage 1) or as the LLM step after
// MindsHub (Stage 2). Shared here so the two call sites can't drift (they
// previously diverged on the openai-compatible "not-needed" fallback).
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
  onComplete: () => void;
  /** Optional — returns to the coworker-select screen. */
  onBack?: () => void;
}) {
  const [provider, setProvider] = useState<Provider>('minds');
  const [byokProvider, setByokProvider] = useState<ByokProvider>('anthropic');
  // Seeded once the backend's recommended-model lists load (see effect below).
  const [selectedModel, setSelectedModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [mindsUrl] = useState(MINDS_API_BASE);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('choose');
  const [errorMsg, setErrorMsg] = useState('');
  const [skippedMinds, setSkippedMinds] = useState(false);
  const [mindsNoCredits, setMindsNoCredits] = useState(false);
  // Which stage's layout to render. Decoupled from `phase` so the
  // validating spinner shows in the right place without inferring it
  // from whether the API-key field happens to be non-empty.
  const [step, setStep] = useState<'minds' | 'byok'>('minds');
  // Latches once onboarding finalizes so the web Keycloak auto-finalize
  // effect (which re-runs on `provider` toggles) can't double-save /
  // double-fire onComplete.
  const finalizedRef = useRef(false);
  // Inline Terms/Privacy viewer for the "by continuing you agree" line.
  const [legalDoc, setLegalDoc] = useState<'terms' | 'privacy' | null>(null);

  // Per-provider model lists, owned by cowork-server and fetched at runtime
  // (same source minds-cloud already uses) — no model names are hardcoded
  // here. Empty until the fetch resolves; the picker degrades to a free-text
  // input in that window (and if the backend is unreachable).
  const [recModels, setRecModels] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let cancelled = false;
    fetchRecommendedModels().then((rec) => {
      const map = (rec?.recommendedModels as Record<string, string[]> | undefined);
      if (!cancelled && map) setRecModels(map);
    });
    return () => { cancelled = true; };
  }, []);

  const ANTHROPIC_MODELS = useMemo(() => recommendedModelOptions(recModels, 'anthropic'), [recModels]);
  const OPENAI_MODELS = useMemo(() => recommendedModelOptions(recModels, 'openai'), [recModels]);
  const GEMINI_MODELS = useMemo(() => recommendedModelOptions(recModels, 'gemini'), [recModels]);

  const models = byokProvider === 'anthropic'
    ? ANTHROPIC_MODELS
    : byokProvider === 'gemini'
      ? GEMINI_MODELS
      : byokProvider === 'openai'
        ? OPENAI_MODELS
        : [];

  // A provider's default model id: its first recommended entry, or the
  // free-text sentinel when the list is empty (so resolvedModel reads from
  // the custom field rather than a stale id).
  const firstModelId = (list: ProviderModel[]) => list[0]?.id ?? CUSTOM_MODEL;

  // Seed the model field once lists load (or after a provider switch left it
  // blank). Skips when the user has already picked something, including
  // Custom… — so we never clobber a manual choice.
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

  const saveFinal = async (lines: string[]) => {
    if (finalizedRef.current) return; // guard double-finalize (see finalizedRef)
    finalizedRef.current = true;
    lines.push('ANTON_MEMORY_MODE=autopilot');
    lines.push('ANTON_EPISODIC_MEMORY=true');
    await host.saveSettings(lines.join('\n'));
    await syncSettingsToDb(lines);
    await syncHarness(coworker.id);
    setPhase('success');
    setTimeout(onComplete, 2000);
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

      const mindsLines = [
        'ANTON_TERMS_CONSENT=true',
        `ANTON_MINDS_ENABLED=true`,
        `ANTON_MINDS_API_KEY=${apiKey.trim()}`,
        `ANTON_MINDS_URL=${mindsBase}`,
      ];

      // The probe model is the backend's recommended minds-cloud coding
      // model — fetched, never hardcoded here, so model names live only in
      // cowork-server.
      const llmResult = await host.validateProvider(
        'openai-compatible',
        apiKey.trim(),
        `${mindsBase}/v1`,
        await mindsProbeModel()
      );

      if (llmResult.ok) {
        // Set only the provider; the backend resolves the default
        // planning/coding model on load and reports it back to the UI
        // (apply_model_defaults), so we never write model names.
        const lines = [
          ...mindsLines,
          'ANTON_PLANNING_PROVIDER=minds-cloud',
          'ANTON_CODING_PROVIDER=minds-cloud',
        ];
        await saveFinal(lines);
      } else {
        await host.saveSettings(mindsLines.join('\n'));
        setStep('byok');
        setPhase('minds-no-llm');
      }
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

    // Validate against the backend when it's reachable. In the login-first
    // flow the cowork-server may not be installed yet (install runs after
    // auth), so a network failure here isn't a rejection — defer validation
    // and let the backend validate on first use.
    let result: { ok: boolean; error?: string } | null = null;
    try {
      result = await host.validateProvider(
        validationProvider,
        key,
        validationBaseUrl || undefined,
        resolvedModel
      );
    } catch {
      result = null; // server unreachable — proceed, validate later
    }

    if (result && !result.ok) {
      setPhase('minds-no-llm');
      setErrorMsg(result.error || 'Validation failed');
      return;
    }

    // Merge the new LLM vars onto the existing settings (the MindsHub
    // keys saved in Stage 1 stay intact for publishing/connectors).
    const existing = await host.readSettings();
    const merged: Record<string, string> = {
      ...existing,
      ...buildProviderEnv(byokProvider, key, customBaseUrl, resolvedModel),
    };
    merged.ANTON_MEMORY_MODE = merged.ANTON_MEMORY_MODE || 'autopilot';
    merged.ANTON_EPISODIC_MEMORY = merged.ANTON_EPISODIC_MEMORY || 'true';
    // Continuing past the auth screen records terms consent (the standalone
    // terms screen is gone — consent is implicit per the "by continuing" line).
    merged.ANTON_TERMS_CONSENT = 'true';

    if (finalizedRef.current) return;
    finalizedRef.current = true;
    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    await host.saveSettings(lines.join('\n'));
    await syncSettingsToDb(lines);
    await syncHarness(coworker.id);
    setPhase('success');
    setTimeout(onComplete, 2000);
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
        // The loopback callback never arrived — usually the sign-in
        // happened in a STALE browser tab from an earlier app launch
        // (the callback port changes every launch).
        setErrorMsg(
          `Sign-in timed out — the browser never finished authorizing. Try again and complete the newest tab it opens (close any older "You're authorized" tabs), or press ${reloadKey} to reload.`,
        );
      } else if (/cancelled/i.test(reason)) {
        setErrorMsg('Sign-in was cancelled. Press Sign in with MindsHub to try again.');
      } else {
        setErrorMsg(reason || 'Sign in failed. Please try again.');
      }
      return;
    }
    let finalizeResult: { ok: boolean; reason?: string; upgradeRequired?: boolean; apiKey?: string };
    try {
      finalizeResult = await host.mindshubFinalize();
    } catch (e: any) {
      setPhase('error');
      setErrorMsg(`MindsHub setup failed: ${e?.message || 'Unexpected error. Please try again.'}`);
      return;
    }
    // No LLM credits — account authenticated but key wasn't provisioned.
    // Save terms consent and redirect to BYOK so the user can pick a provider.
    if (finalizeResult.upgradeRequired) {
      await host.saveSettings('ANTON_TERMS_CONSENT=true');
      setMindsNoCredits(true);
      setStep('byok');
      setPhase('minds-no-llm');
      return;
    }
    if (!finalizeResult.ok) {
      setPhase('error');
      setErrorMsg(finalizeResult.reason || 'Failed to set up MindsHub. Please try again.');
      return;
    }
    // Provider only — the backend resolves the default model on load.
    const lines = [
      'ANTON_TERMS_CONSENT=true',
      'ANTON_MINDS_ENABLED=true',
      `ANTON_MINDS_URL=${MINDS_API_BASE}`,
      'ANTON_PLANNING_PROVIDER=minds-cloud',
      'ANTON_CODING_PROVIDER=minds-cloud',
    ];
    if (finalizeResult.apiKey) {
      // ENG-436: write ONLY the dedicated minds slot. minds-cloud
      // resolves from minds_api_key/minds_url everywhere (main agent +
      // scratchpad), so we no longer copy the minds key into the OpenAI
      // slot — that left a user's own OpenAI key clobbered.
      lines.push(`ANTON_MINDS_API_KEY=${finalizeResult.apiKey}`);
    }
    await saveFinal(lines);
  };

  // Web: ReactKeycloakProvider with onLoad:'login-required' redirected to
  // Keycloak before the app rendered; on remount keycloak.authenticated is
  // already true and the token keys were written by web-main.tsx. Here we
  // just write the config keys to complete onboarding. On Electron the
  // early return fires before the import, so keycloak-js never loads.
  useEffect(() => {
    if (!host.isWeb) return;
    if (provider !== 'minds') return;
    if (finalizedRef.current) return; // already completed — don't re-finalize
    let cancelled = false;
    import('../../lib/keycloak').then(({ keycloak }) => {
      if (cancelled || finalizedRef.current || !keycloak.authenticated) return;
      // Provider only — the backend resolves the default model on load.
      saveFinal([
        'ANTON_TERMS_CONSENT=true',
        'ANTON_MINDS_ENABLED=true',
        `ANTON_MINDS_URL=${MINDS_API_BASE}`,
        'ANTON_PLANNING_PROVIDER=minds-cloud',
        'ANTON_CODING_PROVIDER=minds-cloud',
      ]);
    });
    return () => { cancelled = true; };
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Full-screen Terms/Privacy reader (opened from the consent line).
  if (legalDoc) {
    return <LegalViewer doc={legalDoc} onClose={() => setLegalDoc(null)} />;
  }

  // ── Victory ────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <ArcadeShell title="All set" subtitle="you're signed in">
        <div className="arc-stack arc-pop" style={{ gap: 18 }}>
          <PixelSprite name={coworker.sprite} size={84} bob title={coworker.label} />
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--arc-green)' }}>
            You're all set!
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, letterSpacing: '0.1em', color: 'var(--arc-muted)' }}>
            <PixelSprite name="coin" size={18} /> Ready to go
          </div>
        </div>
      </ArcadeShell>
    );
  }

  // ── Validating overlay content (shared) ────────────────────────────
  const validatingBlock = (
    <div className="arc-stack arc-fade-in" style={{ gap: 16, padding: '12px 0' }}>
      <PixelSprite name="bolt" size={44} title="Validating" />
      <PixelMarquee cells={20} style={{ width: 280 }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--arc-muted)' }}>
        TESTING LINK…
      </span>
    </div>
  );

  // ── Stage 2: bring-your-own key ────────────────────────────────────
  // Driven by the explicit `step`, not by inferring from form contents.
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
                  ? <>Pick an LLM provider to run on. You can connect MindsHub later in Settings → Providers (needed to publish to the web).</>
                  : mindsNoCredits
                    ? <>Your MindsHub account has no LLM credits yet. Top up to use managed models — or connect your own provider below.</>
                    : <>Your MindsHub key is valid and saved for publishing and connectors, but it has no LLM credits. Top up — or plug in your own provider below.</>}
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
              >← back to sign in</button>

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

  // ── Stage 1: MindsHub ──────────────────────────────────────────────
  return (
    <ArcadeShell title="Sign in" subtitle="sign in or create a free account to continue">
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
            {['Smart model routing', 'Secure data connectors', 'Publish/share dashboards'].map((b) => (
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
                disabled={phase === 'validating'}
                onClick={handleMindsSSO}
              >
                {phase === 'validating' ? 'Signing in…' : 'Sign in with MindsHub'}
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
