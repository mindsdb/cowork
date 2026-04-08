import { useState } from 'react';

type Provider = 'minds' | 'byok';
type ByokProvider = 'anthropic' | 'openai' | 'gemini' | 'openai-compatible';
type Phase = 'choose' | 'validating' | 'success' | 'error';

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

const CUSTOM_MODEL = '__custom__';

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [provider, setProvider] = useState<Provider>('minds');
  const [byokProvider, setByokProvider] = useState<ByokProvider>('anthropic');
  const [selectedModel, setSelectedModel] = useState(ANTHROPIC_MODELS[0].id);
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [mindsUrl, setMindsUrl] = useState('https://mdb.ai');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('choose');
  const [errorMsg, setErrorMsg] = useState('');

  const models = byokProvider === 'anthropic'
    ? ANTHROPIC_MODELS
    : byokProvider === 'gemini'
      ? GEMINI_MODELS
      : byokProvider === 'openai'
        ? OPENAI_MODELS
        : []; // openai-compatible uses custom model only
  const resolvedModel = selectedModel === CUSTOM_MODEL ? customModel.trim() : selectedModel;

  const canConnect =
    provider === 'minds'
      ? apiKey.trim().length > 0 && mindsUrl.trim().length > 0
      : byokProvider === 'openai-compatible'
        ? customBaseUrl.trim().length > 0 && resolvedModel.length > 0
        : apiKey.trim().length > 0 && resolvedModel.length > 0;

  const validationProvider = provider === 'minds'
    ? 'minds'
    : byokProvider === 'anthropic'
      ? 'anthropic'
      : 'openai-compatible';
  const validationBaseUrl =
    provider === 'minds'
      ? mindsUrl.trim()
      : byokProvider === 'openai'
        ? 'https://api.openai.com/v1'
        : byokProvider === 'gemini'
          ? GEMINI_BASE_URL
          : byokProvider === 'openai-compatible'
            ? customBaseUrl.trim()
            : undefined;

  const handleSwitchByokProvider = (bp: ByokProvider) => {
    setByokProvider(bp);
    if (bp === 'anthropic') setSelectedModel(ANTHROPIC_MODELS[0].id);
    else if (bp === 'openai') setSelectedModel(OPENAI_MODELS[0].id);
    else if (bp === 'gemini') setSelectedModel(GEMINI_MODELS[0].id);
    else setSelectedModel(CUSTOM_MODEL);
    setCustomModel('');
    setCustomBaseUrl('');
    setPhase('choose');
    setErrorMsg('');
    setApiKey('');
  };

  const handleConnect = async () => {
    setPhase('validating');
    setErrorMsg('');

    const result = await window.antontron.validateProvider(
      validationProvider,
      apiKey.trim(),
      validationBaseUrl || undefined,
      provider !== 'minds' ? resolvedModel : undefined
    );

    if (!result.ok) {
      setPhase('error');
      setErrorMsg(result.error || 'Validation failed');
      return;
    }

    // Save settings to ~/.anton/.env
    const lines: string[] = [];
    lines.push('ANTON_TERMS_CONSENT=true');
    if (provider === 'minds') {
      const mindsBase = mindsUrl.trim().replace(/\/+$/, '');
      lines.push(`ANTON_OPENAI_API_KEY=${apiKey.trim()}`);
      lines.push(`ANTON_OPENAI_BASE_URL=${mindsBase}/api/v1`);
      lines.push('ANTON_PLANNING_PROVIDER=openai-compatible');
      lines.push('ANTON_CODING_PROVIDER=openai-compatible');
      lines.push('ANTON_PLANNING_MODEL=_reason_');
      lines.push('ANTON_CODING_MODEL=_code_');
      lines.push('ANTON_MINDS_ENABLED=true');
      lines.push(`ANTON_MINDS_API_KEY=${apiKey.trim()}`);
      lines.push(`ANTON_MINDS_URL=${mindsBase}`);
    } else if (byokProvider === 'anthropic') {
      lines.push(`ANTON_ANTHROPIC_API_KEY=${apiKey.trim()}`);
      lines.push('ANTON_PLANNING_PROVIDER=anthropic');
      lines.push('ANTON_CODING_PROVIDER=anthropic');
      lines.push(`ANTON_PLANNING_MODEL=${resolvedModel}`);
      lines.push(`ANTON_CODING_MODEL=${resolvedModel}`);
    } else if (byokProvider === 'gemini') {
      lines.push(`ANTON_OPENAI_API_KEY=${apiKey.trim()}`);
      lines.push(`ANTON_OPENAI_BASE_URL=${GEMINI_BASE_URL}`);
      lines.push('ANTON_PLANNING_PROVIDER=openai-compatible');
      lines.push('ANTON_CODING_PROVIDER=openai-compatible');
      lines.push(`ANTON_PLANNING_MODEL=${resolvedModel}`);
      lines.push(`ANTON_CODING_MODEL=${resolvedModel}`);
    } else if (byokProvider === 'openai-compatible') {
      const key = apiKey.trim() || 'not-needed';
      lines.push(`ANTON_OPENAI_API_KEY=${key}`);
      lines.push(`ANTON_OPENAI_BASE_URL=${customBaseUrl.trim()}`);
      lines.push('ANTON_PLANNING_PROVIDER=openai-compatible');
      lines.push('ANTON_CODING_PROVIDER=openai-compatible');
      lines.push(`ANTON_PLANNING_MODEL=${resolvedModel}`);
      lines.push(`ANTON_CODING_MODEL=${resolvedModel}`);
    } else {
      lines.push(`ANTON_OPENAI_API_KEY=${apiKey.trim()}`);
      lines.push('ANTON_OPENAI_BASE_URL=https://api.openai.com/v1');
      lines.push('ANTON_PLANNING_PROVIDER=openai-compatible');
      lines.push('ANTON_CODING_PROVIDER=openai-compatible');
      lines.push(`ANTON_PLANNING_MODEL=${resolvedModel}`);
      lines.push(`ANTON_CODING_MODEL=${resolvedModel}`);
    }
    lines.push('ANTON_MEMORY_MODE=autopilot');
    lines.push('ANTON_EPISODIC_MEMORY=true');

    await window.antontron.saveSettings(lines.join('\n'));
    setPhase('success');
    setTimeout(onComplete, 800);
  };

  return (
    <div className="onboard-content-inner">
      <div className="onboard-heading">Choose your setup</div>

      {/* Provider cards */}
      <div className="provider-cards">
        <button
          className={`provider-card ${provider === 'minds' ? 'selected' : ''}`}
          onClick={() => { setProvider('minds'); setPhase('choose'); setErrorMsg(''); setApiKey(''); }}
        >
          <span className="recommended-pill">recommended</span>
          <div className="provider-card-name">Minds Cloud</div>
          <div className="provider-card-desc">Managed by MindsDB</div>
          <ul className="provider-card-benefits">
            <li>Smart model routing</li>
            <li>Secure data connectors</li>
            <li>Publish/share dashboards</li>
            <li>Bring your own key <span className="perk-optional">(optional)</span></li>
          </ul>
          <span
            className="provider-card-link"
            onClick={(e) => { e.stopPropagation(); window.antontron.openExternal('https://mdb.ai/auth/realms/mindsdb/protocol/openid-connect/registrations?client_id=public-client&response_type=code&scope=openid&redirect_uri=https%3A%2F%2Fmdb.ai'); }}
          >
            Get a free API key &rarr;
          </span>
        </button>
        <button
          className={`provider-card ${provider === 'byok' ? 'selected' : ''}`}
          onClick={() => { setProvider('byok'); setPhase('choose'); setErrorMsg(''); setApiKey(''); }}
        >
          <div className="provider-card-name">Skip Minds Cloud</div>
          <div className="provider-card-desc">Bring your own LLM provider key</div>
          <div className="byok-icon-area">
            <svg className="byok-key-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </div>
        </button>
      </div>

      {/* Input fields */}
      <div className="onboard-fields">
        {provider === 'byok' && (
          <div className="onboard-field">
            <label className="onboard-label">Select a provider</label>
            <div className="byok-provider-row">
              <button
                type="button"
                className={`byok-provider-btn ${byokProvider === 'anthropic' ? 'selected' : ''}`}
                onClick={() => handleSwitchByokProvider('anthropic')}
              >
                Anthropic
              </button>
              <button
                type="button"
                className={`byok-provider-btn ${byokProvider === 'openai' ? 'selected' : ''}`}
                onClick={() => handleSwitchByokProvider('openai')}
              >
                OpenAI
              </button>
              <button
                type="button"
                className={`byok-provider-btn ${byokProvider === 'gemini' ? 'selected' : ''}`}
                onClick={() => handleSwitchByokProvider('gemini')}
              >
                Gemini
              </button>
              <button
                type="button"
                className={`byok-provider-btn ${byokProvider === 'openai-compatible' ? 'selected' : ''}`}
                onClick={() => handleSwitchByokProvider('openai-compatible')}
              >
                Custom
              </button>
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

        {/* Minds URL hidden during onboarding — defaults to https://mdb.ai */}

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
                onClick={() => window.antontron.openExternal('https://mdb.ai/auth/realms/mindsdb/protocol/openid-connect/registrations?client_id=public-client&response_type=code&scope=openid&redirect_uri=https%3A%2F%2Fmdb.ai')}
              >
                Sign up at mdb.ai for a free key
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Validation status */}
      {phase === 'validating' && (
        <div className="onboard-status">
          <div className="spinner" />
          <span className="onboard-status-text">Validating connection...</span>
        </div>
      )}

      {phase === 'success' && (
        <div className="onboard-status success">
          <span className="onboard-check">{'\u2713'}</span>
          <span className="onboard-status-text">Connected</span>
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
    </div>
  );
}
