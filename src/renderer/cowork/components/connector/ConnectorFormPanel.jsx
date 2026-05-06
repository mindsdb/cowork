// Direct-form panel for predefined connectors. When a user picks a
// connector from the registry (literal id known), we render its
// embedded form spec right here — no chat round-trip, no agent
// negotiation, no waiting on an SSE stream.
//
// The form spec we hand to <DataVaultForm /> is the connector's
// `form` field, exactly the shape the renderer already expects.
// onAction is the only handler we own: cancel → close, primary →
// saveDatasource() → success state → close.

import { useState, useEffect, useRef } from 'react';
import { DataVaultForm } from '../datavault/DataVaultForm';
import { saveDatasource, fetchDatasources, startGoogleDriveAuth, fetchIntegrations } from '../../api';

const BROWSER_OAUTH_POLL_MS      = 3000;
const BROWSER_OAUTH_TIMEOUT_MS   = 2 * 60 * 1000;

const FONT_BODY = "var(--font-body, 'Inter', system-ui, sans-serif)";

export default function ConnectorFormPanel({
  open,
  connector,        // full registry record { id, label, form, ... }
  onClose,          // user dismissed (cancel / close / esc)
  onSaved,          // saved successfully — host can refresh + close
}) {
  // Local copies of the spec so we can mutate it for `_is_success`
  // / `form_error` between the user's actions and the server's
  // response, the same way DataVaultFormPanel does for the agent path.
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [savedSpec, setSavedSpec] = useState(null);
  const [oauthPending, setOauthPending] = useState(false);
  const oauthStartedAt = useRef('');
  const pollRef = useRef(null);

  useEffect(() => {
    if (!oauthPending) return;
    const startedAt = oauthStartedAt.current;
    const deadline = Date.now() + BROWSER_OAUTH_TIMEOUT_MS;
    pollRef.current = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(pollRef.current);
        setOauthPending(false);
        setErrorMsg('Sign-in timed out. Please try again.');
        setSavedSpec(null);
        return;
      }
      try {
        const data = await fetchIntegrations();
        const item = (data?.items || []).find((i) => i.id === 'google_drive');
        const lastSuccessAt = item?.oauth?.lastSuccessAt || '';
        if (lastSuccessAt && (!startedAt || lastSuccessAt >= startedAt)) {
          clearInterval(pollRef.current);
          setOauthPending(false);
          try {
            const latest = await fetchDatasources();
            onSaved?.(null, latest);
          } catch {
            onSaved?.(null, null);
          }
          setSavedSpec({
            ...spec,
            _is_success: true,
            title: 'Google Drive connected',
            subtitle: "Saved to Anton's data vault. Anton can now use this connection in tasks.",
            actions: [{ id: 'dismiss', label: 'Close', kind: 'cancel' }],
          });
        }
      } catch { /* keep polling */ }
    }, BROWSER_OAUTH_POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [oauthPending]);

  if (!open || !connector?.form) return null;

  // The spec we hand to <DataVaultForm /> — clone so we can paint
  // form_error / _is_success on it after a save attempt without
  // mutating the registry's cached object.
  const spec = savedSpec || {
    ...connector.form,
    form_error: errorMsg || undefined,
    logo: connector.form.logo || connector.logo,
    logo_color: connector.form.logo_color || connector.logo_color,
  };

  const handleAction = async (action) => {
    if (action.kind === 'cancel') {
      onClose?.();
      return;
    }
    const methodId = action.authMethod || '';

    // Built-in browser OAuth — calls our backend start endpoint and polls.
    if (methodId === 'browser_oauth_builtin') {
      setErrorMsg('');
      setBusy(true);
      try {
        const result = await startGoogleDriveAuth();
        if (!result?.authUrl) throw new Error('Could not start Google sign-in. Is the server running?');
        oauthStartedAt.current = result.startedAt || '';
        window.open(result.authUrl, '_blank');
        setOauthPending(true);
        setSavedSpec({
          ...spec,
          form_warning: 'Google sign-in opened in your browser. Complete the flow there, then return here.',
        });
      } catch (err) {
        setErrorMsg(err?.message || 'Could not start Google sign-in.');
      } finally {
        setBusy(false);
      }
      return;
    }

    // OAuth methods without built-in flow — placeholder note.
    const isOAuthStub = methodId === 'oauth' && (!action.values || Object.keys(action.values).length === 0);
    if (isOAuthStub) {
      setErrorMsg('');
      setSavedSpec({
        ...spec,
        form_warning: 'OAuth flow is coming soon. For now, switch to "App password" to connect Gmail.',
      });
      return;
    }
    // Fire the save.
    setBusy(true);
    setErrorMsg('');
    try {
      const payload = {
        engine: connector.id,
        name: '',
        authMethod: action.authMethod || null,
        credentials: action.values || {},
      };
      const saved = await saveDatasource(payload);
      // Refresh the connectors-list cache so the host's UI reflects
      // the new connection without a manual reload.
      try {
        const latest = await fetchDatasources();
        if (latest) onSaved?.(saved, latest);
        else onSaved?.(saved, null);
      } catch {
        onSaved?.(saved, null);
      }
      // Flip into the form renderer's "_is_success" state — same
      // confirmation surface the agent path uses, with our own
      // copy.
      setSavedSpec({
        ...spec,
        _is_success: true,
        title: `${connector.label || connector.id} connected`,
        subtitle: 'Saved to Anton\'s data vault. Anton can now use this connection in tasks.',
        actions: [
          { id: 'dismiss', label: 'Close', kind: 'cancel' },
        ],
      });
    } catch (err) {
      setErrorMsg(err?.message || 'Could not save connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 92vw)',
          maxHeight: 'min(720px, 88vh)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(15,16,17,0.30)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: FONT_BODY,
        }}
      >
        {/* Floating close button so the body can scroll behind a
            single-pixel panel border without a separate header bar
            taking vertical real estate. The form's own logo + title
            already provide the visual anchor. */}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          style={{
            position: 'absolute', top: 10, right: 10,
            cursor: 'pointer',
            background: 'transparent', border: 0,
            color: 'var(--ink-3)',
            width: 28, height: 28, borderRadius: 6,
            display: 'inline-grid', placeItems: 'center',
            fontSize: 18, lineHeight: 1,
            zIndex: 1,
          }}
        >×</button>

        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '20px 22px',
          background: 'var(--surface)',
        }}>
          <DataVaultForm
            spec={spec}
            onAction={handleAction}
            busy={busy}
            onMethodChange={() => {
              // Switching method invalidates any error from the
              // previous method's submit attempt — clear the
              // banner so the user doesn't see "missing required
              // fields: email, app_password" while standing on
              // the OAuth method that has no fields at all.
              setErrorMsg('');
              setSavedSpec(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}
