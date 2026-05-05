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

import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../Icons';

const FONT_BODY    = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-display)';
const FONT_MONO    = 'var(--font-mono)';

function FormLogo({ logo, color }) {
  // Icon-name only — pulls from the app's palette (`Ico.<name>`).
  // Falls back to the generic database glyph when the name is
  // unknown or absent. URLs / data URIs are intentionally NOT
  // supported here — keeps the connect surface predictable and
  // theme-coherent (no random raster images breaking the rhythm).
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

function FieldInput({ field, value, onChange, disabled }) {
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

  if (field.type === 'select') {
    return (
      <select
        value={value ?? field.default ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={baseStyle}
      >
        {!field.required && <option value="">—</option>}
        {(field.options || []).map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label || opt.value}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'textarea') {
    return (
      <textarea
        value={value ?? field.default ?? ''}
        placeholder={field.placeholder || ''}
        disabled={disabled}
        rows={4}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        onChange={(e) => onChange(e.target.value)}
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
        <input
          type="checkbox"
          checked={!!value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.checkbox_label || field.label}
      </label>
    );
  }
  // text, password, url, default
  return (
    <input
      type={field.type === 'password' ? 'password' : (field.type === 'url' ? 'url' : 'text')}
      value={value ?? field.default ?? ''}
      placeholder={field.placeholder || ''}
      autoComplete={field.type === 'password' ? 'current-password' : 'off'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={baseStyle}
    />
  );
}

export function DataVaultForm({ spec, busy = false, onAction }) {
  // Local input state — initialized from the spec each time the
  // form_id changes (i.e. anton emits a NEW form). For an updated
  // form with the same form_id, we preserve user typing and only
  // surface the new error/warning fields.
  const initial = useMemo(() => {
    const out = {};
    for (const f of (spec?.fields || [])) {
      out[f.name] = f.value ?? f.default ?? (f.type === 'boolean' ? false : '');
    }
    return out;
  }, [spec?.form_id]);

  const [values, setValues] = useState(initial);
  const [skipped, setSkipped] = useState(new Set());
  const lastFormIdRef = useRef(spec?.form_id);

  useEffect(() => {
    if (spec?.form_id !== lastFormIdRef.current) {
      lastFormIdRef.current = spec?.form_id;
      setValues(initial);
      setSkipped(new Set());
    }
  }, [spec?.form_id, initial]);

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
            <div style={{
              fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600,
              color: 'var(--ink)', letterSpacing: '-0.005em',
            }}>{spec.title || 'Connected'}</div>
            {spec.subtitle && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                {spec.subtitle}
              </div>
            )}
          </div>
        </div>
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
            <button
              key={a.id}
              type="button"
              onClick={() => onAction?.({ id: a.id, kind: a.kind || 'cancel' })}
              className={a.kind === 'primary' ? 'btn-primary' : undefined}
              style={a.kind === 'primary' ? undefined : {
                background: 'transparent',
                border: '1px solid var(--line)',
                color: 'var(--ink-2)',
                padding: '7px 12px', borderRadius: 7,
                fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
                cursor: 'pointer',
              }}
            >{a.label}</button>
          ))}
        </div>
      </div>
    );
  }

  const updateField = (name, v) => {
    setValues((prev) => ({ ...prev, [name]: v }));
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
    });
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 14,
      fontFamily: FONT_BODY,
    }}>
      {/* Header — logo + title + subtitle */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <FormLogo logo={spec.logo} color={spec.logo_color} />
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{
            fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600,
            color: 'var(--ink)', letterSpacing: '-0.005em',
          }}>{spec.title || 'Connect'}</div>
          {spec.subtitle && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              {spec.subtitle}
            </div>
          )}
        </div>
      </div>

      {/* Note: live status (`status_text`) is rendered as a
          dismissible TOAST by DataVaultFormPanel — sitting outside
          the form body so per-step status updates don't displace
          the fields. The form itself just disables inputs while
          probing (`busy` is set by the host) and otherwise stays
          structurally identical to its idle state. */}

      {/* Form-level banners */}
      {spec.form_error && (
        <div style={{
          padding: '8px 10px', borderRadius: 7,
          background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
          color: 'var(--danger)', fontSize: 12.5,
        }}>{spec.form_error}</div>
      )}
      {spec.form_warning && (
        <div style={{
          padding: '8px 10px', borderRadius: 7,
          background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
          color: 'var(--ink-2)', fontSize: 12.5,
        }}>{spec.form_warning}</div>
      )}

      {/* Fields — always rendered. While a probe is in flight the
          host disables inputs via `busy`, so the layout stays put
          and the user can still see what they entered (without it
          jumping out of view when the status row appears). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(spec.fields || []).map((f) => {
          const isSkipped = skipped.has(f.name);
          return (
            <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: isSkipped ? 0.55 : 1 }}>
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
                    `skipable: false` in the spec is still respected. */}
                {f.skipable !== false && (
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
                  disabled={busy}
                />
              )}
              {isSkipped && (
                <div style={{
                  padding: '8px 10px', borderRadius: 7,
                  background: 'var(--surface-2)',
                  border: '1px dashed var(--line-2)',
                  color: 'var(--ink-4)', fontSize: 12,
                  fontFamily: FONT_BODY, fontStyle: 'italic',
                }}>Skipped — Anton will figure this one out.</div>
              )}
              {f.error && !isSkipped && (
                <div style={{
                  fontSize: 11.5, color: 'var(--danger)',
                }}>{f.error}</div>
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
                      animation: 'dvf-spin 720ms linear infinite',
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

      {/* Actions — always rendered too. Disabled while busy. */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap',
        paddingTop: 4,
      }}>
        {(spec.actions || [{ id: 'submit', label: 'Submit', kind: 'primary' }]).map((a) => (
          <button
            key={a.id}
            type="button"
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
            className={a.kind === 'primary' ? 'btn-primary' : undefined}
            style={a.kind === 'primary' ? undefined : {
              background: 'transparent',
              border: '1px solid var(--line)',
              color: a.kind === 'cancel' ? 'var(--ink-3)' : 'var(--ink-2)',
              padding: '7px 12px',
              borderRadius: 7,
              fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
              cursor: busy ? 'progress' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {a.kind === 'primary' && busy ? 'Working…' : a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
