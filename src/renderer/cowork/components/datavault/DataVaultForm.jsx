// `<DataVaultForm>` — renders one data-vault-form spec.
//
// Spec shape (Phase 1):
//   {
//     form_id: string                    // server handle
//     logo: string | null                // URL OR Ico.* name
//     logo_color: string | null          // CSS color for the icon (when icon name)
//     title: string
//     subtitle?: string
//     form_warning?: string              // banner above the fields
//     form_error?: string                // red banner above the fields
//     fields: [
//       {
//         name, label, type ('text'|'password'|'select'|'textarea'|'boolean'|'url'),
//         required?, placeholder?, default?, value?,
//         options?: [{value,label}],
//         error?: string                 // shown under the field
//         warning?: string               // amber under the field
//         help?: string                  // muted under the field
//         skipable?: boolean
//       }
//     ],
//     actions: [
//       { id, label, kind?: 'primary'|'skip'|'cancel', field?: string }
//     ]
//   }
//
// Submit / skip / cancel are surfaced via `onAction({id, kind, values, skipped})`.
// The host (the side panel) is responsible for posting to the
// server and dispatching the chat continuation.

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { Alert, Badge, Button, Checkbox, Collapsible, Select, Input, Textarea } from '../ui';
import {
  setFormState,
  setSelectedMethod,
  getSelectedMethod,
  subscribeSelectedMethod,
} from './formStore';
import HowToModal from './HowToModal';
import { computeHeroView, orderMethods } from './methodHero';
import { host } from '../../../platform/host';
import { ANTON_VAULT_KEEP } from '../../api';

const FONT_BODY    = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-display)';
const FONT_MONO    = 'var(--font-mono)';

function FormLogo({ logo, logoUrl, color, connectorId }) {
  // Prefer the real brand mark: an explicit logo_url, else the static
  // `logos/<connector_id>.svg` asset the connectors list uses (ENG-1534).
  // The form spec's `logo_url` is often empty at runtime, which used to
  // drop us to the generic `logo` glyph ("code" → "<>") on the
  // "Authorize with <Provider>" button. On a missing/broken asset the
  // `onError` swaps to the glyph, so connectors without an svg still look
  // fine. `failedSrc` (not a boolean) means a new connector's src is
  // retried rather than stuck on the previous one's failure.
  const [failedSrc, setFailedSrc] = useState(null);
  const src = logoUrl || (connectorId ? `logos/${connectorId}.svg` : null);
  if (src && src !== failedSrc) {
    return (
      <span style={{
        display: 'inline-grid', placeItems: 'center',
        width: 36, height: 36, borderRadius: 8,
        background: 'var(--surface-2)',
      }}>
        <img
          src={src}
          alt=""
          onError={() => setFailedSrc(src)}
          style={{ width: 22, height: 22, objectFit: 'contain' }}
        />
      </span>
    );
  }
  const fn = (logo && Ico[logo]) || Ico.database;
  return (
    <span style={{
      display: 'inline-grid', placeItems: 'center',
      width: 36, height: 36, borderRadius: 8,
      background: 'var(--surface-2)',
      color: color || 'var(--ink-3)',
    }}>
      {fn(20)}
    </span>
  );
}

function FieldInput({ field, value, onChange, disabled, inputRef }) {
  const baseStyle = {
    width: '100%', boxSizing: 'border-box',
    padding: '8px 10px', borderRadius: 7,
    background: 'var(--surface-2)',
    border: '1px solid var(--line)',
    color: 'var(--ink)',
    fontFamily: field.type === 'password' ? FONT_MONO : FONT_BODY,
    fontSize: 13,
    outline: 'none',
    opacity: disabled ? 0.6 : 1,
  };

  // Sentinel rendering — when the underlying state still equals
  // `ANTON_VAULT_KEEP`, the field hasn't been touched since the
  // modify-flow pre-fill. Show the input visually empty with a
  // placeholder that explains the "saved" semantics. The state
  // stays as the sentinel until the user types; the first keystroke
  // replaces it via the parent's onChange (controlled-input
  // semantics — `e.target.value` carries just the typed character
  // because the displayed value is empty). On submit, fields whose
  // state is still the sentinel pass through and resolve server-
  // side against the prior record.
  const isSentinel = value === ANTON_VAULT_KEEP;
  const displayValue = isSentinel ? '' : (value ?? field.default ?? '');
  // For sentinel-bearing fields the placeholder doubles as the
  // "saved" indicator. Eight asterisks is the convention users
  // already recognize from password managers — short, unambiguous,
  // and visually distinct from a normal placeholder hint.
  const placeholder = isSentinel
    ? '********'
    : (field.placeholder || '');

  if (field.type === 'select') {
    return (
      <Select
        value={displayValue}
        disabled={disabled}
        onValueChange={onChange}
        ariaLabel={field.label}
        style={{ background: 'var(--surface-2)', borderRadius: 7 }}
        options={[
          ...(!field.required ? [{ value: '', label: '—' }] : []),
          ...(field.options || []).map((opt) => ({ value: opt.value, label: opt.label || opt.value })),
        ]}
      />
    );
  }
  if (field.type === 'textarea') {
    return (
      <Textarea
        ref={inputRef}
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        rows={4}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        onChange={(v) => onChange(v)}
        style={{ ...baseStyle, fontFamily: FONT_MONO, lineHeight: 1.4, resize: 'vertical' }}
      />
    );
  }
  if (field.type === 'boolean') {
    return (
      <label style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-2)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}>
        <Checkbox
          // Booleans never carry the sentinel — modify-flow only
          // replaces secret string fields. For booleans the saved
          // value lands directly in `default` and the state mirrors
          // it. Sentinel guard kept for safety: a stray sentinel on
          // a boolean field renders unchecked.
          checked={!isSentinel && !!value}
          disabled={disabled}
          onCheckedChange={(v) => onChange(v)}
          aria-label={field.checkbox_label || field.label}
        />
        {field.checkbox_label || field.label}
      </label>
    );
  }
  // text, password, url, default
  return (
    <Input
      ref={inputRef}
      type={field.type === 'password' ? 'password' : (field.type === 'url' ? 'url' : 'text')}
      value={displayValue}
      placeholder={placeholder}
      autoComplete={field.type === 'password' ? 'current-password' : 'off'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      disabled={disabled}
      onChange={(v) => onChange(v)}
      style={baseStyle}
    />
  );
}

export function DataVaultForm({
  spec, busy = false, onAction, onMethodChange, conversationId,
  userLabel, onUserLabelChange,
}) {
  // ── Multi-method shape ──────────────────────────────────────────
  // A form can either be single-method (top-level `fields[]` array,
  // legacy shape) or multi-method (`methods[]` array of method
  // definitions, each with their own fields+actions). The user picks
  // a method first, then fills in fields, then submits with an
  // `auth_method` tag so the server probe knows which to test.
  const visibleMethods = Array.isArray(spec?.methods)
    ? spec.methods.filter((m) => !m.hidden)
    : [];
  const isMultiMethod = visibleMethods.length > 0;
  // Local override (user picked a method client-side). Falls back to
  // whatever the server set in `spec.selected_method`. Cleared when
  // a brand-new form arrives (new form_id) and when the user clicks
  // "change" on the breadcrumb.
  // Selected-method override now lives in formStore so the panel
  // chrome (the breadcrumb header bar) can read AND clear it. We
  // mirror the store value into local state so React re-renders on
  // change.
  const [localSelectedMethod, setLocalSelectedMethodState] = useState(
    () => (conversationId ? getSelectedMethod(conversationId) : null)
  );
  useEffect(() => {
    if (!conversationId) return undefined;
    setLocalSelectedMethodState(getSelectedMethod(conversationId));
    return subscribeSelectedMethod(conversationId, (mid) => {
      setLocalSelectedMethodState(mid || null);
    });
  }, [conversationId]);
  const setLocalSelectedMethod = (mid) => {
    if (conversationId) setSelectedMethod(conversationId, mid || null);
    else setLocalSelectedMethodState(mid || null);
  };
  // Single-method auto-select — when a connector ships only ONE
  // method (e.g. PostHog: just an API key paste), there's no choice
  // to make, so we skip the picker entirely. The form opens directly
  // on that method's fields. We pretend the spec had `selected_method`
  // set; the breadcrumb header sees a single-method form and hides
  // itself (nothing to "go back" to).
  const onlyMethodId = (isMultiMethod && visibleMethods.length === 1)
    ? visibleMethods[0].id
    : null;
  const activeMethodId = localSelectedMethod || spec?.selected_method || onlyMethodId || null;
  const activeMethod = isMultiMethod
    ? (visibleMethods.find((m) => m.id === activeMethodId) || null)
    : null;
  // "How to" modal at the form-fill stage — surfaced from the
  // bottom-left of the actions row (opposite the primary submit
  // button) so docs are reachable without crowding the field area
  // or the breadcrumb.
  const [formHowToOpen, setFormHowToOpen] = useState(false);

  // The fields the form is currently rendering — the active method's
  // for multi-method, or the top-level fields[] for single-method.
  const fields = isMultiMethod ? (activeMethod?.fields || []) : (spec?.fields || []);

  // Per-(form, method) input state so flipping methods preserves
  // anything typed under each one. Storing inside a Map keyed by
  // `${form_id}::${method_id || 'default'}` keeps the state shape flat
  // and easy to reset on a brand-new form.
  const [valuesByKey, setValuesByKey] = useState({});
  const [skippedByKey, setSkippedByKey] = useState({});
  const [requiredErrorsByKey, setRequiredErrorsByKey] = useState({});
  /* Focus target for the first field that fails the required check.
     `fieldRefs` holds the real control, which is what we want the caret in,
     but only `Input` and `Textarea` forward a ref — a `select` or `boolean`
     field puts nothing there. `fieldContainerRefs` holds the wrapper, which
     every field type has, so the error is at least scrolled into view. */
  const fieldRefs = useRef({});
  const fieldContainerRefs = useRef({});

  const initialFor = (fs) => {
    const out = {};
    for (const f of (fs || [])) {
      out[f.name] = f.value ?? f.default ?? (f.type === 'boolean' ? false : '');
    }
    return out;
  };

  // Reset everything when a NEW form replaces the old one.
  const lastFormIdRef = useRef(spec?.form_id);
  useEffect(() => {
    if (spec?.form_id !== lastFormIdRef.current) {
      lastFormIdRef.current = spec?.form_id;
      setValuesByKey({});
      setSkippedByKey({});
      setRequiredErrorsByKey({});
      setLocalSelectedMethod(null);
    }
  }, [spec?.form_id]);

  const stateKey = `${spec?.form_id || ''}::${activeMethodId || 'default'}`;
  const values = valuesByKey[stateKey] || initialFor(fields);
  const skipped = skippedByKey[stateKey] || new Set();
  const requiredErrors = requiredErrorsByKey[stateKey] || {};

  // Publish a redacted snapshot of the form state so the chat layer
  // can inject context into messages sent during a connect task.
  // Secret fields (password type or `secret: true`) are flagged but
  // never carry their value.
  useEffect(() => {
    if (!conversationId || !spec) return;
    const fieldSnapshot = {};
    for (const f of fields || []) {
      if (skipped?.has?.(f.name)) continue;
      const isSecret = !!f.secret || f.type === 'password';
      const raw = values?.[f.name];
      const filled = typeof raw === 'string' ? raw.length > 0 : raw != null && raw !== '';
      if (!filled) continue;
      fieldSnapshot[f.name] = isSecret ? '__REDACTED__' : raw;
    }
    setFormState(conversationId, {
      formId: spec.form_id || null,
      title: spec.title || null,
      method: activeMethodId || null,
      methodLabel: activeMethod?.label || null,
      fields: fieldSnapshot,
    });
  }, [conversationId, spec?.form_id, activeMethodId, activeMethod?.label, spec?.title, values, skipped]);

  const setValues = (updater) => {
    setValuesByKey((prev) => {
      const cur = prev[stateKey] || initialFor(fields);
      const next = typeof updater === 'function' ? updater(cur) : updater;
      return { ...prev, [stateKey]: next };
    });
  };
  const setSkipped = (updater) => {
    setSkippedByKey((prev) => {
      const cur = prev[stateKey] || new Set();
      const next = typeof updater === 'function' ? updater(cur) : updater;
      return { ...prev, [stateKey]: next };
    });
  };

  if (!spec) return null;

  // Success state — the agent endpoint flips `_is_success` after a
  // save. Replace the noisy fields/actions surface with a green
  // check + the title/subtitle. The user can dismiss via the panel's
  // close (×) or the single "Close" action below.
  if (spec._is_success) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 14,
        fontFamily: FONT_BODY,
        padding: '14px 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{
            display: 'inline-grid', placeItems: 'center',
            width: 36, height: 36, borderRadius: 8,
            background: 'color-mix(in srgb, var(--success) 18%, var(--surface))',
            color: 'var(--success)',
            border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)',
            boxShadow: '0 0 12px var(--success-glow)',
          }}>{Ico.check(20)}</span>
          <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="s-h3" style={{
              color: 'var(--ink)',
            }}>{spec.title || 'Connected'}</div>
            {spec.subtitle && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                {spec.subtitle}
              </div>
            )}
          </div>
        </div>
        {(spec.engine === 'google_drive' || spec._connector_id === 'google_drive') && (
          <Alert variant="info" icon="ℹ️">
            This connection can access files it created, plus any you pick yourself — use "Add files from Google Drive" in a chat's + menu, or "Select files from Google Drive" in this connection's settings.
          </Alert>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {/* On success we always offer two routes:
                 • secondary "Close" — just dismiss the panel
                 • primary "View connectors" — jump to the Connect
                   Apps and Data page where the user can rename,
                   remove, or attach the new connection. The host
                   wires `view_connectors` to its navigate handler.
              The spec's own `actions` list overrides this default
              when present, so the probe can customise the wording
              if it wants (e.g. "Open dashboard"). */}
          {(spec.actions && spec.actions.length > 0
            ? spec.actions
            : [
                { id: 'dismiss', label: 'Close', kind: 'cancel' },
                { id: 'view_connectors', label: 'View connectors →', kind: 'primary' },
              ]
          ).map((a) => (
            <Button
              key={a.id}
              variant={a.kind === 'primary' ? 'primary' : 'subtle'}
              onClick={() => onAction?.({ id: a.id, kind: a.kind || 'cancel' })}
            >{a.label}</Button>
          ))}
        </div>
      </div>
    );
  }

  const updateField = (name, v) => {
    setValues((prev) => ({ ...prev, [name]: v }));
    setRequiredErrorsByKey((prev) => {
      if (!prev[stateKey]?.[name]) return prev;
      const next = { ...prev[stateKey] };
      delete next[name];
      return { ...prev, [stateKey]: next };
    });
    setSkipped((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  const skipField = (name) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  };

  const dispatch = (action) => {
    if (!onAction) return;
    if (action.kind === 'cancel') {
      onAction({ id: action.id, kind: 'cancel' });
      return;
    }
    if (action.kind === 'primary') {
      const missing = fields.filter((field) => {
        if (!field.required || skipped.has(field.name)) return false;
        /* PostHog resolves its numeric project ID from the user's personal
           API key in the panel before the connector request is sent, and the
           user can supply it either by picking from the discovered list or by
           typing it directly. So require one of the two rather than both.
           Until discovery has added the choice field an empty `project_id` is
           what triggers discovery, so nothing is required yet; once the choice
           exists, a submit with neither filled in has to say so instead of
           running discovery a second time. */
        if (spec?._connector_id === 'posthog'
          && (field.name === 'project_id' || field.name === 'posthog_project_choice')) {
          if (!fields.some((f) => f.name === 'posthog_project_choice')) return false;
          const supplied = String(values.project_id || '').trim()
            || String(values.posthog_project_choice || '').trim();
          return !supplied && field.name === 'posthog_project_choice';
        }
        const value = values[field.name];
        return value === null || value === undefined || String(value).trim() === '';
      });
      if (missing.length) {
        const errors = Object.fromEntries(
          missing.map((field) => [field.name, `${field.label || field.name} is required.`]),
        );
        setRequiredErrorsByKey((prev) => ({ ...prev, [stateKey]: errors }));
        requestAnimationFrame(() => {
          const name = missing[0].name;
          (fieldRefs.current[name] || fieldContainerRefs.current[name])?.focus?.();
        });
        return;
      }
    }
    // Strip any field marked as skipped from the values payload.
    const cleanValues = {};
    for (const k of Object.keys(values)) {
      if (!skipped.has(k)) cleanValues[k] = values[k];
    }
    onAction({
      id: action.id,
      kind: action.kind || 'primary',
      values: cleanValues,
      skipped: [...skipped],
      // Tell the panel which method the user picked (multi-method
      // forms only). The agent uses this to decide which probe path
      // to test and to write into the saved connection.
      authMethod: activeMethodId || null,
    });
  };

  // One-click "Authorize with <Provider>" from the picker (ENG-1534).
  // Selects the recommended in-browser OAuth method — same as a plain
  // card pick — which is enough on its own: the host's onMethodChange
  // already auto-starts the connect immediately for a fields-less
  // method (see DataVaultFormPanel). We must NOT also dispatch onAction
  // here: for `browser_oauth_builtin` that hits handleAction's own
  // auto-start branch too, so a single hero click would launch the
  // OAuth flow twice concurrently. Only wired for fields-less methods
  // (see MethodPicker), so a method with required fields still reveals
  // them first via the normal pick-then-submit path.
  const authorizeWithMethod = (method) => {
    if (!method) return;
    setLocalSelectedMethod(method.id);
    onMethodChange?.(method.id);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 14,
      fontFamily: FONT_BODY,
    }}>
      {/* Header — logo + title + subtitle */}
      {/* Header — logo + title only. The subtitle (`spec.subtitle`)
          is intentionally NOT rendered here: the chat above already
          carries the explanation of the connection, and a second
          line under the title was just visual clutter making the
          form feel busy. The field labels + help text below carry
          their own context. Hidden while the user is on the method
          picker for multi-method forms (the picker has its own
          "Pick how you want to connect:" caption). */}
      {!(isMultiMethod && !activeMethod) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <FormLogo logo={spec.logo} logoUrl={spec.logo_url} color={spec.logo_color} connectorId={spec._connector_id || spec.engine} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="s-h3" style={{
              color: 'var(--ink)',
            }}>{spec.title || 'Connect'}</div>
          </div>
        </div>
      )}

      {/* Generic "name this connection" field — applies to every connector
          regardless of method, so it renders right under the title rather
          than inside the per-method fields list below. Hidden on success
          (host passes `userLabel={undefined}` in that case) and while the
          user is still on the method picker (nothing to label yet). */}
      {userLabel !== undefined && !(isMultiMethod && !activeMethod) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label htmlFor="connection-user-label" style={{
            fontSize: 12, color: 'var(--ink-3)', fontWeight: 500,
          }}>
            Label
          </label>
          <Input
            id="connection-user-label"
            type="text"
            value={userLabel}
            onChange={(v) => onUserLabelChange?.(v)}
            disabled={busy}
            placeholder={spec.engine || spec._connector_id || 'e.g. prod-db'}
          />
        </div>
      )}

      {/* Note: live status (`status_text`) is rendered as a
          dismissible TOAST by DataVaultFormPanel — sitting outside
          the form body so per-step status updates don't displace
          the fields. The form itself just disables inputs while
          probing (`busy` is set by the host) and otherwise stays
          structurally identical to its idle state. */}

      {/* Multi-method picker — shown when the form has methods[] and
          no method is currently active (neither user-picked nor
          server-pre-selected). User clicks a card to pick. */}
      {isMultiMethod && !activeMethod && (
        <MethodPicker
          spec={spec}
          methods={visibleMethods}
          onPick={(id) => {
            setLocalSelectedMethod(id);
            onMethodChange?.(id);
          }}
          onAuthorize={authorizeWithMethod}
          busy={busy}
        />
      )}

      {/* Method breadcrumb used to live here — moved up into the
          panel's header bar (DataVaultFormPanel reads selected method
          from formStore). The panel's "← Back to options · <method>"
          replaces the static "Connect" title once a method is picked,
          so the surface gains vertical space for fields. */}

      {/* Everything below is hidden until a method is chosen on a
          multi-method form. Single-method forms never gate. */}
      {(!isMultiMethod || activeMethod) && <>
      {/* Form-level banners */}
      {spec.form_error && (
        <Alert variant="danger">{spec.form_error}</Alert>
      )}
      {spec.form_warning && (
        <Alert variant="warning">{spec.form_warning}</Alert>
      )}

      {/* Fields — always rendered. While a probe is in flight the
          host disables inputs via `busy`, so the layout stays put
          and the user can still see what they entered (without it
          jumping out of view when the status row appears).
          Uses the `fields` const (line 155) so multi-method specs
          render the chosen method's fields, not just `spec.fields`
          (which is empty for multi-method forms — picking a method
          would otherwise leave the user staring at an empty body
          and a Submit button, exactly the "confirm-and-continue"
          step we don't want). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {fields.map((f) => {
          const isSkipped = skipped.has(f.name);
          // Identity / read-only marker. The modify-flow pins
          // `name` (and could pin others) so the vault row key
          // stays stable. Locked fields render disabled and lose
          // the skip affordance.
          const isLocked = !!f._locked;
          return (
            <div
              key={f.name}
              ref={(node) => { fieldContainerRefs.current[f.name] = node; }}
              tabIndex={-1}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: isSkipped ? 0.55 : 1, outline: 'none' }}
            >
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                gap: 8,
              }}>
                <label style={{
                  fontSize: 12, color: 'var(--ink-3)', fontWeight: 500,
                }}>
                  {f.label || f.name}
                  {f.required && !isSkipped && (
                    <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>
                  )}
                </label>
                {/* Every field is skippable by default. The user may
                    not have the requested value, or the form may be
                    asking the wrong thing — Anton uses the skipped
                    set on the next iteration to figure out the
                    minimum-viable connection. Per-field opt-out via
                    `skipable: false` in the spec is still respected.
                    Locked fields (modify-flow identity) drop the
                    skip affordance entirely — there's nothing for
                    Anton to figure out about a fixed row key. */}
                {f.skipable !== false && !isLocked && (
                  <button
                    type="button"
                    onClick={() => isSkipped ? updateField(f.name, values[f.name] ?? '') : skipField(f.name)}
                    disabled={busy}
                    style={{
                      cursor: busy ? 'not-allowed' : 'pointer',
                      background: 'transparent', border: 0, padding: 0,
                      fontFamily: FONT_MONO, fontSize: 10.5,
                      color: 'var(--ink-4)', letterSpacing: '0.04em',
                    }}
                  >{isSkipped ? 'unskip' : 'skip'}</button>
                )}
              </div>
              {!isSkipped && (
                <FieldInput
                  field={f}
                  value={values[f.name]}
                  onChange={(v) => updateField(f.name, v)}
                  disabled={busy || isLocked}
                  inputRef={(node) => { fieldRefs.current[f.name] = node; }}
                />
              )}
              {isSkipped && (
                <div style={{
                  padding: '8px 10px', borderRadius: 7,
                  background: 'var(--surface-2)',
                  border: '1px dashed var(--line-2)',
                  color: 'var(--ink-4)', fontSize: 12,
                  fontFamily: FONT_BODY, fontStyle: 'italic',
                }}>Skipped — the agent will figure this one out.</div>
              )}
              {(requiredErrors[f.name] || f.error) && !isSkipped && (
                <div style={{
                  fontSize: 11.5, color: 'var(--danger)',
                }}>{requiredErrors[f.name] || f.error}</div>
              )}
              {f.warning && !isSkipped && (
                <div style={{
                  fontSize: 11.5, color: 'color-mix(in srgb, var(--accent) 80%, var(--ink-2))',
                }}>{f.warning}</div>
              )}
              {/* Transient per-field status (e.g. "Validating…"). The
                  probe sets this via `set_field_status` and clears it
                  with the same tool + null. Renders below error/warning
                  but is shown alongside them — they describe different
                  things (status = activity, error = outcome). */}
              {f.status && !isSkipped && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 11.5, color: 'var(--ink-3)',
                }}>
                  <span
                    aria-hidden
                    style={{
                      width: 9, height: 9, flex: '0 0 9px',
                      borderRadius: '50%',
                      border: '1.5px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                      borderTopColor: 'var(--accent)',
                      animation: 'spin 720ms linear infinite',
                    }}
                  />
                  {f.status}
                </div>
              )}
              {f.help && !f.error && !f.warning && !f.status && (
                <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{f.help}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions — always rendered too. Disabled while busy. The
          active method's actions take precedence; falls back to the
          form's top-level actions, then a generic Submit button.
          Layout: How-to link on the left (when the active method
          ships docs), action buttons on the right. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, flexWrap: 'wrap',
        paddingTop: 4,
      }}>
        {(() => {
          const m = activeMethod || spec || {};
          const hasHowTo = typeof m.how_to === 'string' && m.how_to.trim().length > 0;
          const hasHelp = hasHowTo || !!m.help_url;
          if (!hasHelp) return <span aria-hidden style={{ width: 0 }} />;
          const onClick = (e) => {
            e?.stopPropagation?.();
            e?.preventDefault?.();
            if (hasHowTo) {
              setFormHowToOpen(true);
            } else if (m.help_url) {
              try { host.openExternal(m.help_url); }
              catch { window.open(m.help_url, '_blank', 'noreferrer'); }
            }
          };
          const sharedStyle = {
            padding: '4px 0',
            fontSize: 12, fontWeight: 500,
            color: 'var(--accent)',
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
            textDecoration: 'none',
          };
          return hasHowTo ? (
            <button
              type="button"
              onClick={onClick}
              style={sharedStyle}
              onMouseOver={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
              onMouseOut={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
            >How to?</button>
          ) : (
            <a
              href={m.help_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClick}
              style={sharedStyle}
              onMouseOver={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
              onMouseOut={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
            >How to?</a>
          );
        })()}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(activeMethod?.actions || spec.actions || [{ id: 'submit', label: 'Submit', kind: 'primary' }]).map((a) => {
          // Modify mode swaps the primary action's label to make
          // the destination explicit — "Save changes" reads as an
          // overwrite, "Connect" implies a fresh attachment. Only
          // touches the visible label; the action id + kind go
          // through unchanged so server-side handling is identical.
          const label = (spec._modify && a.kind === 'primary')
            ? 'Save changes'
            : a.label;
          return (
            <Button
              key={a.id}
              variant={
                a.kind === 'primary' ? 'primary'
                  : a.kind === 'cancel' ? 'subtle'
                  : 'default'
              }
              onClick={() => {
                // Field-level skip via an action button (vs the per-field
                // skip control). Useful when the spec wants a one-shot
                // "let Anton pick this" affordance.
                if (a.kind === 'skip' && a.field) {
                  skipField(a.field);
                  return;
                }
                dispatch(a);
              }}
              disabled={busy && a.kind !== 'cancel'}
              // `is-busy` paints a gentle accent pulse while the probe is
              // in flight (globals.css `.btn.primary.is-busy`). Overrides
              // the default disabled-dim so the button reads as "working"
              // rather than "dead."
              className={a.kind === 'primary' && busy ? 'is-busy' : undefined}
            >
              {a.kind === 'primary' && busy ? 'Working…' : label}
            </Button>
          );
        })}
        </div>
      </div>
      </>}

      {/* How-to modal for the form-fill stage — wired to the
          left-aligned link in the actions row. Opens the active
          method's docs in a portaled overlay (escaping the form's
          stacking context) so the docs read as a centered modal. */}
      <HowToModal
        open={formHowToOpen}
        title={`How to · ${(activeMethod || spec)?.label || 'Connect'}`}
        content={(activeMethod || spec)?.how_to || ''}
        onClose={() => setFormHowToOpen(false)}
      />
    </div>
  );
}

// ── Method picker ─────────────────────────────────────────────────
//
// Vertical stack of cards, one per method. Each card shows label,
// description, and an optional "Recommended" pill. Click selects
// the method (host pulls the choice into local state and the form
// switches to the picked method's fields).
function MethodPicker({ spec, methods, onPick, onAuthorize, busy }) {
  // When a method exposes `how_to` markdown, clicking the help
  // affordance opens an in-app modal instead of an external URL.
  // We hold the active method so the modal can show its title.
  const [howToFor, setHowToFor] = useState(null);
  // ── Hero promotion (ENG-1534) ───────────────────────────────────
  // Lead with the single recommended method as a prominent button, and
  // tuck the rest under a quiet "See other options" disclosure — so an
  // OAuth connector reads as one obvious "Authorize with X" action
  // instead of a menu of technical-sounding cards. Recommended methods
  // already float to the front (stable). Decision logic lives in the
  // pure, unit-tested `computeHeroView`.
  const { hero, rest, heroOneClick, heroLabel, heroHelper, providerName } =
    computeHeroView(methods, spec);
  const orderedMethods = orderMethods(methods);

  const helpFor = (m) => {
    const hasHowTo = typeof m.how_to === 'string' && m.how_to.trim().length > 0;
    const hasHelp = hasHowTo || !!m.help_url;
    const handleHelp = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (hasHowTo) setHowToFor(m);
      else if (m.help_url) {
        try { host.openExternal(m.help_url); }
        catch { window.open(m.help_url, '_blank', 'noreferrer'); }
      }
    };
    return { hasHowTo, hasHelp, handleHelp };
  };

  const renderHero = () => {
    const { hasHelp, hasHowTo, handleHelp } = helpFor(hero);
    const label = heroLabel;
    const helper = heroHelper;
    const onHeroClick = () => {
      if (busy) return;
      if (heroOneClick) onAuthorize?.(hero);
      else onPick?.(hero.id);
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          type="button"
          disabled={busy}
          onClick={onHeroClick}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            width: '100%', textAlign: 'left',
            padding: '12px 14px', borderRadius: 10,
            background: 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
            color: 'var(--ink)', cursor: busy ? 'not-allowed' : 'pointer',
            fontFamily: FONT_BODY, minWidth: 0,
            transition: 'transform 120ms ease, background 120ms ease, border-color 120ms ease',
            outline: 'none',
          }}
          onMouseOver={(e) => { if (!busy) e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
          onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)'; }}
          onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
        >
          <FormLogo logo={spec?.logo} logoUrl={spec?.logo_url} color={spec?.logo_color} connectorId={spec?._connector_id || spec?.engine} />
          <span style={{
            display: 'flex', flexDirection: 'column', gap: 2,
            minWidth: 0, flex: '1 1 auto', overflowWrap: 'anywhere', wordBreak: 'break-word',
          }}>
            <span style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--ink)' }}>
              {busy ? 'Working…' : label}
            </span>
            {helper && !busy && (
              <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--ink-3)', lineHeight: 1.35 }}>
                {helper}
              </span>
            )}
          </span>
        </button>
        {hasHelp && (
          hasHowTo ? (
            <button
              type="button"
              onClick={handleHelp}
              style={{
                alignSelf: 'flex-start', fontSize: 11.5, color: 'var(--accent)',
                background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                fontWeight: 500, fontFamily: 'inherit',
              }}
              onMouseOver={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
              onMouseOut={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
            >How to?</button>
          ) : (
            <a
              href={hero.help_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleHelp}
              style={{
                alignSelf: 'flex-start', fontSize: 11.5, color: 'var(--accent)',
                textDecoration: 'none', fontWeight: 500,
              }}
              onMouseOver={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
              onMouseOut={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
            >How to?</a>
          )
        )}
      </div>
    );
  };

  const renderCard = (m) => {
        const hasHowTo = typeof m.how_to === 'string' && m.how_to.trim().length > 0;
        const hasHelp = hasHowTo || !!m.help_url;
        const handleHelp = (e) => {
          // Stop bubbling so the card's onClick doesn't also fire
          // and select the method. Prevent default so the anchor
          // doesn't try to navigate inside the Electron renderer
          // (file:// origin).
          e.stopPropagation();
          e.preventDefault();
          // Prefer the in-app markdown modal when the spec ships
          // its own content; fall back to opening the URL in the
          // user's default browser via Electron's openExternal.
          if (hasHowTo) {
            setHowToFor(m);
          } else if (m.help_url) {
            try { host.openExternal(m.help_url); }
            catch { window.open(m.help_url, '_blank', 'noreferrer'); }
          }
        };
        return (
          <div
            key={m.id}
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-disabled={busy || undefined}
            onClick={() => { if (!busy) onPick?.(m.id); }}
            onKeyDown={(e) => {
              // Only treat Enter/Space as activation when the card
              // itself is the focused element — when the inner help
              // anchor has focus its own keyboard activation handles
              // it, and we don't want to also select the method.
              if (busy) return;
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick?.(m.id);
              }
            }}
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'stretch', textAlign: 'left',
              gap: 6,
              padding: '12px 14px',
              borderRadius: 9,
              background: m.recommended
                ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))'
                : 'var(--surface-2)',
              border: m.recommended
                ? '1px solid color-mix(in srgb, var(--accent) 35%, transparent)'
                : '1px solid var(--line)',
              color: 'var(--ink)',
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: FONT_BODY,
              transition: 'transform 120ms ease, background 120ms ease, border-color 120ms ease',
              outline: 'none',
              // Belt: when the card sits inside a constrained flex
              // parent (the form panel column), `minWidth: 0` lets
              // it shrink below its intrinsic content width so a
              // long unbreakable token in the description (e.g.
              // a sample connection URI) can't push the card past
              // the panel's edge. Suspenders: `overflowWrap` on
              // the description below handles the line-breaking.
              minWidth: 0,
            }}
            onMouseOver={(e) => { if (!busy) e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
            onFocus={(e) => {
              // Only paint the focus ring when the card itself is
              // focused — not when a child anchor is.
              if (e.target === e.currentTarget) {
                e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)';
              }
            }}
            onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              minWidth: 0,
            }}>
              <span style={{
                fontWeight: 600, fontSize: 13.5, color: 'var(--ink)',
                letterSpacing: '0',
                minWidth: 0, flex: '1 1 auto',
                overflowWrap: 'anywhere', wordBreak: 'break-word',
              }}>{m.label || m.id}</span>
              {m.recommended && (
                <Badge
                  variant="accent"
                  size="sm"
                  className="font-mono uppercase tracking-[0.04em]"
                >Recommended</Badge>
              )}
            </div>
            {m.description && (
              <div style={{
                fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45,
                // Spec authors sometimes embed a sample connection
                // URI in the description (Postgres `connection_string`
                // method, for example). Without word-break that long
                // unbreakable token blows out the card's width.
                // `overflowWrap: anywhere` lets the browser break
                // mid-token where needed; `minWidth: 0` on the
                // parent card unlocks shrink below intrinsic width.
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                minWidth: 0,
              }}>{m.description}</div>
            )}
            {hasHelp && (
              hasHowTo ? (
                <button
                  type="button"
                  onClick={handleHelp}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                    }
                  }}
                  style={{
                    alignSelf: 'flex-start',
                    marginTop: 2,
                    fontSize: 11.5,
                    color: 'var(--accent)',
                    background: 'transparent',
                    border: 0,
                    padding: 0,
                    cursor: 'pointer',
                    fontWeight: 500,
                    fontFamily: 'inherit',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                  onMouseOut={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                >
                  How to?
                </button>
              ) : (
                <a
                  href={m.help_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleHelp}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                    }
                  }}
                  style={{
                    alignSelf: 'flex-start',
                    marginTop: 2,
                    fontSize: 11.5,
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    fontWeight: 500,
                    borderRadius: 4,
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                  onMouseOut={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                >
                  How to?
                </a>
              )
            )}
          </div>
        );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {hero ? (
        // Lead with the recommended method as a prominent button; the
        // rest fold away under a quiet disclosure (ENG-1534).
        <>
          {renderHero()}
          {rest.length > 0 && (
            <Collapsible
              hideChevron
              triggerClassName="justify-center"
              panelClassName="pt-2"
              title={(
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  width: '100%', fontSize: 11.5, color: 'var(--ink-3)',
                }}>
                  See other options to connect {providerName}
                  <span
                    className="inline-flex transition-transform duration-200 group-data-[panel-open]:rotate-180"
                    aria-hidden
                  >
                    {Ico.chevDown(13)}
                  </span>
                </span>
              )}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rest.map(renderCard)}
              </div>
            </Collapsible>
          )}
        </>
      ) : (
        // No recommended method — fall back to today's flat card list.
        <>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 2 }}>
            Pick how you want to connect:
          </div>
          {orderedMethods.map(renderCard)}
        </>
      )}

      <HowToModal
        open={!!howToFor}
        title={howToFor ? `How to · ${howToFor.label || howToFor.id}` : 'How to'}
        content={howToFor?.how_to || ''}
        onClose={() => setHowToFor(null)}
      />
    </div>
  );
}

// ── Method breadcrumb ────────────────────────────────────────────
//
// Compact row above the fields once a method is active. Reads as a
// "← Back to options" navigation link with the chosen method label
// appended as muted metadata, so picking a method doesn't feel like
// a "confirm your choice" step — the form fields appear immediately
// below and the back affordance is left-aligned, button-like, and
// obvious.
function MethodBreadcrumb({ method, onChange, busy }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={busy}
      style={{
        display: 'flex', alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 7,
        background: 'transparent',
        border: 'none',
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.6 : 1,
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        alignSelf: 'flex-start',
        transition: 'background 120ms ease',
      }}
      onMouseOver={(e) => { if (!busy) e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        color: 'var(--accent)',
        fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
        display: 'inline-flex', alignItems: 'center', gap: 4,
      }}>
        <span aria-hidden>{'←'}</span>
        Back to options
      </span>
      <span style={{
        color: 'var(--ink-4)', fontFamily: FONT_BODY, fontSize: 12,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        minWidth: 0,
      }}>
        · {method.label || method.id}
      </span>
    </button>
  );
}
