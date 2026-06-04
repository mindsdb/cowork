import OrbitMorph from '../../cowork/components/ui/OrbitMorph';
import { CUSTOM_MODEL } from './constants';
import { canConnectByok, getModelsForProvider } from './helpers';
import type { ByokProvider } from './types';

function CardIcon() {
  return (
    <div style={{
      width: 44,
      height: 44,
      borderRadius: 999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-secondary)',
      alignSelf: 'center',
      marginBottom: 14,
    }}>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    </div>
  );
}

function BenefitRow({ text }: { text: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      fontSize: 13.5,
      lineHeight: 1.5,
      color: 'var(--text-primary)',
    }}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ marginTop: 3, flexShrink: 0 }}
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span>{text}</span>
    </div>
  );
}

export function WelcomeScreen({
  errorMsg,
  onLogin,
  onRegister,
}: {
  errorMsg: string;
  onLogin: () => void;
  onRegister: () => void;
}) {
  return (
    <div className="onboard-content-inner">
      <div className="onboard-heading">Welcome to Anton CoWork</div>
      <div style={{
        fontSize: 13.5,
        color: 'var(--text-muted)',
        lineHeight: 1.6,
        margin: '4px auto 18px',
        maxWidth: 390,
        textAlign: 'center',
        textWrap: 'balance',
      }}>
        Your autonomous coworker. Sign in with MindsHub to get started.
      </div>

      {errorMsg && <div className="error-message">{errorMsg}</div>}

      <button className="btn-primary" onClick={onLogin} style={{ width: '100%', maxWidth: 360 }}>
        CONTINUE WITH MINDSHUB
      </button>

      <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center' }}>
        Don&apos;t have an account?{' '}
        <span className="onboard-link" onClick={onRegister}>
          Sign up for a free week
        </span>
      </div>
    </div>
  );
}

export function SSOPendingScreen({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="onboard-content-inner">
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        padding: '28px 0 12px',
        animation: 'fadeInUp 0.4s ease-out both',
      }}>
        <OrbitMorph state="thinking" size={72} title="Signing in…" />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11.5,
          color: 'var(--text-muted)',
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
        }}>
          Waiting for browser…
        </span>
      </div>
      <div style={{
        fontSize: 12.5,
        color: 'var(--text-muted)',
        lineHeight: 1.55,
        marginBottom: 16,
        maxWidth: 350,
        textAlign: 'center',
        alignSelf: 'center',
        textWrap: 'balance',
      }}>
        Complete the sign-in in your browser. If it didn&apos;t open or
        you&apos;d like to start over, you can cancel below.
      </div>
      <button className="btn-secondary" onClick={onCancel} style={{ width: '100%', maxWidth: 360 }}>
        CANCEL LOGIN
      </button>
    </div>
  );
}

export function SubscribeScreen({
  email,
  onCheckout,
  onUseOwnLLM,
}: {
  email: string;
  onCheckout: () => void;
  onUseOwnLLM: () => void;
}) {
  return (
    <div className="onboard-content-inner">
      <CardIcon />
      <div className="onboard-heading">Get your first week free</div>
      <div style={{
        fontSize: 13.5,
        color: 'var(--text-muted)',
        lineHeight: 1.55,
        margin: '2px auto 10px',
        maxWidth: 440,
        textAlign: 'center',
        textWrap: 'balance',
      }}>
        Add a card to activate your account. Secured by Stripe.
        {email && (
          <span style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
            Signed in as <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>
          </span>
        )}
      </div>

      <div style={{
        width: '100%',
        maxWidth: 440,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--ink-4)',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        marginBottom: 4,
      }}>
        <BenefitRow text="$9.95" />
        <BenefitRow text="No charge today — first week on us" />
        <BenefitRow text="Cancel anytime before your trial ends" />
      </div>

      <div style={{
        fontSize: 11.5,
        color: 'var(--text-muted)',
        margin: '0 auto 8px',
        maxWidth: 440,
        textAlign: 'left',
        width: '100%',
      }}>
        *You&apos;ll be charged $9.95/mo after your trial.
      </div>

      <button className="btn-primary" onClick={onCheckout} style={{ width: '100%', maxWidth: 360 }}>
        START FREE TRIAL
      </button>

      <button
        type="button"
        className="onboard-link onboard-link-button"
        onClick={onUseOwnLLM}
        style={{ marginTop: 8, alignSelf: 'center' }}
      >
        Or, connect your own LLM provider
      </button>
    </div>
  );
}

export function SubscribePendingScreen({
  errorMsg,
  isChecking,
  onBack,
  onCheckoutAgain,
  onRefresh,
}: {
  errorMsg: string;
  isChecking: boolean;
  onBack: () => void;
  onCheckoutAgain: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="onboard-content-inner">
      <CardIcon />
      <div className="onboard-heading">Almost there</div>
      <div style={{
        fontSize: 13.5,
        color: 'var(--text-muted)',
        lineHeight: 1.6,
        margin: '6px auto 20px',
        maxWidth: 440,
        textAlign: 'center',
      }}>
        Finish checkout in your browser. Once you&apos;re subscribed,
        click below and Anton will pick it up.
      </div>

      {errorMsg && <div className="error-message">{errorMsg}</div>}

      <button
        className="btn-primary"
        onClick={onRefresh}
        disabled={isChecking}
        style={{ width: '100%', maxWidth: 360 }}
      >
        {isChecking ? 'CHECKING…' : "I'VE SUBSCRIBED — REFRESH"}
      </button>

      <div className="onboard-secondary-actions" style={{ marginTop: 14 }}>
        <button type="button" className="onboard-link onboard-link-button" onClick={onCheckoutAgain}>
          Open checkout again
        </button>
        <span className="onboard-secondary-divider">·</span>
        <button type="button" className="onboard-link onboard-link-button" onClick={onBack}>
          &larr; Back
        </button>
      </div>
    </div>
  );
}

export function ByokScreen({
  apiKey,
  customBaseUrl,
  customModel,
  errorMsg,
  isLoggedIn,
  onBack,
  onChangeApiKey,
  onChangeBaseUrl,
  onChangeCustomModel,
  onChangeModel,
  onChangeProvider,
  onConnect,
  onSkip,
  provider,
  selectedModel,
}: {
  apiKey: string;
  customBaseUrl: string;
  customModel: string;
  errorMsg: string;
  isLoggedIn: boolean;
  onBack: () => void;
  onChangeApiKey: (value: string) => void;
  onChangeBaseUrl: (value: string) => void;
  onChangeCustomModel: (value: string) => void;
  onChangeModel: (value: string) => void;
  onChangeProvider: (provider: ByokProvider) => void;
  onConnect: () => void;
  onSkip: () => void;
  provider: ByokProvider;
  selectedModel: string;
}) {
  const models = getModelsForProvider(provider);
  const canConnect = canConnectByok(provider, selectedModel, customModel, customBaseUrl, apiKey);

  return (
    <div className="onboard-content-inner">
      <div className="onboard-heading">Choose your LLM provider</div>
      <div style={{
        fontSize: 12.5,
        color: 'var(--text-muted)',
        lineHeight: 1.5,
        margin: '4px auto 2px',
        maxWidth: 456,
        textAlign: 'left',
        width: '100%',
        textWrap: 'balance',
      }}>
        {isLoggedIn
          ? "Pick an LLM provider for Anton to use. You're still signed in to MindsHub, so publishing and data connectors stay available."
          : "Pick an LLM provider for Anton to use. You can sign in to MindsHub later from Settings to unlock publishing and connectors."}
      </div>

      <div className="onboard-secondary-actions">
        <button type="button" className="onboard-link onboard-link-button" onClick={onBack}>
          &larr; Back
        </button>
      </div>

      <div className="onboard-fields">
        <div className="onboard-field">
          <label className="onboard-label">Select a provider</label>
          <div className="byok-provider-row">
            <button type="button" className={`byok-provider-btn ${provider === 'anthropic' ? 'selected' : ''}`} onClick={() => onChangeProvider('anthropic')}>Anthropic</button>
            <button type="button" className={`byok-provider-btn ${provider === 'openai' ? 'selected' : ''}`} onClick={() => onChangeProvider('openai')}>OpenAI</button>
            <button type="button" className={`byok-provider-btn ${provider === 'gemini' ? 'selected' : ''}`} onClick={() => onChangeProvider('gemini')}>Gemini</button>
            <button type="button" className={`byok-provider-btn ${provider === 'openai-compatible' ? 'selected' : ''}`} onClick={() => onChangeProvider('openai-compatible')}>Custom</button>
          </div>
        </div>

        {provider === 'openai-compatible' && (
          <div className="onboard-field">
            <label className="onboard-label">Base URL</label>
            <input
              type="text"
              className="settings-input"
              placeholder="http://localhost:11434/v1"
              value={customBaseUrl}
              onChange={(event) => onChangeBaseUrl(event.target.value)}
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
                onChange={(event) => onChangeModel(event.target.value)}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
                <option value={CUSTOM_MODEL}>Custom...</option>
              </select>
              {selectedModel === CUSTOM_MODEL && (
                <input
                  type="text"
                  className="settings-input model-custom-input"
                  placeholder="Enter model ID..."
                  value={customModel}
                  onChange={(event) => onChangeCustomModel(event.target.value)}
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
              onChange={(event) => onChangeCustomModel(event.target.value)}
            />
          )}
        </div>

        <div className="onboard-field">
          <label className="onboard-label">
            {provider === 'anthropic' ? 'Anthropic API Key'
              : provider === 'gemini' ? 'Google AI API Key'
              : provider === 'openai-compatible' ? 'API Key (optional)'
              : 'OpenAI API Key'}
          </label>
          <input
            type="password"
            className="settings-input"
            placeholder={provider === 'anthropic' ? 'sk-ant-...'
              : provider === 'gemini' ? 'AIza...'
              : provider === 'openai-compatible' ? 'Enter to skip if not needed'
              : 'sk-...'}
            value={apiKey}
            onChange={(event) => onChangeApiKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canConnect) onConnect();
            }}
          />
        </div>
      </div>

      {errorMsg && <div className="error-message">{errorMsg}</div>}

      <button className="btn-primary" disabled={!canConnect} onClick={onConnect}>
        CONNECT
      </button>

      <button
        type="button"
        className="onboard-link onboard-link-button"
        onClick={onSkip}
        style={{ marginTop: 4, alignSelf: 'center' }}
      >
        Skip for now
      </button>
    </div>
  );
}

export function ValidatingPanel({ label }: { label: string }) {
  return (
    <div className="onboard-content-inner">
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        padding: '40px 0',
        animation: 'fadeInUp 0.4s ease-out both',
      }}>
        <OrbitMorph state="thinking" size={72} title={label} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11.5,
          color: 'var(--text-muted)',
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
        }}>
          {label}
        </span>
      </div>
    </div>
  );
}

export function SuccessPanel() {
  return (
    <div className="onboard-content-inner">
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        padding: '40px 0',
        animation: 'fadeInUp 0.4s ease-out both',
      }}>
        <OrbitMorph state="done" size={72} title="Connected" />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11.5,
          color: 'var(--accent, #7CC4B6)',
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
        }}>
          Connected
        </span>
      </div>
    </div>
  );
}
