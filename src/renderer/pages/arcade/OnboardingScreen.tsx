// Provider onboarding ("POWER UP"), arcade edition.
//
// The logic is a 1:1 port of the previous Onboarding page — same phase
// machine (choose / validating / minds-no-llm / success / error), same
// host calls, same .env lines, same backend sync — re-skinned as the
// stage where you plug a power source into the coworker you just chose.

import { useState, useEffect, useRef } from 'react';
import { host } from '../../platform/host';
import { BASE } from '../../cowork/api';
import { PROVIDER_MODELS } from '../../cowork/lib/settingsTransform';
import { MINDS_API_BASE, MINDS_REGISTER_URL } from '../../lib/mindsUrls';
import { ArcadeShell, PixelMarquee } from './components';
import { PixelSprite, type SpriteName } from './sprites';

type Provider = 'minds' | 'byok';
type ByokProvider = 'anthropic' | 'openai' | 'gemini' | 'openai-compatible';
type Phase = 'choose' | 'validating' | 'minds-no-llm' | 'success' | 'error';

const ANTHROPIC_MODELS = PROVIDER_MODELS.anthropic;
const OPENAI_MODELS = PROVIDER_MODELS.openai;
const GEMINI_MODELS = PROVIDER_MODELS.gemini;

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

const CUSTOM_MODEL = '__custom__';

// Env-var names (ANTON_FOO_BAR) → backend setting keys (foo_bar).
const ENV_TO_SETTING: Record<string, string> = {
  ANTON_ANTHROPIC_API_KEY: 'anthropic_api_key',
  ANTON_OPENAI_API_KEY: 'openai_api_key',
  ANTON_OPENAI_BASE_URL: 'openai_base_url',
  ANTON_MINDS_API_KEY: 'minds_api_key',
  ANTON_MINDS_URL: 'minds_url',
  ANTON_PLANNING_PROVIDER: 'planning_provider',
  ANTON_CODING_PROVIDER: 'coding_provider',
  ANTON_PLANNING_MODEL: 'planning_model',
  ANTON_CODING_MODEL: 'coding_model',
  ANTON_MEMORY_MODE: 'memory_mode',
  ANTON_EPISODIC_MEMORY: 'episodic_memory',
};

/** Push onboarding settings to the cowork-server backend DB. */
async function syncToBackend(lines: string[]): Promise<void> {
  // The .env always writes "openai-compatible" for both MindsHub and
  // generic endpoints; the backend Provider enum distinguishes
  // "minds_cloud" from "openai_compatible", so map based on whether a
  // Minds key is present.
  const envMap: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    envMap[line.slice(0, eq)] = line.slice(eq + 1);
  }
  const hasMindKey = Boolean(envMap.ANTON_MINDS_API_KEY);

  for (const [envKey, value] of Object.entries(envMap)) {
    const settingKey = ENV_TO_SETTING[envKey];
    if (!settingKey) continue;
    let dbValue = value;
    if (settingKey.endsWith('_provider')) {
      if (dbValue === 'openai-compatible' && hasMindKey) {
        dbValue = 'minds_cloud';
      } else {
        dbValue = dbValue.replace(/-/g, '_');
      }
    }
    try {
      await fetch(`${BASE}/settings/${encodeURIComponent(settingKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: dbValue }),
      });
    } catch {
      // Best-effort — the .env is the source of truth for the Electron
      // main process; the backend picks it up on next restart.
    }
  }
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

function StageDots({ step }: { step: 1 | 2 }) {
  const dot = (n: 1 | 2): React.CSSProperties => ({
    width: 24, height: 24,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 700, borderRadius: 3,
    color: step === n ? 'var(--arc-bg)' : 'var(--arc-dim)',
    background: step === n ? 'var(--arc-cyan)' : 'transparent',
    border: `1px solid ${step === n ? 'var(--arc-cyan)' : 'var(--arc-edge-2)'}`,
    boxShadow: step === n ? '0 0 14px color-mix(in srgb, var(--arc-cyan) 40%, transparent)' : 'none',
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }} aria-label={`Stage ${step} of 2`}>
      <span style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--arc-dim)', marginRight: 4 }}>STAGE</span>
      <span style={dot(1)}>1</span>
      <span style={{ width: 28, height: 1, background: 'var(--arc-edge-2)' }} />
      <span style={dot(2)}>2</span>
    </div>
  );
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
  const [selectedModel, setSelectedModel] = useState(ANTHROPIC_MODELS[0].id);
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [mindsUrl] = useState(MINDS_API_BASE);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('choose');
  const [errorMsg, setErrorMsg] = useState('');
  const [skippedMinds, setSkippedMinds] = useState(false);
  // Which stage's layout to render. Decoupled from `phase` so the
  // validating spinner shows in the right place without inferring it
  // from whether the API-key field happens to be non-empty.
  const [step, setStep] = useState<'minds' | 'byok'>('minds');
  // Latches once onboarding finalizes so the web Keycloak auto-finalize
  // effect (which re-runs on `provider` toggles) can't double-save /
  // double-fire onComplete.
  const finalizedRef = useRef(false);

  const models = byokProvider === 'anthropic'
    ? ANTHROPIC_MODELS
    : byokProvider === 'gemini'
      ? GEMINI_MODELS
      : byokProvider === 'openai'
        ? OPENAI_MODELS
        : [];
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
    if (bp === 'anthropic') setSelectedModel(ANTHROPIC_MODELS[0].id);
    else if (bp === 'openai') setSelectedModel(OPENAI_MODELS[0].id);
    else if (bp === 'gemini') setSelectedModel(GEMINI_MODELS[0].id);
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
    await syncToBackend(lines);
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

      const llmResult = await host.validateProvider(
        'openai-compatible',
        apiKey.trim(),
        `${mindsBase}/v1`,
        '_code_'
      );

      if (llmResult.ok) {
        const lines = [
          ...mindsLines,
          'ANTON_PLANNING_PROVIDER=minds-cloud',
          'ANTON_CODING_PROVIDER=minds-cloud',
          'ANTON_PLANNING_MODEL=_reason_',
          'ANTON_CODING_MODEL=_code_',
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

    const result = await host.validateProvider(
      validationProvider,
      key,
      validationBaseUrl || undefined,
      resolvedModel
    );

    if (!result.ok) {
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

    if (finalizedRef.current) return;
    finalizedRef.current = true;
    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    await host.saveSettings(lines.join('\n'));
    await syncToBackend(lines);
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
      setErrorMsg('Sign in cancelled or failed. Please try again.');
      return;
    }
    const finalizeResult = await host.mindshubFinalize();
    if (!finalizeResult.ok) {
      setPhase('error');
      setErrorMsg(finalizeResult.reason || 'Failed to set up MindsHub. Please try again.');
      return;
    }
    const lines = [
      'ANTON_TERMS_CONSENT=true',
      'ANTON_MINDS_ENABLED=true',
      'ANTON_MINDS_URL=https://api.mindshub.ai',
      'ANTON_PLANNING_PROVIDER=minds-cloud',
      'ANTON_CODING_PROVIDER=minds-cloud',
      'ANTON_PLANNING_MODEL=latest:sonnet',
      'ANTON_CODING_MODEL=latest:haiku',
    ];
    if (finalizeResult.apiKey) {
      lines.push(`ANTON_MINDS_API_KEY=${finalizeResult.apiKey}`);
      lines.push(`ANTON_OPENAI_API_KEY=${finalizeResult.apiKey}`);
      lines.push(`ANTON_OPENAI_BASE_URL=https://api.mindshub.ai/v1`);
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
      saveFinal([
        'ANTON_TERMS_CONSENT=true',
        'ANTON_MINDS_ENABLED=true',
        'ANTON_MINDS_URL=https://api.mindshub.ai',
        'ANTON_PLANNING_PROVIDER=minds-cloud',
        'ANTON_CODING_PROVIDER=minds-cloud',
        'ANTON_PLANNING_MODEL=latest:sonnet',
        'ANTON_CODING_MODEL=latest:haiku',
      ]);
    });
    return () => { cancelled = true; };
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Victory ────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <ArcadeShell title="POWER UP" subtitle="connect a power source">
        <div className="arc-stack arc-pop" style={{ gap: 18 }}>
          <PixelSprite name={coworker.sprite} size={84} bob title={coworker.label} />
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--arc-green)' }}>
            {coworker.label} JOINS YOUR PARTY!
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, letterSpacing: '0.1em', color: 'var(--arc-muted)' }}>
            <PixelSprite name="coin" size={18} /> POWER SOURCE CONNECTED
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
      <ArcadeShell title="POWER UP" subtitle={`choose a power source for ${coworker.label.toLowerCase()}`}>
        <div className="arc-stack arc-fade-in" style={{ gap: 18, width: 'min(480px, 100%)' }}>
          {phase === 'validating' && validatingBlock}

          {showLlmForm && (
            <>
              <StageDots step={2} />

              <div style={{ fontSize: 11.5, lineHeight: 1.65, letterSpacing: '0.03em', color: 'var(--arc-muted)', textAlign: 'center' }}>
                {skippedMinds
                  ? <>GUEST MODE — pick an LLM provider for {coworker.label} to run on. You can add MindsHub later in Settings → Providers (needed to publish artifacts to the web).</>
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
              >← back to MindsHub setup</button>

              <div className="arc-panel" style={{ width: '100%', boxSizing: 'border-box', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18, textAlign: 'left' }}>
                <div>
                  <label className="arc-label">Select a power source</label>
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
                ⚡ CONNECT
              </button>
            </>
          )}
        </div>
      </ArcadeShell>
    );
  }

  // ── Stage 1: MindsHub ──────────────────────────────────────────────
  return (
    <ArcadeShell title="POWER UP" subtitle={`connect a power source for ${coworker.label.toLowerCase()}`}>
      <div className="arc-stack arc-fade-in" style={{ gap: 18, width: 'min(480px, 100%)' }}>
        <StageDots step={1} />

        <div className="arc-panel" style={{ width: '100%', boxSizing: 'border-box', padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'left', borderColor: 'color-mix(in srgb, var(--arc-cyan) 35%, transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <PixelSprite name="bolt" size={26} title="MindsHub" />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--arc-ink)' }}>MINDSHUB</div>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--arc-dim)', marginTop: 2 }}>MANAGED BY MINDSDB</div>
              </div>
            </div>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
              color: 'var(--arc-bg)', background: 'var(--arc-cyan)',
              borderRadius: 3, padding: '3px 8px', flex: 'none',
            }}>RECOMMENDED</span>
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
                {phase === 'validating' ? 'SIGNING IN…' : '▶ SIGN IN WITH MINDSHUB'}
              </button>
              <div style={{ fontSize: 10.5, letterSpacing: '0.05em', color: 'var(--arc-dim)', textAlign: 'center' }}>
                No account?{' '}
                <button
                  type="button"
                  className="arc-link"
                  onClick={() => host.openExternal(MINDS_REGISTER_URL)}
                >Insert coin — first week free →</button>
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
                {phase === 'validating' ? 'CONNECTING…' : '⚡ CONNECT'}
              </button>
              <div style={{ fontSize: 10.5, letterSpacing: '0.05em', color: 'var(--arc-dim)', textAlign: 'center' }}>
                No account?{' '}
                <button
                  type="button"
                  className="arc-link"
                  onClick={() => host.openExternal(MINDS_REGISTER_URL)}
                >Insert coin — first week free →</button>
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
          >GUEST MODE → bring my own LLM key</button>
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
