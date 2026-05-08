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
import { DataVaultForm } from './DataVaultForm';
import {
  clearForm, getForm, patchForm, subscribe,
  getSelectedMethod, subscribeSelectedMethod, setSelectedMethod,
} from './formStore';

import { saveConnector, startGoogleDriveAuth, startGoogleCalendarAuth, startGmailAuth, fetchIntegrations, fetchDatasources } from '../../api';
import { host } from '../../../platform/host';

const BROWSER_OAUTH_START = {
  google_drive: startGoogleDriveAuth,
  google_calendar: startGoogleCalendarAuth,
  gmail: startGmailAuth,
};
const BROWSER_OAUTH_TITLE = {
  google_drive: 'Google Drive connected',
  google_calendar: 'Google Calendar connected',
  gmail: 'Gmail connected',
};
import { submitDataVaultForm } from '../../api';

const BROWSER_OAUTH_POLL_MS    = 3000;
const BROWSER_OAUTH_TIMEOUT_MS = 2 * 60 * 1000;

const FONT_BODY = 'var(--font-body)';

// One-shot keyframes used by the form: appearance animation on the
// panel + the small spinner inside the live status row. Mounting
// these once at the module level (rather than per-component) keeps
// the DOM clean and ensures the rules are present before either
// child renders.
let _DVF_KEYFRAMES_INJECTED = false;
function _ensureKeyframes() {
  if (_DVF_KEYFRAMES_INJECTED) return;
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-dvf-keyframes', '');
  style.textContent = `
@keyframes dvf-spin { to { transform: rotate(360deg); } }
@keyframes dvf-appear {
  from { opacity: 0; transform: translateY(6px) scale(0.985); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}
`;
  document.head.appendChild(style);
  _DVF_KEYFRAMES_INJECTED = true;
}

export function DataVaultFormPanel({ conversationId, onContinue, onSubmit, onNavigateToConnectors, highlighted = false }) {
  const [spec, setSpec] = useState(() => getForm(conversationId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Track the form_id we last animated in for. A new form for the
  // same conversation (e.g. user starts a second connection in the
  // same chat) should re-trigger the appearance, but a patch into
  // the same form_id should NOT — it'd be jarring to re-fade on
  // every status update.
  const animatedFormIdRef = useRef(null);
  const [appearKey, setAppearKey] = useState(0);
  // Status toast: shown when spec.status_text is set; user can
  // dismiss with × . Once dismissed for a given text, it stays
  // hidden — but a NEW status text (e.g. probe phase advanced)
  // re-shows the toast with the new content. Tracked here rather
  // than on the spec so server-side updates don't have to know
  // anything about UI dismissal state.
  const [dismissedStatus, setDismissedStatus] = useState(null);
  // Active method for the panel chrome — when set, the header bar
  // becomes the "← Back to options · <method>" breadcrumb. Source of
  // truth lives in formStore so DataVaultForm can write it (on pick)
  // and the panel can clear it (on "back").
  const [activeMethodId, setActiveMethodId] = useState(
    () => (conversationId ? getSelectedMethod(conversationId) : null)
  );

  useEffect(() => { _ensureKeyframes(); }, []);

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
      setBusy(true);
      try {
        const result = await host.oauthConnect({
          authUrl: oauthMeta.auth_url,
          tokenUrl: oauthMeta.token_url,
          clientId,
          clientSecret,
          scopes: oauthMeta.scopes,
          extraAuthParams: oauthMeta.extra_auth_params,
        });
        if (!result || result.ok === false) {
          setError(result?.reason || 'OAuth flow failed.');
          setBusy(false);
          return;
        }
        // Build the credentials payload. Keep the user-entered
        // client_id / client_secret too — they're needed later for
        // refresh-token exchanges.
        const oauthValues = {
          ...(values || {}),
          client_id: clientId,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          refresh_token: result.refresh_token || '',
          access_token: result.access_token || '',
          scope: result.scope || (oauthMeta.scopes || []).join(' '),
          token_type: result.token_type || 'Bearer',
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
              name: spec._existing_name || '',
              values: oauthValues,
            });
            // Flip the form into its success branch so the user gets
            // a clear "connected" affordance + the standard
            // Close / View connectors actions.
            patchForm(conversationId, {
              form_id: spec.form_id,
              _is_success: true,
              title: `${saved.label || connectorId} connected`,
              subtitle: 'Saved to Anton\'s data vault. Anton can use this connection in tasks.',
            });
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
          values: values || {},
          skipped: skipped || [],
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
          values: values || {},
          skipped: skipped || [],
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
      {/* Header bar — when a method is active, the bar IS the
          "← Back to options · <method>" navigation. Otherwise it's
          a plain "Connect" label. The X close button sits flush
          right in either case. */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        borderBottom: '1px solid var(--line)',
        minHeight: 42,
      }}>
        {activeMethodSpec ? (
          <button
            type="button"
            onClick={onBackToOptions}
            disabled={busy}
            title="Back to options"
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
            color: 'var(--ink)', letterSpacing: '-0.005em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            Connect
          </div>
        )}
        <button
          type="button"
          onClick={handleClose}
          title="Close form"
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
      </div>

      <div style={{ padding: '10px 14px 14px' }}>
        {/* Status toast — sits at the top of the panel body so it
            always occupies the same slot, doesn't displace the
            form below, and can be dismissed independently of any
            form-level activity. The toast self-resurrect-s when a
            new status_text arrives (handled by `showStatusToast`). */}
        {showStatusToast && (
          <div
            // `key` on the status text means React swaps the node
            // when the text changes, re-firing the appearance
            // animation for a subtle "new update" cue without
            // needing a separate trigger.
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
                animation: 'dvf-spin 720ms linear infinite',
              }}
            />
            <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {spec.status_text}
            </span>
            <button
              type="button"
              onClick={() => setDismissedStatus(spec.status_text)}
              title="Dismiss"
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
          </div>
        )}
        <DataVaultForm
          spec={spec}
          busy={busy}
          onAction={handleAction}
          conversationId={conversationId}
          onMethodChange={async (methodId) => {
            if (methodId !== 'browser_oauth_builtin') return;
            const engine = spec.engine || 'google_drive';
            const startFn = BROWSER_OAUTH_START[engine] || startGoogleDriveAuth;
            const successTitle = BROWSER_OAUTH_TITLE[engine] || 'Connected';
            setBusy(true);
            setError('');
            try {
              const result = await startFn();
              if (!result?.authUrl) throw new Error('Could not start Google sign-in. Is the server running?');
              window.open(result.authUrl, '_blank');
              const startedAt = result.startedAt || '';
              const deadline = Date.now() + BROWSER_OAUTH_TIMEOUT_MS;
              const poll = setInterval(async () => {
                try {
                  if (Date.now() > deadline) {
                    clearInterval(poll);
                    setBusy(false);
                    setError('Sign-in timed out. Please try again.');
                    return;
                  }
                  const data = await fetchIntegrations();
                  const item = (data?.items || []).find((i) => i.id === engine);
                  const lastSuccessAt = item?.oauth?.lastSuccessAt || '';
                  if (lastSuccessAt && (!startedAt || lastSuccessAt >= startedAt)) {
                    clearInterval(poll);
                    setBusy(false);
                    try { await fetchDatasources(); } catch { /* best effort */ }
                    patchForm(conversationId, {
                      form_id: spec.form_id,
                      _is_success: true,
                      title: successTitle,
                      subtitle: "Saved to Anton's data vault. Anton can now use this connection in tasks.",
                    });
                  }
                } catch { /* keep polling */ }
              }, BROWSER_OAUTH_POLL_MS);
            } catch (e) {
              setError(e?.message || 'Could not start Google sign-in.');
              setBusy(false);
            }
          }}
        />
        {error && (
          <div style={{
            marginTop: 10, padding: '8px 10px', borderRadius: 7,
            background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
            color: 'var(--danger)', fontSize: 12,
          }}>{error}</div>
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
