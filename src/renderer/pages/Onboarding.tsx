import { useState } from 'react';

type Provider = 'minds' | 'byok';
type ByokProvider = 'anthropic' | 'openai';
type Phase = 'choose' | 'validating' | 'success' | 'error';

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [provider, setProvider] = useState<Provider>('minds');
  const [byokProvider, setByokProvider] = useState<ByokProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [mindsUrl, setMindsUrl] = useState('https://mdb.ai');
  const [phase, setPhase] = useState<Phase>('choose');
  const [errorMsg, setErrorMsg] = useState('');

  const canConnect =
    provider === 'minds'
      ? apiKey.trim().length > 0 && mindsUrl.trim().length > 0
      : apiKey.trim().length > 0;

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
      lines.push('ANTON_PLANNING_MODEL=claude-sonnet-4-6');
      lines.push('ANTON_CODING_MODEL=claude-haiku-4-5-20251001');
    } else {
      lines.push(`ANTON_OPENAI_API_KEY=${apiKey.trim()}`);
      lines.push('ANTON_OPENAI_BASE_URL=https://api.openai.com/v1');
      lines.push('ANTON_PLANNING_PROVIDER=openai-compatible');
      lines.push('ANTON_CODING_PROVIDER=openai-compatible');
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
        <pre className="logo-ascii">{`  ▄▀█ █▄ █ ▀█▀ █▀█ █▄ █
  █▀█ █ ▀█  █  █▄█ █ ▀█`}</pre>
        <div className="logo-subtitle">autonomous coworker</div>
      </div>

      <div className="onboard-heading">Choose your LLM provider</div>

      {/* Provider cards */}
      <div className="provider-cards">
        <button
          className={`provider-card ${provider === 'minds' ? 'selected' : ''}`}
          onClick={() => { setProvider('minds'); setPhase('choose'); setErrorMsg(''); setApiKey(''); }}
        >
          <div className="provider-card-name">Minds Cloud</div>
          <div className="provider-card-desc">Managed by MindsDB</div>
        </button>
        <button
          className={`provider-card ${provider === 'byok' ? 'selected' : ''}`}
          onClick={() => { setProvider('byok'); setPhase('choose'); setErrorMsg(''); setApiKey(''); }}
        >
          <div className="provider-card-name">Bring Your Own Key</div>
          <div className="provider-card-desc">Anthropic | OpenAI</div>
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
                onClick={() => { setByokProvider('anthropic'); setPhase('choose'); setErrorMsg(''); setApiKey(''); }}
              >
                Anthropic
              </button>
              <button
                type="button"
                className={`byok-provider-btn ${byokProvider === 'openai' ? 'selected' : ''}`}
                onClick={() => { setByokProvider('openai'); setPhase('choose'); setErrorMsg(''); setApiKey(''); }}
              >
                OpenAI
              </button>
            </div>
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
