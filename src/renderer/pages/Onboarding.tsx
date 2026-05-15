import { useState } from 'react';
import { host } from '../platform/host';
import OrbitMorph from '../cowork/components/ui/OrbitMorph';

type Provider = 'minds' | 'byok';
type ByokProvider = 'anthropic' | 'openai' | 'gemini' | 'openai-compatible';
type Phase = 'choose' | 'validating' | 'minds-no-llm' | 'success' | 'error';

const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

const OPENAI_MODELS = [
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'o3', label: 'o3' },
  { id: 'o4-mini', label: 'o4 Mini' },
];

const GEMINI_MODELS = [
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const MINDS_REGISTER_URL = 'https://auth.mindshub.ai/auth/realms/mindsdb/protocol/openid-connect/registrations?client_id=public-client&response_type=code&scope=openid&redirect_uri=https%3A%2F%2Fconsole.mindshub.ai';

const CUSTOM_MODEL = '__custom__';

function StepIndicator({ step }: { step: 1 | 2 }) {
  const dot = (n: 1 | 2) => ({
    width: 22, height: 22, borderRadius: 999,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 700,
    color: step === n ? 'var(--text-strong)' : 'var(--text-muted)',
    background: step === n ? 'rgba(124,196,182,0.18)' : 'transparent',
    border: `1px solid ${step === n ? 'rgba(124,196,182,0.55)' : 'var(--border-subtle)'}`,
  });
  const bar = {
    flex: 1, height: 1, background: 'var(--border-subtle)',
    margin: '0 8px',
  } as const;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      width: 200, margin: '0 auto 20px',
      fontFamily: 'var(--font-mono)',
    }}>
      <span style={dot(1)}>1</span>
      <span style={bar} />
      <span style={dot(2)}>2</span>
    </div>
  );
}

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [provider, setProvider] = useState<Provider>('minds');
  const [byokProvider, setByokProvider] = useState<ByokProvider>('anthropic');
  const [selectedModel, setSelectedModel] = useState(ANTHROPIC_MODELS[0].id);
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [mindsUrl, setMindsUrl] = useState('https://api.mindshub.ai');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('choose');
  const [errorMsg, setErrorMsg] = useState('');
  // True when the user clicked "Skip MindsHub" on step 1, so step 2
  // shows a different lead-in note than the "Minds key valid, no LLM
  // credits" path.
  const [skippedMinds, setSkippedMinds] = useState(false);

  const models = byokProvider === 'anthropic'
    ? ANTHROPIC_MODELS
    : byokProvider === 'gemini'
      ? GEMINI_MODELS
      : byokProvider === 'openai'
        ? OPENAI_MODELS
        : []; // openai-compatible uses custom model only
  const resolvedModel = selectedModel === CUSTOM_MODEL ? customModel.trim() : selectedModel;

  // For the initial Minds/BYOK connect
  const canConnect =
    provider === 'minds'
      ? apiKey.trim().length > 0
      : byokProvider === 'openai-compatible'
        ? customBaseUrl.trim().length > 0 && resolvedModel.length > 0
        : apiKey.trim().length > 0 && resolvedModel.length > 0;

  // For the LLM provider connect in minds-no-llm phase
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
    lines.push('ANTON_MEMORY_MODE=autopilot');
    lines.push('ANTON_EPISODIC_MEMORY=true');
    await host.saveSettings(lines.join('\n'));
    setPhase('success');
    setTimeout(onComplete, 800);
  };

  const handleConnect = async () => {
    setPhase('validating');
    setErrorMsg('');

    if (provider === 'minds') {
      // Step 1: Validate the Minds API key
      const mindsBase = mindsUrl.trim().replace(/\/+$/, '');
      const result = await host.validateProvider('minds', apiKey.trim(), mindsBase);
      if (!result.ok) {
        setPhase('error');
        setErrorMsg(result.error || 'Invalid API key');
        return;
      }

      // Step 2: Save Minds vars (so publish/dashboards work regardless)
      const mindsLines = [
        'ANTON_TERMS_CONSENT=true',
        `ANTON_MINDS_ENABLED=true`,
        `ANTON_MINDS_API_KEY=${apiKey.trim()}`,
        `ANTON_MINDS_URL=${mindsBase}`,
      ];

      // Step 3: Test if LLM credits are available
      const llmResult = await host.validateProvider(
        'openai-compatible',
        apiKey.trim(),
        `${mindsBase}/api/v1`,
        '_code_'
      );

      if (llmResult.ok) {
        // Full Minds setup — LLM works
        const lines = [
          ...mindsLines,
          `ANTON_OPENAI_API_KEY=${apiKey.trim()}`,
          `ANTON_OPENAI_BASE_URL=${mindsBase}/api/v1`,
          'ANTON_PLANNING_PROVIDER=openai-compatible',
          'ANTON_CODING_PROVIDER=openai-compatible',
          'ANTON_PLANNING_MODEL=_reason_',
          'ANTON_CODING_MODEL=_code_',
        ];
        await saveFinal(lines);
      } else {
        // Minds key valid but no LLM — save Minds vars, ask for LLM provider
        await host.saveSettings(mindsLines.join('\n'));
        setPhase('minds-no-llm');
      }
    } else {
      // Direct BYOK flow
      const validationProvider = byokProvider === 'anthropic' ? 'anthropic' : 'openai-compatible';
      const validationBaseUrl =
        byokProvider === 'openai'
          ? 'https://api.openai.com/v1'
          : byokProvider === 'gemini'
            ? GEMINI_BASE_URL
            : byokProvider === 'openai-compatible'
              ? customBaseUrl.trim()
              : undefined;

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

      const lines: string[] = ['ANTON_TERMS_CONSENT=true'];
      if (byokProvider === 'anthropic') {
        lines.push(`ANTON_ANTHROPIC_API_KEY=${apiKey.trim()}`);
        lines.push('ANTON_PLANNING_PROVIDER=anthropic');
        lines.push('ANTON_CODING_PROVIDER=anthropic');
      } else if (byokProvider === 'gemini') {
        lines.push(`ANTON_OPENAI_API_KEY=${apiKey.trim()}`);
        lines.push(`ANTON_OPENAI_BASE_URL=${GEMINI_BASE_URL}`);
        lines.push('ANTON_PLANNING_PROVIDER=openai-compatible');
        lines.push('ANTON_CODING_PROVIDER=openai-compatible');
      } else if (byokProvider === 'openai-compatible') {
        lines.push(`ANTON_OPENAI_API_KEY=${apiKey.trim() || 'not-needed'}`);
        lines.push(`ANTON_OPENAI_BASE_URL=${customBaseUrl.trim()}`);
        lines.push('ANTON_PLANNING_PROVIDER=openai-compatible');
        lines.push('ANTON_CODING_PROVIDER=openai-compatible');
      } else {
        lines.push(`ANTON_OPENAI_API_KEY=${apiKey.trim()}`);
        lines.push('ANTON_OPENAI_BASE_URL=https://api.openai.com/v1');
        lines.push('ANTON_PLANNING_PROVIDER=openai-compatible');
        lines.push('ANTON_CODING_PROVIDER=openai-compatible');
      }
      lines.push(`ANTON_PLANNING_MODEL=${resolvedModel}`);
      lines.push(`ANTON_CODING_MODEL=${resolvedModel}`);
      await saveFinal(lines);
    }
  };

  const handleConnectLlm = async () => {
    setPhase('validating');
    setErrorMsg('');

    const validationProvider = byokProvider === 'anthropic' ? 'anthropic' : 'openai-compatible';
    const validationBaseUrl =
      byokProvider === 'openai'
        ? 'https://api.openai.com/v1'
        : byokProvider === 'gemini'
          ? GEMINI_BASE_URL
          : byokProvider === 'openai-compatible'
            ? customBaseUrl.trim()
            : undefined;
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

    // Read existing settings (has Minds vars) and add LLM vars
    const existing = await host.readSettings();
    const merged = { ...existing };

    if (byokProvider === 'anthropic') {
      merged.ANTON_ANTHROPIC_API_KEY = llmApiKey.trim();
      merged.ANTON_PLANNING_PROVIDER = 'anthropic';
      merged.ANTON_CODING_PROVIDER = 'anthropic';
    } else if (byokProvider === 'gemini') {
      merged.ANTON_OPENAI_API_KEY = llmApiKey.trim();
      merged.ANTON_OPENAI_BASE_URL = GEMINI_BASE_URL;
      merged.ANTON_PLANNING_PROVIDER = 'openai-compatible';
      merged.ANTON_CODING_PROVIDER = 'openai-compatible';
    } else if (byokProvider === 'openai-compatible') {
      merged.ANTON_OPENAI_API_KEY = key;
      merged.ANTON_OPENAI_BASE_URL = customBaseUrl.trim();
      merged.ANTON_PLANNING_PROVIDER = 'openai-compatible';
      merged.ANTON_CODING_PROVIDER = 'openai-compatible';
    } else {
      merged.ANTON_OPENAI_API_KEY = llmApiKey.trim();
      merged.ANTON_OPENAI_BASE_URL = 'https://api.openai.com/v1';
      merged.ANTON_PLANNING_PROVIDER = 'openai-compatible';
      merged.ANTON_CODING_PROVIDER = 'openai-compatible';
    }
    merged.ANTON_PLANNING_MODEL = resolvedModel;
    merged.ANTON_CODING_MODEL = resolvedModel;
    merged.ANTON_MEMORY_MODE = merged.ANTON_MEMORY_MODE || 'autopilot';
    merged.ANTON_EPISODIC_MEMORY = merged.ANTON_EPISODIC_MEMORY || 'true';

    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    await host.saveSettings(lines.join('\n'));
    setPhase('success');
    setTimeout(onComplete, 800);
  };

  // Step 2: BYOK LLM provider selection. Covers two entry points —
  //   1) `minds-no-llm` after a Minds validation succeeded but no LLM
  //      credits, or after the user clicked Skip MindsHub.
  //   2) validating phase while the user is on step 2 (so the
  //      spinner shows in the step-2 layout instead of falling
  //      through to step 1).
  if (phase === 'minds-no-llm'
      || (phase === 'validating' && provider === 'byok')
      || (phase === 'validating' && provider === 'minds' && apiKey)) {
    const showLlmForm = phase === 'minds-no-llm';
    return (
      <div className="onboard-content-inner">
        {phase === 'validating' && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 14, padding: '28px 0',
            animation: 'fadeInUp 0.4s ease-out both',
          }}>
            <OrbitMorph state="thinking" size={72} title="Validating…" />
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11.5,
              color: 'var(--text-muted)', letterSpacing: '0.10em',
              textTransform: 'uppercase',
            }}>Validating LLM provider…</span>
          </div>
        )}

        {showLlmForm && (
          <>
            <StepIndicator step={2} />
            <div className="onboard-heading">Choose your LLM provider</div>
            <div style={{
              fontSize: 12.5, color: 'var(--text-muted)',
              lineHeight: 1.5, marginBottom: 4,
              maxWidth: 456, textAlign: 'left',
            }}>
              {skippedMinds
                ? 'You skipped MindsHub. Pick an LLM provider for Anton to use. You can add MindsHub later from Settings → Providers — it\'s required to publish artifacts to the web.'
                : 'Your MindsHub API key is valid and saved for publishing and data connectors. However, you don\'t seem to have LLM credits. Top up your balance or pick an LLM provider below.'}
            </div>

            <button
              type="button"
              className="onboard-link"
              onClick={() => {
                // Back to step 1: reset to the Minds-first state.
                setProvider('minds');
                setPhase('choose');
                setSkippedMinds(false);
                setErrorMsg('');
                setLlmApiKey('');
              }}
              style={{
                background: 'transparent', border: 0, padding: 0,
                fontSize: 12.5, color: 'var(--text-muted)',
                cursor: 'pointer', marginBottom: 12,
                textAlign: 'left',
              }}
            >&larr; Back to MindsHub setup</button>

            <div className="onboard-fields">
              <div className="onboard-field">
                <label className="onboard-label">Select a provider</label>
                <div className="byok-provider-row">
                  <button type="button" className={`byok-provider-btn ${byokProvider === 'anthropic' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('anthropic')}>Anthropic</button>
                  <button type="button" className={`byok-provider-btn ${byokProvider === 'openai' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('openai')}>OpenAI</button>
                  <button type="button" className={`byok-provider-btn ${byokProvider === 'gemini' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('gemini')}>Gemini</button>
                  <button type="button" className={`byok-provider-btn ${byokProvider === 'openai-compatible' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('openai-compatible')}>Custom</button>
                </div>
              </div>

              {byokProvider === 'openai-compatible' && (
                <div className="onboard-field">
                  <label className="onboard-label">Base URL</label>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="http://localhost:11434/v1"
                    value={customBaseUrl}
                    onChange={(e) => { setCustomBaseUrl(e.target.value); setErrorMsg(''); }}
                  />
                  <div className="settings-hint">Ollama, vLLM, Together, Groq, LM Studio, etc.</div>
                </div>
              )}

              <div className="onboard-field">
                <label className="onboard-label">Model</label>
                {models.length > 0 ? (
                  <>
                    <select
                      className="settings-select"
                      value={selectedModel}
                      onChange={(e) => { setSelectedModel(e.target.value); setErrorMsg(''); }}
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                      <option value={CUSTOM_MODEL}>Custom...</option>
                    </select>
                    {selectedModel === CUSTOM_MODEL && (
                      <input
                        type="text"
                        className="settings-input model-custom-input"
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
                    className="settings-input"
                    placeholder="Enter model name..."
                    value={customModel}
                    onChange={(e) => { setCustomModel(e.target.value); setErrorMsg(''); }}
                  />
                )}
              </div>

              <div className="onboard-field">
                <label className="onboard-label">
                  {byokProvider === 'anthropic' ? 'Anthropic API Key'
                    : byokProvider === 'gemini' ? 'Google AI API Key'
                    : byokProvider === 'openai-compatible' ? 'API Key (optional)'
                    : 'OpenAI API Key'}
                </label>
                <input
                  type="password"
                  className="settings-input"
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

            {errorMsg && <div className="error-message">{errorMsg}</div>}

            <button
              className="btn-primary"
              disabled={!canConnectLlm}
              onClick={handleConnectLlm}
            >
              CONNECT
            </button>
          </>
        )}
      </div>
    );
  }

  // Step 1: MindsHub setup. The previous combined "Choose your setup"
  // screen has been split — BYOK lives in step 2 (the existing
  // minds-no-llm branch). A "Skip MindsHub" link jumps straight to it.
  return (
    <div className="onboard-content-inner">
      <StepIndicator step={1} />
      <div className="onboard-heading">Connect MindsHub</div>

      {/* Single info card — the BYOK ("Skip Minds Cloud") card from
          the original two-card chooser is gone in the split flow;
          users skip via the dedicated link below the Connect button. */}
      <div className="provider-cards" style={{ maxWidth: 456 }}>
        <div className="provider-card selected" style={{ cursor: 'default' }}>
          <span className="recommended-pill">recommended</span>
          <div className="provider-card-name">MindsHub</div>
          <div className="provider-card-desc">Managed by MindsDB</div>
          <ul className="provider-card-benefits">
            <li>Smart model routing</li>
            <li>Secure data connectors</li>
            <li>Publish/share dashboards</li>
          </ul>
          <span
            className="provider-card-link"
            onClick={(e) => { e.stopPropagation(); host.openExternal(MINDS_REGISTER_URL); }}
          >
            Get your first week free &rarr;
          </span>
        </div>
      </div>

      {/* Input fields */}
      <div className="onboard-fields">
        {false && provider === 'byok' && (
          <div className="onboard-field">
            <label className="onboard-label">Select a provider</label>
            <div className="byok-provider-row">
              <button type="button" className={`byok-provider-btn ${byokProvider === 'anthropic' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('anthropic')}>Anthropic</button>
              <button type="button" className={`byok-provider-btn ${byokProvider === 'openai' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('openai')}>OpenAI</button>
              <button type="button" className={`byok-provider-btn ${byokProvider === 'gemini' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('gemini')}>Gemini</button>
              <button type="button" className={`byok-provider-btn ${byokProvider === 'openai-compatible' ? 'selected' : ''}`} onClick={() => handleSwitchByokProvider('openai-compatible')}>Custom</button>
            </div>
          </div>
        )}

        {provider === 'byok' && byokProvider === 'openai-compatible' && (
          <div className="onboard-field">
            <label className="onboard-label">Base URL</label>
            <input
              type="text"
              className="settings-input"
              placeholder="http://localhost:11434/v1"
              value={customBaseUrl}
              onChange={(e) => { setCustomBaseUrl(e.target.value); setPhase('choose'); setErrorMsg(''); }}
              disabled={phase === 'validating'}
            />
            <div className="settings-hint">Ollama, vLLM, Together, Groq, LM Studio, etc.</div>
          </div>
        )}

        {provider === 'byok' && (
          <div className="onboard-field">
            <label className="onboard-label">Model</label>
            {models.length > 0 ? (
              <>
                <select
                  className="settings-select"
                  value={selectedModel}
                  onChange={(e) => { setSelectedModel(e.target.value); setPhase('choose'); setErrorMsg(''); }}
                  disabled={phase === 'validating'}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                  <option value={CUSTOM_MODEL}>Custom...</option>
                </select>
                {selectedModel === CUSTOM_MODEL && (
                  <input
                    type="text"
                    className="settings-input model-custom-input"
                    placeholder="Enter model ID..."
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    disabled={phase === 'validating'}
                    autoFocus
                  />
                )}
              </>
            ) : (
              <input
                type="text"
                className="settings-input"
                placeholder="Enter model name..."
                value={customModel}
                onChange={(e) => { setCustomModel(e.target.value); setPhase('choose'); setErrorMsg(''); }}
                disabled={phase === 'validating'}
              />
            )}
          </div>
        )}

        <div className="onboard-field">
          <label className="onboard-label">
            {provider === 'minds'
              ? 'Minds Cloud API Key'
              : byokProvider === 'anthropic'
                ? 'Anthropic API Key'
                : byokProvider === 'gemini'
                  ? 'Google AI API Key'
                  : byokProvider === 'openai-compatible'
                    ? 'API Key (optional)'
                    : 'OpenAI API Key'}
          </label>
          <input
            type="password"
            className="settings-input"
            placeholder={provider === 'minds'
              ? 'Your Minds Cloud API key'
              : byokProvider === 'anthropic'
                ? 'sk-ant-...'
                : byokProvider === 'gemini'
                  ? 'AIza...'
                  : byokProvider === 'openai-compatible'
                    ? 'Enter to skip if not needed'
                    : 'sk-...'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={phase === 'validating'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canConnect && phase !== 'validating') {
                handleConnect();
              }
            }}
          />
          {provider === 'minds' && (
            <div className="settings-hint">
              Don't have a key?{' '}
              <span
                className="onboard-link"
                onClick={() => host.openExternal(MINDS_REGISTER_URL)}
              >
                Sign up at mindshub.ai for a free week
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Validation status */}
      {phase === 'validating' && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 14, padding: '20px 0 8px',
          animation: 'fadeInUp 0.4s ease-out both',
        }}>
          <OrbitMorph state="thinking" size={64} title="Validating\u2026" />
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11.5,
            color: 'var(--text-muted)', letterSpacing: '0.10em',
            textTransform: 'uppercase',
          }}>Validating connection\u2026</span>
        </div>
      )}

      {phase === 'success' && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 14, padding: '20px 0 8px',
          animation: 'fadeInUp 0.4s ease-out both',
        }}>
          <OrbitMorph state="done" size={64} title="Connected" />
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11.5,
            color: 'var(--accent, #7CC4B6)', letterSpacing: '0.10em',
            textTransform: 'uppercase',
          }}>Connected</span>
        </div>
      )}

      {phase === 'error' && (
        <div className="error-message">{errorMsg}</div>
      )}

      {/* Connect button */}
      {phase !== 'success' && (
        <button
          className="btn-primary"
          disabled={!canConnect || phase === 'validating'}
          onClick={handleConnect}
        >
          {phase === 'validating' ? 'CONNECTING...' : 'CONNECT'}
        </button>
      )}

      {/* Skip MindsHub → jump straight to step 2 (BYOK). */}
      {phase !== 'success' && phase !== 'validating' && (
        <button
          type="button"
          className="onboard-link"
          onClick={() => {
            setProvider('byok');
            setApiKey('');
            setErrorMsg('');
            setSkippedMinds(true);
            setPhase('minds-no-llm');
          }}
          style={{
            background: 'transparent', border: 0, padding: 0,
            marginTop: 14,
            fontSize: 12.5, color: 'var(--text-muted)',
            cursor: 'pointer',
            alignSelf: 'center',
          }}
        >Skip MindsHub &rarr; bring my own LLM provider</button>
      )}
    </div>
  );
}
