// Dev-only login form (VITE_DEV_LOGIN=true). Authenticates via Keycloak's
// Resource Owner Password Credentials (ROPC) grant through the Vite /auth
// proxy, so no registered redirect URI is needed. Rendered only under
// `vite dev`; never reachable in a production bundle (see resolveWebAuthMode).

import { useState } from 'react';

import { DEV_AUTH_STORAGE_KEY, type DevTokens } from './devAuth';

interface DevLoginFormProps {
  clientId: string;
  tokenEndpoint: string;
  onSuccess: (tokens: DevTokens) => void;
}

export default function DevLoginForm({
  clientId,
  tokenEndpoint,
  onSuccess,
}: DevLoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: clientId,
          username: email,
          password,
          scope: 'openid',
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.error_description || `Login failed (${response.status})`,
        );
      }

      const data = await response.json();
      if (!data.access_token) {
        throw new Error(
          'Server returned 200 but no access_token. Check the /auth proxy in vite.config.ts.',
        );
      }

      const tokens: DevTokens = {
        token: data.access_token,
        refreshToken: data.refresh_token,
        idToken: data.id_token,
      };
      localStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(tokens));
      onSuccess(tokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid var(--border-01, #33415580)',
    background: 'var(--surface-1, #0f1729)',
    color: 'var(--text-strong, #e6edf6)',
    fontSize: 14,
    outline: 'none',
  };

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface-0, #0a0f1c)',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          borderRadius: 12,
          border: '1px solid var(--border-01, #33415580)',
          background: 'var(--surface-1, #0f1729)',
          padding: 28,
          boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,.4))',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span
            style={{
              display: 'inline-block',
              borderRadius: 999,
              background: 'rgba(251, 191, 36, .16)',
              color: '#fbbf24',
              padding: '3px 12px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
            }}
          >
            LOCAL DEV
          </span>
          <h1
            style={{
              margin: '12px 0 4px',
              fontSize: 20,
              fontWeight: 650,
              color: 'var(--text-strong, #e6edf6)',
            }}
          >
            Dev Login
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--frost-700, #94a3b8)' }}>
            Sign in with your cloud environment credentials
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 13, color: 'var(--frost-700, #94a3b8)' }}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'grid', gap: 6, fontSize: 13, color: 'var(--frost-700, #94a3b8)' }}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
          </label>

          {error && (
            <p
              role="alert"
              style={{
                margin: 0,
                borderRadius: 8,
                background: 'rgba(239, 68, 68, .12)',
                color: '#f87171',
                padding: '8px 12px',
                fontSize: 13,
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '9px 14px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--primary-700, #38bdf8)',
              color: '#04121f',
              fontSize: 14,
              fontWeight: 650,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p
          style={{
            marginTop: 18,
            marginBottom: 0,
            textAlign: 'center',
            fontSize: 11.5,
            color: 'var(--frost-700, #94a3b8)',
            lineHeight: 1.5,
          }}
        >
          Authenticates via ROPC against the proxied Keycloak server. Tokens are
          cached in localStorage for the session.
        </p>
      </div>
    </div>
  );
}
