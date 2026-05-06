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
  // ── Multi-method shape ──────────────────────────────────────────
  // A form can either be single-method (top-level `fields[]` array,
  // legacy shape) or multi-method (`methods[]` array of method
  // definitions, each with their own fields+actions). The user picks
  // a method first, then fills in fields, then submits with an
  // `auth_method` tag so the server probe knows which to test.
  const isMultiMethod = Array.isArray(spec?.methods) && spec.methods.length > 0;
  // Local override (user picked a method client-side). Falls back to
  // whatever the server set in `spec.selected_method`. Cleared when
  // a brand-new form arrives (new form_id) and when the user clicks
  // "change" on the breadcrumb.
  const [localSelectedMethod, setLocalSelectedMethod] = useState(null);
  const activeMethodId = localSelectedMethod || spec?.selected_method || null;
  const activeMethod = isMultiMethod
    ? (spec.methods.find((m) => m.id === activeMethodId) || null)
    : null;

  // The fields the form is currently rendering — the active method's
  // for multi-method, or the top-level fields[] for single-method.
  const fields = isMultiMethod ? (activeMethod?.fields || []) : (spec?.fields || []);

  // Per-(form, method) input state so flipping methods preserves
  // anything typed under each one. Storing inside a Map keyed by
  // `${form_id}::${method_id || 'default'}` keeps the state shape flat
  // and easy to reset on a brand-new form.
  const [valuesByKey, setValuesByKey] = useState({});
  const [skippedByKey, setSkippedByKey] = useState({});

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
      setLocalSelectedMethod(null);
    }
  }, [spec?.form_id]);

  const stateKey = `${spec?.form_id || ''}::${activeMethodId || 'default'}`;
  const values = valuesByKey[stateKey] || initialFor(fields);
  const skipped = skippedByKey[stateKey] || new Set();

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
      // Tell the panel which method the user picked (multi-method
      // forms only). The agent uses this to decide which probe path
      // to test and to write into the saved connection.
      authMethod: activeMethodId || null,
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

      {/* Multi-method picker — shown when the form has methods[] and
          no method is currently active (neither user-picked nor
          server-pre-selected). User clicks a card to pick. */}
      {isMultiMethod && !activeMethod && (
        <MethodPicker
          methods={spec.methods}
          onPick={(id) => setLocalSelectedMethod(id)}
          busy={busy}
        />
      )}

      {/* Method breadcrumb — once a method is active, show a small
          row above the fields with the method label and a "change"
          link that re-opens the picker. */}
      {isMultiMethod && activeMethod && (
        <MethodBreadcrumb
          method={activeMethod}
          onChange={() => setLocalSelectedMethod(null)}
          busy={busy}
        />
      )}

      {/* Everything below is hidden until a method is chosen on a
          multi-method form. Single-method forms never gate. */}
      {(!isMultiMethod || activeMethod) && <>
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

      {/* Actions — always rendered too. Disabled while busy. The
          active method's actions take precedence; falls back to the
          form's top-level actions, then a generic Submit button. */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap',
        paddingTop: 4,
      }}>
        {(activeMethod?.actions || spec.actions || [{ id: 'submit', label: 'Submit', kind: 'primary' }]).map((a) => (
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
      </>}
    </div>
  );
}

// ── Method picker ─────────────────────────────────────────────────
//
// Vertical stack of cards, one per method. Each card shows label,
// description, and an optional "Recommended" pill. Click selects
// the method (host pulls the choice into local state and the form
// switches to the picked method's fields).
function MethodPicker({ methods, onPick, busy }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 2,
      }}>
        Pick how you want to connect:
      </div>
      {methods.map((m) => {
        const handleHelp = (e) => {
          // Stop bubbling so the card's onClick doesn't also fire
          // and select the method. Prevent default so the anchor
          // doesn't try to navigate inside the Electron renderer
          // (file:// origin) — we route through Electron's
          // openExternal which hands the URL to the OS browser.
          e.stopPropagation();
          e.preventDefault();
          if (m.help_url) {
            try { window.antontron?.openExternal?.(m.help_url); }
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
            }}>
              <span style={{
                fontWeight: 600, fontSize: 13.5, color: 'var(--ink)',
                letterSpacing: '-0.005em',
              }}>{m.label || m.id}</span>
              {m.recommended && (
                <span style={{
                  fontSize: 10.5, fontFamily: FONT_MONO, letterSpacing: '0.04em',
                  color: 'var(--accent)',
                  padding: '2px 7px', borderRadius: 999,
                  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                  textTransform: 'uppercase',
                }}>Recommended</span>
              )}
            </div>
            {m.description && (
              <div style={{
                fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45,
              }}>{m.description}</div>
            )}
            {m.help_url && (
              <a
                href={m.help_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleHelp}
                onKeyDown={(e) => {
                  // Don't let Enter/Space bubble up to the card's
                  // own keyboard handler — the anchor's default
                  // activation already calls onClick → handleHelp.
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
                How to →
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Method breadcrumb ────────────────────────────────────────────
//
// Compact row above the fields once a method is active. Shows the
// chosen method label + a "change" link that re-opens the picker.
function MethodBreadcrumb({ method, onChange, busy }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 10,
      padding: '6px 10px',
      borderRadius: 7,
      background: 'var(--surface-2)',
      border: '1px solid var(--line)',
      fontFamily: FONT_BODY, fontSize: 12,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'baseline', gap: 6,
        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        <span style={{ color: 'var(--ink-4)', fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '0.04em' }}>
          METHOD
        </span>
        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{method.label || method.id}</span>
      </span>
      <button
        type="button"
        onClick={onChange}
        disabled={busy}
        style={{
          background: 'transparent', border: 0, padding: 0,
          color: busy ? 'var(--ink-4)' : 'var(--accent)',
          fontFamily: FONT_BODY, fontSize: 12,
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >change</button>
    </div>
  );
}
