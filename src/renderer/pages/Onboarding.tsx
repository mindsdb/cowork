import { useState } from 'react';

type Provider = 'minds' | 'byok';
type ByokProvider = 'anthropic' | 'openai';
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

const CUSTOM_MODEL = '__custom__';

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [provider, setProvider] = useState<Provider>('minds');
  const [byokProvider, setByokProvider] = useState<ByokProvider>('anthropic');
  const [selectedModel, setSelectedModel] = useState(ANTHROPIC_MODELS[0].id);
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [mindsUrl, setMindsUrl] = useState('https://mdb.ai');
  const [phase, setPhase] = useState<Phase>('choose');
  const [errorMsg, setErrorMsg] = useState('');

  const models = byokProvider === 'anthropic' ? ANTHROPIC_MODELS : OPENAI_MODELS;
  const resolvedModel = selectedModel === CUSTOM_MODEL ? customModel.trim() : selectedModel;

  const canConnect =
    provider === 'minds'
      ? apiKey.trim().length > 0 && mindsUrl.trim().length > 0
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
        : undefined;

  const handleSwitchByokProvider = (bp: ByokProvider) => {
    setByokProvider(bp);
    setSelectedModel(bp === 'anthropic' ? ANTHROPIC_MODELS[0].id : OPENAI_MODELS[0].id);
    setCustomModel('');
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
      validationBaseUrl || undefined
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
      lines.push(`ANTON_OPENAI_API_KEY=${apiKey.trim()}`);
      lines.push(`ANTON_OPENAI_BASE_URL=${mindsUrl.trim()}`);
      lines.push('ANTON_PLANNING_PROVIDER=openai-compatible');
      lines.push('ANTON_CODING_PROVIDER=openai-compatible');
      lines.push('ANTON_MINDS_ENABLED=true');
      lines.push(`ANTON_MINDS_API_KEY=${apiKey.trim()}`);
      lines.push(`ANTON_MINDS_URL=${mindsUrl.trim()}`);
    } else if (byokProvider === 'anthropic') {
      lines.push(`ANTON_ANTHROPIC_API_KEY=${apiKey.trim()}`);
      lines.push('ANTON_PLANNING_PROVIDER=anthropic');
      lines.push('ANTON_CODING_PROVIDER=anthropic');
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
    <div className="setup-container">
      <div className="logo-section">
        <pre className="logo-ascii">{`  \u2584\u2580\u2588 \u2588\u2584 \u2588 \u2580\u2588\u2580 \u2588\u2580\u2588 \u2588\u2584 \u2588
  \u2588\u2580\u2588 \u2588 \u2580\u2588  \u2588  \u2588\u2584\u2588 \u2588 \u2580\u2588`}</pre>
        <div className="logo-subtitle">autonomous coworker</div>
      </div>

      <div className="onboard-heading">Choose your LLM provider</div>

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
            <li>Faster responses</li>
            <li>Cost optimized</li>
            <li>Secure data connectors</li>
          </ul>
        </button>
        <button
          className={`provider-card ${provider === 'byok' ? 'selected' : ''}`}
          onClick={() => { setProvider('byok'); setPhase('choose'); setErrorMsg(''); setApiKey(''); }}
        >
          <div className="provider-card-name">Bring Your Own Key</div>
          <div className="provider-card-desc">Anthropic | OpenAI</div>
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
            </div>
          </div>
        )}

        {provider === 'byok' && (
          <div className="onboard-field">
            <label className="onboard-label">Model</label>
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
          </div>
        )}

        {provider === 'minds' && (
          <div className="onboard-field">
            <label className="onboard-label">Minds URL</label>
            <input
              type="text"
              className="settings-input"
              placeholder="https://mdb.ai"
              value={mindsUrl}
              onChange={(e) => setMindsUrl(e.target.value)}
              disabled={phase === 'validating'}
            />
          </div>
        )}

        <div className="onboard-field">
          <label className="onboard-label">
            {provider === 'minds'
              ? 'Minds API Key'
              : byokProvider === 'anthropic'
                ? 'Anthropic API Key'
                : 'OpenAI API Key'}
          </label>
          <input
            type="password"
            className="settings-input"
            placeholder={provider === 'minds'
              ? 'Your Minds API key'
              : byokProvider === 'anthropic'
                ? 'sk-ant-...'
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
