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
import { RailCard } from '../rail/RailCard';
import { DataVaultForm } from './DataVaultForm';
import { clearForm, getForm, subscribe } from './formStore';
import { submitDataVaultForm } from '../../api';

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

export function DataVaultFormPanel({ conversationId, onContinue, onSubmit, onNavigateToConnectors }) {
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

  useEffect(() => { _ensureKeyframes(); }, []);

  useEffect(() => {
    setSpec(getForm(conversationId));
    return subscribe(conversationId, (next) => setSpec(next));
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

  // The toast surfaces whenever the current status_text is set
  // AND it isn't equal to the one the user just dismissed. New
  // updates with different text re-open the toast automatically.
  const showStatusToast = !!spec?.status_text && spec.status_text !== dismissedStatus;

  const handleAction = async ({ id, kind, values, skipped }) => {
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
          formSpec: spec,
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

  return (
    // `key` flips when a NEW form_id arrives, so React remounts the
    // wrapper and the appearance animation fires fresh. Patches that
    // only update the existing form (status_text, fields…) keep the
    // same form_id → no remount → no re-animation.
    <div
      key={appearKey}
      style={{
        position: 'relative',
        animation: 'dvf-appear 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
      }}
    >
      <button
        type="button"
        onClick={handleClose}
        title="Close form"
        aria-label="Close form"
        style={{
          position: 'absolute',
          top: 4, right: 4, zIndex: 5,
          width: 26, height: 26, borderRadius: 6,
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
    <RailCard
      title="Connect"
      defaultOpen
      noChevron
      maxBodyHeight={null}
    >
      <div style={{ padding: '4px 0 8px' }}>
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
        <DataVaultForm spec={spec} busy={busy} onAction={handleAction} />
        {error && (
          <div style={{
            marginTop: 10, padding: '8px 10px', borderRadius: 7,
            background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
            color: 'var(--danger)', fontSize: 12,
          }}>{error}</div>
        )}
      </div>
    </RailCard>
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
