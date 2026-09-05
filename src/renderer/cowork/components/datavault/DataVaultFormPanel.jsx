// Stage field values server-side and send only submission id, action/form ids, and skipped field
// names to chat.
// Secrets must never appear in the continuation; Anton fetches them just in time. Cancel skips
// staging.

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { Alert, Button, Tooltip } from '../ui';
import { DataVaultForm } from './DataVaultForm';
import { providerNameFromSpec } from './methodHero';
import {
  clearForm, getForm, patchForm, subscribe,
  getSelectedMethod, subscribeSelectedMethod, setSelectedMethod,
} from './formStore';

import { discoverPostHogProjects, saveConnector, fetchDatasources, startConnectorOAuth, pollConnectorOAuth } from '../../api';
import { host } from '../../../platform/host';
import { trackDataSourceConnected } from '../../lib/analytics';

import { submitDataVaultForm } from '../../api';

const BROWSER_OAUTH_POLL_MS    = 3000;
const BROWSER_OAUTH_TIMEOUT_MS = 2 * 60 * 1000;

// Resolve OAuth service IDs and success labels from connector specs so new connectors need no
// per-engine mapping.
function getBrowserOAuthMethod(spec) {
  return (Array.isArray(spec?.methods) ? spec.methods.find((m) => m.id === 'browser_oauth_builtin') : null) || null;
}

const FONT_BODY = 'var(--font-body)';

export function DataVaultFormPanel({ conversationId, onContinue, onSubmit, onNavigateToConnectors, onClose, highlighted = false }) {
  const [spec, setSpec] = useState(() => getForm(conversationId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Animate once per form_id; patches to the same form must not restart the appearance.
  const animatedFormIdRef = useRef(null);
  const oauthPollRef = useRef(null);
  const [appearKey, setAppearKey] = useState(0);
  // Keep dismissal separate from server specs; new status text can be shown after an earlier
  // message was dismissed.
  const [dismissedStatus, setDismissedStatus] = useState(null);
  // Share method selection through formStore so the form can select it and the panel breadcrumb can
  // clear it.
  const [activeMethodId, setActiveMethodId] = useState(
    () => (conversationId ? getSelectedMethod(conversationId) : null)
  );
  const [userLabel, setUserLabel] = useState(spec?.user_label || '');

  useEffect(() => () => { if (oauthPollRef.current) clearInterval(oauthPollRef.current); }, []);

  // Reset labels on connection identity changes because this panel is reused without unmounting.
  useEffect(() => {
    setUserLabel(spec?.user_label || '');
  }, [spec?._existing_name]);

  // After save, adopt a returned server label, which may be deduplicated or defaulted.
  useEffect(() => {
    if (spec?._is_success && spec?.user_label) {
      setUserLabel(spec.user_label);
    }
  }, [spec?._is_success, spec?.user_label]);

  useEffect(() => {
    setSpec(getForm(conversationId));
    return subscribe(conversationId, (next) => setSpec(next));
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return undefined;
    setActiveMethodId(getSelectedMethod(conversationId));
    return subscribeSelectedMethod(conversationId, (mid) => {
      setActiveMethodId(mid || null);
    });
  }, [conversationId]);

  useEffect(() => {
    const fid = spec?.form_id || null;
    if (fid && fid !== animatedFormIdRef.current) {
      animatedFormIdRef.current = fid;
      setAppearKey((k) => k + 1);
      setDismissedStatus(null);
    }
    if (!fid) {
      animatedFormIdRef.current = null;
      setDismissedStatus(null);
    }
  }, [spec?.form_id]);

  // Status toasts are disabled because progress already appears in chat.
  const showStatusToast = false;

  const startBrowserOAuthPoll = (state, successTitle, formId) => {
    const deadline = Date.now() + BROWSER_OAUTH_TIMEOUT_MS;
    oauthPollRef.current = setInterval(async () => {
      try {
        if (Date.now() > deadline) {
          clearInterval(oauthPollRef.current);
          setBusy(false);
          patchForm(conversationId, {
            form_id: formId,
            _is_probing: false,
            form_error: 'Sign-in timed out. Please try again.',
            _is_success: false,
          });
          return;
        }
        const outcome = await pollConnectorOAuth(state);
        if (outcome?.status === 'success') {
          clearInterval(oauthPollRef.current);
          setBusy(false);
          // Refocus the app after OAuth; without a popup reference, closing the auth tab depends on
          // its callback page.
          try { window.focus(); } catch { /* best effort */ }
          try { await fetchDatasources(); } catch { /* best effort */ }
          patchForm(conversationId, {
            form_id: formId,
            _is_probing: false,
            _is_success: true,
            title: successTitle,
            subtitle: "Saved to the data vault. Cowork can now use this connection in tasks.",
          });
        } else if (outcome?.status === 'error') {
          clearInterval(oauthPollRef.current);
          setBusy(false);
          patchForm(conversationId, {
            form_id: formId,
            _is_probing: false,
            form_error: outcome.error || 'Sign-in failed. Please try again.',
            _is_success: false,
          });
        }
      } catch { /* keep polling */ }
    }, BROWSER_OAUTH_POLL_MS);
  };

  const handleAction = async ({ id, kind, values, skipped, authMethod }) => {
    if (!spec) return;
    setError('');

    // Success actions only navigate or dismiss; the connection is already saved.
    if (spec._is_success) {
      if (id === 'view_connectors') {
        onNavigateToConnectors?.();
      }
      handleClose();
      return;
    }

    // Parse-error retries ask Anton for a clean request_credentials form; no values need staging.
    if (spec._is_error) {
      if (id === 'retry' && kind === 'primary') {
        onContinue?.({
          text: (
            'The data-vault-form spec you just emitted did not parse as valid '
            + 'JSON' + (spec.form_error ? ` (${spec.form_error})` : '') + '. '
            + 'Please call `request_credentials` again — the tool returns the '
            + 'block already formatted, so you only need to provide the spec '
            + 'object and include the returned markdown verbatim.'
          ),
          payload: { kind: 'retry_form', form_id: spec.form_id },
        });
      }
      // Any action on the error form clears it from the side panel
      // so a successful retry can replace it cleanly.
      return;
    }

    if (kind === 'cancel') {
      onContinue?.(buildContinuation({
        spec, action: id, kind, submissionId: null, skipped: skipped || [],
        fieldNames: [],
      }));
      return;
    }

    // Discover PostHog project names/IDs before personal-key submission. Built-in browser OAuth has
    // no personal key/host to probe.
    if (spec._connector_id === 'posthog' && kind === 'primary'
      && authMethod !== 'browser_oauth_builtin'
      && !String(values?.project_id || '').trim()
      && !String(values?.posthog_project_choice || '').trim()) {
      setBusy(true);
      try {
        const result = await discoverPostHogProjects({
          personalApiKey: values?.personal_api_key,
          host: values?.host,
          customHost: values?.custom_host,
        });
        const options = (result.projects || []).map((project) => ({
          value: String(project.id),
          label: project.name || `Project ${project.id}`,
        }));
        if (!options.length) {
          throw new Error('No PostHog projects are available to this personal API key. Enter a project ID manually or check the key access.');
        }
        patchForm(conversationId, {
          form_id: spec.form_id,
          form_error: null,
          subtitle: 'Choose the PostHog project to connect.',
          methods: {
            [authMethod || 'personal-api-key']: {
              fields: {
                posthog_project_choice: {
                  name: 'posthog_project_choice',
                  label: 'PostHog project',
                  type: 'select',
                  required: true,
                  options,
                  help: 'Choose the PostHog project to connect, or type its numeric ID directly in the Project ID field.',
                },
              },
            },
          },
        });
      } catch (err) {
        setError(err?.message || 'Could not find PostHog projects.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (authMethod === 'browser_oauth_builtin' && kind === 'primary') {
      const engine = spec.engine || spec._connector_id || 'google_drive';
      const providerLabel = providerNameFromSpec(spec);
      const successTitle = `${providerLabel} connected`;
      setBusy(true);
      setError('');

      if (host.isElectron) {
        // Electron — main process owns the full PKCE flow, keychain storage,
        // /save call, and refresh loop start. Renderer gets { ok, name } back.
        patchForm(conversationId, {
          form_id: spec.form_id,
          _is_probing: true,
          status_text: `Waiting for ${providerLabel} sign-in…`,
          form_error: null,
        });
        try {
          const result = await host.oauthConnect({ engine, name: values?.label || '' });
          if (!result || result.ok === false) throw new Error(result?.reason || 'OAuth flow failed.');
          setBusy(false);
          try { await fetchDatasources(); } catch { /* best effort */ }
          patchForm(conversationId, {
            form_id: spec.form_id,
            _is_probing: false,
            _is_success: true,
            title: successTitle,
            subtitle: 'Saved to the data vault. Cowork can now use this connection in tasks.',
          });
          trackDataSourceConnected(engine);
          onContinue?.({ text: `Connected ${successTitle} — saved to the data vault.` });
        } catch (e) {
          patchForm(conversationId, { form_id: spec.form_id, _is_probing: false, form_error: e?.message || 'OAuth flow failed.' });
          setBusy(false);
        }
        return;
      }

      const serviceId = getBrowserOAuthMethod(spec)?.oauth?.service_id;
      if (!serviceId) { setError(`No OAuth configuration for "${engine}".`); setBusy(false); return; }
      try {
        const result = await startConnectorOAuth(serviceId, { extraFields: values || {} });
        if (!result?.authUrl || !result?.state) throw new Error(`Could not start ${providerLabel} sign-in. Is the server running?`);
        window.open(result.authUrl, '_blank');
        patchForm(conversationId, { form_id: spec.form_id, _is_probing: true, status_text: `Waiting for ${providerLabel} sign-in…`, form_error: null });
        startBrowserOAuthPoll(result.state, successTitle, spec.form_id);
      } catch (e) {
        patchForm(conversationId, { form_id: spec.form_id, _is_probing: false, form_error: e?.message || `Could not start ${providerLabel} sign-in.` });
        setBusy(false);
      }
      return;
    }

    // Resolve OAuth client credentials from the spec or user fields, then add the returned
    // refresh_token/scope before saving.
    const activeMethodSpec = (() => {
      const id = authMethod;
      if (!id || !Array.isArray(spec.methods)) return null;
      return spec.methods.find((m) => m.id === id) || null;
    })();
    // Resolve synthetic modify selections to their saved _underlying_method for server validation;
    // keep synthetic IDs local.
    const wireMethodId = activeMethodSpec?._underlying_method || authMethod;
    const connectionName = spec._existing_name || spec.name || '';
    if (activeMethodSpec?.submit_action === 'oauth_launch' && kind === 'primary') {
      const oauthMeta = activeMethodSpec.oauth || {};
      const clientId = oauthMeta.client_id || (values && values.client_id) || '';
      const clientSecret = oauthMeta.client_secret || (values && values.client_secret) || undefined;
      if (!clientId) {
        setError('Missing OAuth client ID — fill the Client ID field below.');
        return;
      }
      if (!oauthMeta.auth_url || !oauthMeta.token_url || !Array.isArray(oauthMeta.scopes)) {
        setError('OAuth metadata is incomplete in the connector spec (auth_url / token_url / scopes).');
        return;
      }

      // Web uses server-side OAuth because it cannot run Electron loopback PKCE. Require a
      // connector ID for server-side saving.
      if (host.isWeb) {
        const connectorId = spec._connector_id || null;
        if (!connectorId) {
          setError('This connector cannot be authorized in the browser (no connector id). Use the desktop app.');
          return;
        }
        setBusy(true);
        // Open a blank popup during the click gesture, before awaiting the auth URL, to avoid popup
        // blocking.
        // Use host.openExternal if it still fails.
        let popup = null;
        try { popup = window.open('', '_blank'); } catch { popup = null; }
        try {
          const started = await startConnectorOAuth(connectorId, {
            method: wireMethodId || activeMethodSpec.id || null,
            name: spec._existing_name || '',
            clientId,
            clientSecret,
          });
          if (!started?.authUrl || !started?.state) {
            if (popup) { try { popup.close(); } catch {} }
            setError('Could not start the OAuth flow.');
            setBusy(false);
            return;
          }
          if (popup) {
            try { popup.location.href = started.authUrl; }
            catch { await host.openExternal(started.authUrl); }
          } else {
            await host.openExternal(started.authUrl);
          }

          // Bound polling below the server’s pending-state expiry so abandoned flows cannot poll
          // forever.
          const POLL_MS = 2000;
          const MAX_POLLS = 90;
          let outcome = null;
          for (let i = 0; i < MAX_POLLS; i++) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            let status;
            try {
              status = await pollConnectorOAuth(started.state);
            } catch {
              continue; // transient — keep polling
            }
            if (status?.status === 'success') { outcome = status; break; }
            if (status?.status === 'error') {
              setError(status.error || 'OAuth flow failed.');
              setBusy(false);
              return;
            }
            if (status?.status === 'expired') {
              setError('The sign-in expired before it completed. Try again.');
              setBusy(false);
              return;
            }
          }
          if (!outcome) {
            setError('Timed out waiting for the OAuth sign-in to complete.');
            setBusy(false);
            return;
          }
          // Close the captured popup and refocus the app. When no reference exists, the callback
          // page closes its own tab.
          if (popup) { try { popup.close(); } catch {} }
          try { window.focus(); } catch {}
          // The OAuth callback already persisted the connection.
          patchForm(conversationId, {
            form_id: spec.form_id,
            _is_success: true,
            title: `${outcome.label || connectorId} connected`,
            subtitle: 'Saved to the data vault. Cowork can use this connection in tasks.',
          });
          trackDataSourceConnected(connectorId);
          onContinue?.({
            text: `Connected ${outcome.label || connectorId} — saved to the data vault.`,
          });
        } catch (e) {
          setError(e?.message || 'OAuth flow failed.');
          setBusy(false);
        }
        return;
      }

      setBusy(true);
      try {
        const result = await host.oauthConnect({
          authUrl: oauthMeta.auth_url,
          tokenUrl: oauthMeta.token_url,
          clientId,
          clientSecret,
          scopes: oauthMeta.scopes,
          extraAuthParams: oauthMeta.extra_auth_params,
          redirectPort: oauthMeta.redirect_port,
        });
        if (!result || result.ok === false) {
          setError(result?.reason || 'OAuth flow failed.');
          setBusy(false);
          return;
        }
        // Build the credentials payload. client_id / client_secret are kept
        // for BYOK flows — the engine needs them for refresh-token exchanges.
        const oauthValues = {
          ...(values || {}),
          client_id: clientId,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          refresh_token: result.refresh_token || '',
          access_token: result.access_token || '',
          scope: result.scope || (oauthMeta.scopes || []).join(' '),
          token_type: result.token_type || 'Bearer',
          user_label: userLabel,
        };
        // Use connector-aware saving for OAuth credentials; legacy schemas reject refresh tokens.
        // Without a connector ID, use the agent path.
        const connectorId = spec._connector_id || null;
        if (connectorId) {
          try {
            const saved = await saveConnector(connectorId, {
              method: wireMethodId || activeMethodSpec.id || null,
              // Preserve the existing (engine, name) vault key in modify mode or saving would
              // create a sibling connection.
              name: connectionName,
              values: oauthValues,
            });
            // Use the server’s label, which may be defaulted or deduplicated.
            if (saved.user_label) setUserLabel(saved.user_label);
            patchForm(conversationId, {
              form_id: spec.form_id,
              _is_success: true,
              title: `${saved.label || connectorId} connected`,
              subtitle: 'Saved to the data vault. The agent can use this connection in tasks.',
            });
            trackDataSourceConnected(connectorId);
            onContinue?.({
              text: `Connected ${saved.label || connectorId} — saved to the data vault.`,
            });
          } catch (e) {
            setError(e?.message || 'Could not save the connection.');
            setBusy(false);
          }
        } else if (onSubmit) {
          // Without a connector ID, submit augmented credentials through the agent with the
          // resolved real method ID.
          onSubmit({
            formId: spec.form_id,
            formSpec: wireMethodId
              ? { ...spec, auth_method: wireMethodId, selected_method: wireMethodId }
              : spec,
            values: oauthValues,
            skipped: skipped || [],
            name: connectionName,
            method: wireMethodId || null,
          });
        }
      } catch (e) {
        setError(e?.message || 'OAuth flow failed.');
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const submissionValues = { ...(values || {}) };
      /*
       * Typed PostHog IDs override discovered choices because they reflect the user’s visible
       * correction. Never send the UI-only choice field.
       */
      if (spec._connector_id === 'posthog') {
        const typedProjectId = String(submissionValues.project_id || '').trim();
        if (!typedProjectId && submissionValues.posthog_project_choice) {
          submissionValues.project_id = submissionValues.posthog_project_choice;
        }
        delete submissionValues.posthog_project_choice;
      }
      // Stream submission as a turn through the host; server validation/saving does not expose
      // field values to the LLM.
      if (onSubmit) {
        onSubmit({
          formId: spec.form_id,
          // Send the real method ID in both auth_method and selected_method for server readers;
          // synthetic IDs are not valid methods.
          formSpec: wireMethodId
            ? { ...spec, auth_method: wireMethodId, selected_method: wireMethodId }
            : spec,
          values: { ...submissionValues, user_label: userLabel },
          skipped: skipped || [],
          name: connectionName,
          method: wireMethodId || null,
        });
        // Don't await — the stream pumps events into ChatView state
        // directly. We can drop the local busy flag; the Composer's
        // streaming indicator picks up from here.
      } else {
        // Fallback for hosts without onSubmit: stage values and post a recap without streaming.
        const result = await submitDataVaultForm({
          formId: spec.form_id,
          conversationId,
          formSpec: spec,
          values: { ...submissionValues, user_label: userLabel },
          skipped: skipped || [],
          name: connectionName,
          method: wireMethodId || null,
        });
        onContinue?.(buildContinuation({
          spec, action: id, kind,
          submissionId: result?.submission_id,
          skipped: skipped || [],
          fieldNames: Object.keys(values || {}),
        }));
      }
    } catch (e) {
      setError(e?.message || 'Could not submit form');
    } finally {
      setBusy(false);
    }
  };

  if (!spec) return null;

  const handleClose = () => {
    // Let the host restore the prior view on dismissal; otherwise clear the form. ENG-1534.
    if (onClose) { onClose(conversationId); return; }
    if (conversationId) clearForm(conversationId);
  };

  const resolvedActiveMethodId = activeMethodId || spec.selected_method || null;
  const activeMethodSpec = (Array.isArray(spec.methods) && resolvedActiveMethodId)
    ? (spec.methods.find((m) => m.id === resolvedActiveMethodId) || null)
    : null;
  const onBackToOptions = () => {
    if (!conversationId) return;
    setSelectedMethod(conversationId, null);
    // Clear spec.selected_method too: modify forms would otherwise fall back to it and never return
    // to the picker.
    if (spec?.selected_method) {
      patchForm(conversationId, { form_id: spec.form_id, selected_method: null });
    }
  };

  return (
    <div
      key={appearKey}
      // Prevent flex shrinking so the panel claims its full content height and the enclosing rail
      // can scroll it.
      className="relative bg-surface border border-solid border-line rounded-card overflow-hidden shrink-0"
      style={{
        boxShadow: highlighted
          ? '0 0 0 2px var(--accent), 0 0 22px color-mix(in srgb, var(--accent) 28%, transparent)'
          : 'none',
        transition: 'box-shadow 180ms ease',
        animation: 'dvf-appear 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
      }}
    >
      <div className="flex items-stretch border-b border-t-0 border-x-0 border-solid border-line min-h-[42px]">
        {spec._is_success ? (
          <div className="flex-1 min-w-0" />
        ) : activeMethodSpec ? (
          <button
            type="button"
            onClick={onBackToOptions}
            disabled={busy}
            className="flex-1 min-w-0 flex items-center gap-2 px-[14px] py-0 bg-transparent border-0 text-left font-[family-name:var(--font-body)]"
            style={{
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              transition: 'background 120ms ease',
            }}
            onMouseOver={(e) => { if (!busy) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span className="text-accent text-[13px] font-semibold inline-flex items-center gap-1 shrink-0">
              <span aria-hidden>{'←'}</span>
              Back to options
            </span>
            <span className="text-ink-4 text-sm overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1">
              · {activeMethodSpec.label || activeMethodSpec.id}
            </span>
          </button>
        ) : (
          <div className="flex-1 min-w-0 flex items-center px-[14px] py-0 font-[family-name:var(--font-body)] text-[13px] font-semibold text-ink tracking-[0] overflow-hidden text-ellipsis whitespace-nowrap">
            Connect
          </div>
        )}
        <Tooltip content="Close form">
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close form"
            className="shrink-0 w-[38px] self-stretch bg-transparent border-0 text-ink-4 inline-grid place-items-center cursor-pointer"
            style={{ transition: 'color 140ms ease, background 140ms ease' }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-4)'; e.currentTarget.style.background = 'transparent'; }}
          >
            {Ico.close ? Ico.close(13) : <span className="text-[16px] leading-none">×</span>}
          </button>
        </Tooltip>
      </div>

      <div className="pt-[10px] px-[14px] pb-[14px]">
        {spec._is_probing ? (
          <div className="flex flex-col items-center justify-center pt-8 px-5 pb-[36px] gap-3">
            <span
              aria-hidden
              className="block w-[22px] h-[22px] rounded-full"
              style={{
                border: '2.5px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                borderTopColor: 'var(--accent)',
                animation: 'spin 720ms linear infinite',
              }}
            />
            <span className="text-ink-2 text-[13px] text-center">
              {spec.status_text || 'Testing connection…'}
            </span>
          </div>
        ) : spec.form_error && !spec._is_error ? (
          <div className="flex flex-col gap-3 pt-1 px-0 pb-[2px]">
            <Alert variant="danger" title="Connection failed">
              <div className="text-sm text-ink-2 leading-[1.55]">
                {spec.form_error}
              </div>
              {spec.subtitle && (
                <div className="text-sm text-ink-3 leading-[1.4] mt-[6px]">
                  {spec.subtitle}
                </div>
              )}
            </Alert>
            <Button
              variant="primary"
              onClick={() => {
                const fieldsPatch = {};
                if (Array.isArray(spec.fields)) {
                  for (const f of spec.fields) {
                    if (f?.name) fieldsPatch[f.name] = { status: null };
                  }
                }
                const methodsPatch = {};
                if (Array.isArray(spec.methods)) {
                  for (const m of spec.methods) {
                    if (!m?.id) continue;
                    const mf = {};
                    if (Array.isArray(m.fields)) {
                      for (const f of m.fields) {
                        if (f?.name) mf[f.name] = { status: null };
                      }
                    }
                    if (Object.keys(mf).length) methodsPatch[m.id] = { fields: mf };
                  }
                }
                patchForm(conversationId, {
                  form_id: spec.form_id,
                  form_error: null,
                  _is_probing: false,
                  status_text: null,
                  ...(Object.keys(fieldsPatch).length ? { fields: fieldsPatch } : {}),
                  ...(Object.keys(methodsPatch).length ? { methods: methodsPatch } : {}),
                });
              }}
              className="self-start"
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            {showStatusToast && (
              <div
                key={spec.status_text}
                className="flex items-center gap-[10px] mb-3 pt-2 pr-[10px] pb-2 pl-3 rounded-card-row text-ink-2 text-sm"
                style={{
                  background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
                  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                  animation: 'dvf-appear 220ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
                }}
              >
                <span
                  aria-hidden
                  className="w-[11px] h-[11px] flex-[0_0_11px] rounded-full"
                  style={{
                    border: '2px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                    borderTopColor: 'var(--accent)',
                    animation: 'spin 720ms linear infinite',
                  }}
                />
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {spec.status_text}
                </span>
                <Tooltip content="Dismiss">
                  <button
                    type="button"
                    onClick={() => setDismissedStatus(spec.status_text)}
                    aria-label="Dismiss status"
                    className="w-[20px] h-[20px] rounded-[5px] bg-transparent border-0 p-0 text-ink-4 inline-grid place-items-center cursor-pointer flex-[0_0_20px]"
                    style={{ transition: 'color 120ms ease, background 120ms ease' }}
                    onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-4)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    {Ico.close ? Ico.close(11) : <span className="text-base leading-none">×</span>}
                  </button>
                </Tooltip>
              </div>
            )}
            <DataVaultForm
              spec={spec}
              busy={busy}
              onAction={handleAction}
              conversationId={conversationId}
              userLabel={!spec._is_success ? userLabel : undefined}
              onUserLabelChange={setUserLabel}
              onMethodChange={async (methodId) => {
                if (methodId !== 'browser_oauth_builtin') return;
                const method = Array.isArray(spec?.methods) ? spec.methods.find((m) => m.id === methodId) : null;
                if (method?.fields?.length) return;
                const engine = spec.engine || spec._connector_id || 'google_drive';
                const providerLabel = providerNameFromSpec(spec);
                const successTitle = `${providerLabel} connected`;
                setBusy(true);
                setError('');

                if (host.isElectron) {
                  patchForm(conversationId, { form_id: spec.form_id, _is_probing: true, status_text: `Waiting for ${providerLabel} sign-in…`, form_error: null });
                  try {
                    const result = await host.oauthConnect({ engine, name: '' });
                    if (!result || result.ok === false) throw new Error(result?.reason || 'OAuth flow failed.');
                    setBusy(false);
                    try { await fetchDatasources(); } catch { /* best effort */ }
                    patchForm(conversationId, { form_id: spec.form_id, _is_probing: false, _is_success: true, title: successTitle, subtitle: 'Saved to the data vault. Cowork can now use this connection in tasks.' });
                    trackDataSourceConnected(engine);
                  } catch (e) {
                    patchForm(conversationId, { form_id: spec.form_id, _is_probing: false, form_error: e?.message || 'OAuth flow failed.' });
                    setBusy(false);
                  }
                  return;
                }

                const serviceId = method?.oauth?.service_id;
                if (!serviceId) { setError(`No OAuth configuration for "${engine}".`); setBusy(false); return; }
                try {
                  const result = await startConnectorOAuth(serviceId);
                  if (!result?.authUrl || !result?.state) throw new Error(`Could not start ${providerLabel} sign-in. Is the server running?`);
                  window.open(result.authUrl, '_blank');
                  patchForm(conversationId, { form_id: spec.form_id, _is_probing: true, status_text: `Waiting for ${providerLabel} sign-in…`, form_error: null });
                  startBrowserOAuthPoll(result.state, successTitle, spec.form_id);
                } catch (e) {
                  patchForm(conversationId, { form_id: spec.form_id, _is_probing: false, form_error: e?.message || `Could not start ${providerLabel} sign-in.` });
                  setBusy(false);
                }
              }}
            />
            {error && (
              <Alert variant="danger" className="mt-2.5">{error}</Alert>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// The continuation message we send back to the conversation. Only
// names — never values — so credentials don't end up in
// `_history.json`. Anton's tool reads values via the staging store.
function buildContinuation({ spec, action, kind, submissionId, skipped, fieldNames }) {
  const summary = [];
  if (kind === 'cancel') {
    summary.push('I cancelled the form for now.');
  } else {
    summary.push(`Submitted form \`${spec.form_id}\`.`);
    if (submissionId) summary.push(`submission_id: \`${submissionId}\``);
    if (fieldNames?.length) summary.push(`fields filled: ${fieldNames.join(', ')}`);
    if (skipped?.length) summary.push(`fields skipped: ${skipped.join(', ')}`);
  }
  return {
    text: summary.join(' · '),
    payload: {
      action,
      kind,
      form_id: spec.form_id,
      submission_id: submissionId,
      skipped: skipped || [],
      field_names: fieldNames || [],
    },
  };
}
