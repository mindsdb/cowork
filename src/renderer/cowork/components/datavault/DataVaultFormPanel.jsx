// Side-panel host that mounts the latest `data-vault-form` for the
// active conversation. Subscribes to the form store; the markdown
// extension publishes specs into that store as it parses
// `data-vault-form` code blocks during streaming.
//
// Submit / skip / cancel:
//   1. POST /v1/datavault/submissions to stage the values (server
//      keeps them in memory keyed by submission_id; never echoed).
//   2. Dispatch a chat continuation message that references the
//      submission_id, action id, form_id, and skipped field NAMES.
//      Field VALUES never appear in the chat — Anton's tool fetches
//      them server-side just-in-time.
//
// The cancel action skips the staging step; we just send a
// continuation that says "user cancelled".

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

// The web-fallback OAuth routes' "service" slug and the "X connected"
// success title both come from the connector's own spec (oauth.service_id,
// label) rather than a hardcoded per-engine map, so any OAuth-builtin
// connector works here without a code change.
function getBrowserOAuthMethod(spec) {
  return (Array.isArray(spec?.methods) ? spec.methods.find((m) => m.id === 'browser_oauth_builtin') : null) || null;
}

const FONT_BODY = 'var(--font-body)';

export function DataVaultFormPanel({ conversationId, onContinue, onSubmit, onNavigateToConnectors, onClose, highlighted = false }) {
  const [spec, setSpec] = useState(() => getForm(conversationId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Track the form_id we last animated in for. A new form for the
  // same conversation (e.g. user starts a second connection in the
  // same chat) should re-trigger the appearance, but a patch into
  // the same form_id should NOT — it'd be jarring to re-fade on
  // every status update.
  const animatedFormIdRef = useRef(null);
  const oauthPollRef = useRef(null);
  const [appearKey, setAppearKey] = useState(0);
  // Status toast: shown when spec.status_text is set; user can
  // dismiss with × . Once dismissed for a given text, it stays
  // hidden — but a NEW status text (e.g. probe phase advanced)
  // re-shows the toast with the new content. Tracked here rather
  // than on the spec so server-side updates don't have to know
  // anything about UI dismissal state.
  const [dismissedStatus, setDismissedStatus] = useState(null);
  // Active method for the panel chrome — when set (and not on the
  // success screen), the header bar becomes the "← Back to options ·
  // <method>" breadcrumb. Source of truth lives in formStore so
  // DataVaultForm can write it (on pick) and the panel can clear it
  // (on "back").
  const [activeMethodId, setActiveMethodId] = useState(
    () => (conversationId ? getSelectedMethod(conversationId) : null)
  );
  // Generic "name this connection" label — submitted as `user_label`
  // alongside whatever per-connector fields the form collects.
  const [userLabel, setUserLabel] = useState(spec?.user_label || '');

  useEffect(() => () => { if (oauthPollRef.current) clearInterval(oauthPollRef.current); }, []);

  // `useState`'s initial value is only read on mount. This panel is reused
  // across different connections without unmounting (e.g. the store swaps
  // `spec` under it), so `spec.user_label` changing on its own wouldn't
  // update `userLabel` — it would keep showing whatever the *first*
  // connection's value was. Reset explicitly whenever the underlying
  // connection identity changes (mirrors how `spec._existing_name` already
  // identifies "which connection is this panel for").
  useEffect(() => {
    setUserLabel(spec?.user_label || '');
  }, [spec?._existing_name]);

  // After a successful save, prefer the authoritative label the server
  // resolved (may differ from what was typed — e.g. de-duplicated with a
  // " 2" suffix, or a computed default when none was typed) over the
  // locally-typed value. Only overwrites when the store actually carries
  // one; no-op until whatever patched the form in also threads it through.
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
      // Bump key to remount the wrapper so the CSS animation re-fires.
      setAppearKey((k) => k + 1);
      // Reset dismissal state when a NEW form arrives — old
      // dismissal isn't relevant to a fresh connection attempt.
      setDismissedStatus(null);
    }
    if (!fid) {
      animatedFormIdRef.current = null;
      setDismissedStatus(null);
    }
  }, [spec?.form_id]);

  // Status toast disabled — LLM feedback should land in the chat
  // only, not duplicated inside the form panel. The chat already
  // surfaces every progress / tool-result event, and a toast inside
  // the form just made the surface feel busy. Kept the local
  // `dismissedStatus` state untouched in case we want a different
  // in-form indicator in the future.
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

    // Success branch — two intents:
    //   • view_connectors → route to the Connect Apps and Data page,
    //     then clear the panel
    //   • dismiss / cancel → just clear the panel
    // The connection is already in the vault either way; nothing
    // to dispatch back to anton.
    if (spec._is_success) {
      if (id === 'view_connectors') {
        onNavigateToConnectors?.();
      }
      handleClose();
      return;
    }

    // Parse-error recovery — when the form is the synthetic
    // "fm_parse_error" spec the markdown extension publishes, the
    // primary action just dispatches a recovery message back to
    // anton so it can re-emit a clean form. No staging needed.
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

    // Cancel — short-circuit, just send a continuation with cancel.
    if (kind === 'cancel') {
      onContinue?.(buildContinuation({
        spec, action: id, kind, submissionId: null, skipped: skipped || [],
        fieldNames: [],
      }));
      return;
    }

    // PostHog projects are account-scoped. Users know their project by name,
    // not the numeric ID that the connector engine needs, so discover choices
    // before posting the generic connector submission.
    if (spec._connector_id === 'posthog' && kind === 'primary'
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

    // Built-in browser OAuth — user clicked Submit after filling any
    // required fields (e.g. developer token for Google Ads).
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

      // Web fallback — server-side redirect flow.
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

    // OAuth submit — when the active method declares
    // `submit_action: "oauth_launch"`, run the PKCE browser flow
    // before handing off to the save path. We resolve client_id /
    // secret from the spec (Pattern A — hosted) or the user's
    // values (Pattern B — BYOK), call the main-process helper, and
    // augment the values with the resulting refresh_token + scope
    // so the vault sees a complete credentials payload.
    const activeMethodSpec = (() => {
      const id = authMethod;
      if (!id || !Array.isArray(spec.methods)) return null;
      return spec.methods.find((m) => m.id === id) || null;
    })();
    // Modify-flow synthetic method (`__edit_current__`) carries
    // `_underlying_method` — the saved record's real auth method id.
    // Server-side validation rejects unknown ids, so we always send
    // the underlying real id over the wire while keeping the
    // synthetic id locally for resolving the active spec entry.
    // `wireMethodId` falls through to `authMethod` for ordinary
    // (non-synthetic) methods so create-flow behaviour is unchanged.
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

      // ── Web shell: redirect-based OAuth ──────────────────────────
      // No Electron main process → no loopback PKCE. Drive the
      // server-side redirect flow instead: server mints the auth URL,
      // we open it, the provider redirects to the server callback
      // (which exchanges the code AND saves the vault record), and we
      // poll for the outcome. Requires a connector id — an LLM-emitted
      // form without one can't use this path (the server keys the
      // save on the connector id).
      if (host.isWeb) {
        const connectorId = spec._connector_id || null;
        if (!connectorId) {
          setError('This connector cannot be authorized in the browser (no connector id). Use the desktop app.');
          return;
        }
        setBusy(true);
        // Open the popup window SYNCHRONOUSLY, inside the click gesture,
        // BEFORE the async `startConnectorOAuth`. If we opened it after
        // the await, the broken user-gesture chain would trip popup
        // blockers. We point it at about:blank now and redirect it to
        // the real auth URL once the server returns it. Falls back to
        // host.openExternal if the browser still blocked the popup.
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
          // Send the (already-open) tab to the consent screen. The
          // callback renders its own "you can close this tab" page
          // server-side. If the popup was blocked, fall back to the
          // host's opener (new tab or, in Electron, the OS browser).
          if (popup) {
            try { popup.location.href = started.authUrl; }
            catch { await host.openExternal(started.authUrl); }
          } else {
            await host.openExternal(started.authUrl);
          }

          // Poll until the server-side callback reports a terminal
          // state. ~3 min budget at 2s intervals; the server's pending
          // entry expires at 10 min so this never polls a dead state
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
            // 'pending' → keep waiting.
          }
          if (!outcome) {
            setError('Timed out waiting for the OAuth sign-in to complete.');
            setBusy(false);
            return;
          }
          // The server callback already persisted the connection — just
          // flip the form into its success branch + recap in chat.
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
        // OAuth submits go through the connector-aware save endpoint —
        // not the legacy datasources path that validates against
        // Anton-core's built-in engine schemas (which would reject
        // a refresh_token-shaped payload). Falls back to the agent
        // path when the spec hasn't been stamped with a connector id
        // (e.g. an LLM-emitted form rather than a registry pick).
        const connectorId = spec._connector_id || null;
        if (connectorId) {
          try {
            const saved = await saveConnector(connectorId, {
              // `wireMethodId` resolves the synthetic
              // `__edit_current__` modify-flow method to the real
              // saved method id; for ordinary methods this is just
              // `authMethod` (unchanged from before).
              method: wireMethodId || activeMethodSpec.id || null,
              // Modify-flow stamps the existing connection name on
              // the spec so the save lands on the same vault row
              // (`(engine, name)` is the row key). Without this the
              // server falls back to `uuid.uuid4().hex[:8]` and we
              // end up with a sibling entry instead of an update.
              name: connectionName,
              values: oauthValues,
            });
            // Reconcile with the authoritative value — the server may
            // have de-duplicated it (e.g. appended " 2") or computed a
            // default when none was typed.
            if (saved.user_label) setUserLabel(saved.user_label);
            // Flip the form into its success branch so the user gets
            // a clear "connected" affordance + the standard
            // Close / View connectors actions.
            patchForm(conversationId, {
              form_id: spec.form_id,
              _is_success: true,
              title: `${saved.label || connectorId} connected`,
              subtitle: 'Saved to the data vault. The agent can use this connection in tasks.',
            });
            trackDataSourceConnected(connectorId);
            // Surface a one-line confirmation in the chat too.
            onContinue?.({
              text: `Connected ${saved.label || connectorId} — saved to the data vault.`,
            });
          } catch (e) {
            setError(e?.message || 'Could not save the connection.');
            setBusy(false);
          }
        } else if (onSubmit) {
          // Spec wasn't stamped with a connector id — fall back to
          // the legacy agent path with the augmented values. We
          // route via `wireMethodId` so modify-flow submissions
          // resolve to the saved method's real id, not the
          // synthetic `__edit_current__`.
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
      /* The discovered picker and the manual Project ID box both feed
         `project_id`, so one of them has to win when both carry a value.
         A typed id wins: it is the one still visible on screen, and a user
         who picks a project and then types over it has corrected
         themselves. `posthog_project_choice` is a UI-only field and never
         reaches the wire either way. */
      if (spec._connector_id === 'posthog') {
        const typedProjectId = String(submissionValues.project_id || '').trim();
        if (!typedProjectId && submissionValues.posthog_project_choice) {
          submissionValues.project_id = submissionValues.posthog_project_choice;
        }
        delete submissionValues.posthog_project_choice;
      }
      // Endpoint-as-agent path: hand the submission off to the
      // host (App.jsx → handleSubmitDataVaultForm). It opens an SSE
      // stream against /v1/datavault/submissions and pipes the
      // events into the conversation as a fresh assistant turn.
      // The agent does the validation / save / patch decisions
      // server-side without round-tripping through the LLM.
      if (onSubmit) {
        onSubmit({
          formId: spec.form_id,
          // Spread the chosen auth_method into the spec we send so
          // the server-side agent reads it from `spec.auth_method`
          // (its existing entry point) AND keeps
          // `spec.selected_method` for any logic that reads it
          // directly. Use `wireMethodId` so the synthetic modify
          // method (`__edit_current__`) resolves to the real saved
          // method id — server-side spec validation only knows the
          // real ones.
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
        // Legacy fallback — used by any host that hasn't wired
        // onSubmit (older tests, embeds). Stages the values without
        // streaming and posts a recap message into chat.
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

  // The user can always dismiss the form panel — even after a
  // successful save where there's no useful action left, or while
  // a stuck/abandoned form is sitting there. Clears the form from
  // the conversation's store; the panel unmounts.
  const handleClose = () => {
    // Host may own dismissal (e.g. returning the user to where they opened
    // the connect flow, ENG-1534); fall back to a plain form-clear.
    if (onClose) { onClose(conversationId); return; }
    if (conversationId) clearForm(conversationId);
  };

  // Resolve the active method spec so the breadcrumb header can show
  // its label. Falls back to `spec.selected_method` so a server-side
  // pre-pick still surfaces in the header.
  const resolvedActiveMethodId = activeMethodId || spec.selected_method || null;
  const activeMethodSpec = (Array.isArray(spec.methods) && resolvedActiveMethodId)
    ? (spec.methods.find((m) => m.id === resolvedActiveMethodId) || null)
    : null;
  const onBackToOptions = () => {
    if (!conversationId) return;
    setSelectedMethod(conversationId, null);
    // Modify-flow opens directly on the saved method by stamping
    // `selected_method` on the spec itself. Clearing the per-
    // conversation override above isn't enough — the form's resolver
    // falls back to `spec.selected_method` and stays on the same
    // method. Patch the spec to drop it so the picker actually
    // re-engages. No-op for create flows where `selected_method`
    // wasn't set in the first place.
    if (spec?.selected_method) {
      patchForm(conversationId, { form_id: spec.form_id, selected_method: null });
    }
  };

  return (
    // `key` flips when a NEW form_id arrives, so React remounts the
    // wrapper and the appearance animation fires fresh. Patches that
    // only update the existing form (status_text, fields…) keep the
    // same form_id → no remount → no re-animation.
    <div
      key={appearKey}
      style={{
        position: 'relative',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        overflow: 'hidden',
        // The panel sits in the right rail's flex column — without
        // `flex-shrink: 0`, the rail squeezes the panel down to fit
        // its own height, our `overflow: hidden` clips the content,
        // and the rail's `overflowY: auto` never sees anything to
        // scroll. Pinning shrink to 0 makes the panel claim its full
        // content height so the rail's scroll engages naturally.
        flexShrink: 0,
        // Highlight ring driven from outside (e.g. the chat's
        // connect-intro bubble on hover) — accent border + soft
        // halo so the form card draws the eye without layout shift.
        boxShadow: highlighted
          ? '0 0 0 2px var(--accent), 0 0 22px color-mix(in srgb, var(--accent) 28%, transparent)'
          : 'none',
        transition: 'box-shadow 180ms ease',
        animation: 'dvf-appear 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
      }}
    >
      {/* Header bar — during the connect flow it's the
          "← Back to options · <method>" navigation (when a method is
          active) or a plain "Connect" label. On the SUCCESS screen the
          breadcrumb is dropped — the connection is done, there's nothing
          to go back to — leaving just the close button (ENG-1534). The X
          sits flush right in every case. */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        borderBottom: '1px solid var(--line)',
        minHeight: 42,
      }}>
        {spec._is_success ? (
          <div style={{ flex: 1, minWidth: 0 }} />
        ) : activeMethodSpec ? (
          <button
            type="button"
            onClick={onBackToOptions}
            disabled={busy}
            style={{
              flex: 1, minWidth: 0,
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0 14px',
              background: 'transparent', border: 0,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              fontFamily: FONT_BODY,
              textAlign: 'left',
              transition: 'background 120ms ease',
            }}
            onMouseOver={(e) => { if (!busy) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{
              color: 'var(--accent)',
              fontSize: 13, fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 4,
              flexShrink: 0,
            }}>
              <span aria-hidden>{'←'}</span>
              Back to options
            </span>
            <span style={{
              color: 'var(--ink-4)', fontSize: 12.5,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              minWidth: 0, flex: 1,
            }}>
              · {activeMethodSpec.label || activeMethodSpec.id}
            </span>
          </button>
        ) : (
          <div style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center',
            padding: '0 14px',
            fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600,
            color: 'var(--ink)', letterSpacing: '0',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            Connect
          </div>
        )}
        <Tooltip content="Close form">
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close form"
            style={{
              flexShrink: 0,
              width: 38, alignSelf: 'stretch',
              background: 'transparent', border: 0,
              color: 'var(--ink-4)',
              display: 'inline-grid', placeItems: 'center',
              cursor: 'pointer',
              transition: 'color 140ms ease, background 140ms ease',
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-4)'; e.currentTarget.style.background = 'transparent'; }}
          >
            {Ico.close ? Ico.close(13) : <span style={{ fontSize: 16, lineHeight: 1 }}>×</span>}
          </button>
        </Tooltip>
      </div>

      <div style={{ padding: '10px 14px 14px' }}>
        {spec._is_probing ? (
          /* Probe running — replace the form with a spinner so the
             popup shows clear progress instead of appearing frozen. */
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '32px 20px 36px', gap: 12,
          }}>
            <span
              aria-hidden
              style={{
                display: 'block',
                width: 22, height: 22,
                borderRadius: '50%',
                border: '2.5px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                borderTopColor: 'var(--accent)',
                animation: 'spin 720ms linear infinite',
              }}
            />
            <span style={{ color: 'var(--ink-2)', fontSize: 13, textAlign: 'center' }}>
              {spec.status_text || 'Testing connection…'}
            </span>
          </div>
        ) : spec.form_error && !spec._is_error ? (
          /* Probe returned failure — show error card + Try again. */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0 2px' }}>
            <Alert variant="danger" title="Connection failed">
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                {spec.form_error}
              </div>
              {spec.subtitle && (
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.4, marginTop: 6 }}>
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
              style={{ alignSelf: 'flex-start' }}
            >
              Try again
            </Button>
          </div>
        ) : (
          /* Normal / success / parse-error state — render the form as usual. */
          <>
            {showStatusToast && (
              <div
                key={spec.status_text}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  marginBottom: 12,
                  padding: '8px 10px 8px 12px', borderRadius: 8,
                  background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
                  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                  color: 'var(--ink-2)', fontSize: 12.5,
                  animation: 'dvf-appear 220ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 11, height: 11, flex: '0 0 11px',
                    borderRadius: '50%',
                    border: '2px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                    borderTopColor: 'var(--accent)',
                    animation: 'spin 720ms linear infinite',
                  }}
                />
                <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {spec.status_text}
                </span>
                <Tooltip content="Dismiss">
                  <button
                    type="button"
                    onClick={() => setDismissedStatus(spec.status_text)}
                    aria-label="Dismiss status"
                    style={{
                      width: 20, height: 20, borderRadius: 5,
                      background: 'transparent', border: 0, padding: 0,
                      color: 'var(--ink-4)',
                      display: 'inline-grid', placeItems: 'center',
                      cursor: 'pointer', flex: '0 0 20px',
                      transition: 'color 120ms ease, background 120ms ease',
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-4)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    {Ico.close ? Ico.close(11) : <span style={{ fontSize: 14, lineHeight: 1 }}>×</span>}
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
                // Methods with fields wait for Submit — handleAction takes over.
                const method = Array.isArray(spec?.methods) ? spec.methods.find((m) => m.id === methodId) : null;
                if (method?.fields?.length) return;
                // No fields — auto-start immediately on method selection.
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

                // Web fallback
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
