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
  // Retry logos per source so a failed connector asset does not suppress the next connector’s mark.
  const [failedSrc, setFailedSrc] = useState(null);
  const src = logoUrl || (connectorId ? `logos/${connectorId}.svg` : null);
  if (src && src !== failedSrc) {
    return (
      <span className="inline-grid place-items-center w-[36px] h-[36px] rounded-card-row bg-surface-2">
        <img
          src={src}
          alt=""
          onError={() => setFailedSrc(src)}
          className="w-[22px] h-[22px] object-contain"
        />
      </span>
    );
  }
  const fn = (logo && Ico[logo]) || Ico.database;
  return (
    <span
      className="inline-grid place-items-center w-[36px] h-[36px] rounded-card-row bg-surface-2"
      style={{ color: color || 'var(--ink-3)' }}
    >
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

  // Display saved secret sentinels as empty inputs while retaining their value until typing.
  // Untouched sentinels round-trip to preserve the stored secret.
  const isSentinel = value === ANTON_VAULT_KEEP;
  const displayValue = isSentinel ? '' : (value ?? field.default ?? '');
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
        aria-label={field.label}
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
      <label
        className="inline-flex items-center gap-2 font-[family-name:var(--font-body)] text-[13px] text-ink-2"
        style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        <Checkbox
          // Secret sentinels normally apply only to strings; treat an unexpected boolean sentinel
          // as unchecked.
          checked={!isSentinel && !!value}
          disabled={disabled}
          onCheckedChange={(v) => onChange(v)}
          aria-label={field.checkbox_label || field.label}
        />
        {field.checkbox_label || field.label}
      </label>
    );
  }
  return (
    <Input
      ref={inputRef}
      type={field.type === 'password' ? 'password' : (field.type === 'url' ? 'url' : 'text')}
      aria-label={field.label}
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
  hideHeader = false,
}) {
  // Legacy forms use top-level fields; multi-method forms use each method’s fields/actions and
  // submit its auth_method.
  const visibleMethods = Array.isArray(spec?.methods)
    ? spec.methods.filter((m) => !m.hidden)
    : [];
  const isMultiMethod = visibleMethods.length > 0;
  // Keep the method override in formStore so panel breadcrumbs can read/clear it; mirror changes
  // for rendering.
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
  // Skip the picker when only one visible method exists; there is no choice to return to.
  const onlyMethodId = (isMultiMethod && visibleMethods.length === 1)
    ? visibleMethods[0].id
    : null;
  const activeMethodId = localSelectedMethod || spec?.selected_method || onlyMethodId || null;
  const activeMethod = isMultiMethod
    ? (visibleMethods.find((m) => m.id === activeMethodId) || null)
    : null;
  const [formHowToOpen, setFormHowToOpen] = useState(false);

  const fields = isMultiMethod ? (activeMethod?.fields || []) : (spec?.fields || []);

  // Key input state by form and method so switching methods preserves each draft.
  const [valuesByKey, setValuesByKey] = useState({});
  const [skippedByKey, setSkippedByKey] = useState({});
  const [requiredErrorsByKey, setRequiredErrorsByKey] = useState({});
  /*
   * Focus Input/Textarea refs on validation failure; selects and booleans need wrapper refs to
   * scroll errors into view.
   */
  const fieldRefs = useRef({});
  const fieldContainerRefs = useRef({});

  const initialFor = (fs) => {
    const out = {};
    for (const f of (fs || [])) {
      out[f.name] = f.value ?? f.default ?? (f.type === 'boolean' ? false : '');
    }
    return out;
  };

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

  // Publish context for chat, but never include password or secret field values.
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

  if (spec._is_success) {
    return (
      <div className="flex flex-col gap-[14px] font-[family-name:var(--font-body)] py-[14px] px-0">
        <div className="flex items-start gap-3">
          <span
            className="inline-grid place-items-center w-[36px] h-[36px] rounded-card-row"
            style={{
              background: 'color-mix(in srgb, var(--success) 18%, var(--surface))',
              color: 'var(--success)',
              border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)',
              boxShadow: '0 0 12px var(--success-glow)',
            }}
          >{Ico.check(20)}</span>
          <div className="min-w-0 flex-1 flex flex-col gap-[2px]">
            <div className="s-h3">{spec.title || 'Connected'}</div>
            {spec.subtitle && (
              <div className="text-sm text-ink-3 leading-[1.5]">
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
        <div className="flex justify-end gap-2">
          {/*
 * Use spec.actions when present so successful probes can customize the default Close/View
 * connectors actions.
 */}
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
        /*
         * After PostHog discovery, require either a selected project or a typed ID. Before
         * discovery, an empty
         * project_id must remain valid because it triggers discovery itself.
         */
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
    const cleanValues = {};
    for (const k of Object.keys(values)) {
      if (!skipped.has(k)) cleanValues[k] = values[k];
    }
    onAction({
      id: action.id,
      kind: action.kind || 'primary',
      values: cleanValues,
      skipped: [...skipped],
      // Include the selected method so the agent can choose its probe and save the connection
      // correctly.
      authMethod: activeMethodId || null,
    });
  };

  // Select only: onMethodChange already starts fieldless OAuth. Dispatching onAction too would
  // launch it twice.
  // Methods with fields must show them before submitting.
  const authorizeWithMethod = (method) => {
    if (!method) return;
    setLocalSelectedMethod(method.id);
    onMethodChange?.(method.id);
  };

  return (
    <div className="flex flex-col gap-[14px] font-[family-name:var(--font-body)]">
      {/* Omit the subtitle because the chat already explains the connection. */}
      {!hideHeader && !(isMultiMethod && !activeMethod) && (
        <div className="flex items-center gap-3">
          <FormLogo logo={spec.logo} logoUrl={spec.logo_url} color={spec.logo_color} connectorId={spec._connector_id || spec.engine} />
          <div className="min-w-0 flex-1">
            <div className="s-h3">{spec.title || 'Connect'}</div>
          </div>
        </div>
      )}

      {userLabel !== undefined && !(isMultiMethod && !activeMethod) && (
        <div className="flex flex-col gap-1">
          <label htmlFor="connection-user-label" className="text-[12px] text-ink-3 font-medium">
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

      {/* Render status through the panel toast so probe updates do not displace form fields. */}

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


      {(!isMultiMethod || activeMethod) && <>
      {spec.form_error && (
        <Alert variant="danger">{spec.form_error}</Alert>
      )}
      {spec.form_warning && (
        <Alert variant="warning">{spec.form_warning}</Alert>
      )}

      {/* Keep fields visible but disabled during probing so entered values and layout remain stable. */}
      <div className="flex flex-col gap-[10px]">
        {fields.map((f) => {
          const isSkipped = skipped.has(f.name);
          // Lock identity fields in modify mode so the vault row key cannot change or be skipped.
          const isLocked = !!f._locked;
          return (
            <div
              key={f.name}
              ref={(node) => { fieldContainerRefs.current[f.name] = node; }}
              tabIndex={-1}
              className="flex flex-col gap-1 outline-none"
              style={{ opacity: isSkipped ? 0.55 : 1 }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <label className="text-[12px] text-ink-3 font-medium">
                  {f.label || f.name}
                  {f.required && !isSkipped && (
                    <span className="text-danger ml-[3px]">*</span>
                  )}
                </label>
                {/*
 * Allow skipping unless explicitly forbidden; Anton uses skipped fields to refine the request.
 * Locked identity fields cannot be skipped.
 */}
                {f.skipable !== false && !isLocked && (
                  <button
                    type="button"
                    onClick={() => isSkipped ? updateField(f.name, values[f.name] ?? '') : skipField(f.name)}
                    disabled={busy}
                    className="bg-transparent border-0 p-0 font-[family-name:var(--font-mono)] text-[10.5px] text-ink-4 tracking-[0.04em]"
                    style={{ cursor: busy ? 'not-allowed' : 'pointer' }}
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
                <div className="px-[10px] py-2 rounded-[7px] bg-surface-2 border border-dashed border-line-2 text-ink-4 text-[12px] font-[family-name:var(--font-body)] italic">Skipped — the agent will figure this one out.</div>
              )}
              {(requiredErrors[f.name] || f.error) && !isSkipped && (
                <div className="text-[11.5px] text-danger">{requiredErrors[f.name] || f.error}</div>
              )}
              {f.warning && !isSkipped && (
                <div
                  className="text-[11.5px]"
                  style={{ color: 'color-mix(in srgb, var(--accent) 80%, var(--ink-2))' }}
                >{f.warning}</div>
              )}
              {/* Field activity status can coexist with errors/warnings; the probe clears it with null. */}
              {f.status && !isSkipped && (
                <div className="inline-flex items-center gap-[6px] text-[11.5px] text-ink-3">
                  <span
                    aria-hidden
                    className="w-[9px] h-[9px] flex-[0_0_9px] rounded-full"
                    style={{
                      border: '1.5px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                      borderTopColor: 'var(--accent)',
                      animation: 'spin 720ms linear infinite',
                    }}
                  />
                  {f.status}
                </div>
              )}
              {f.help && !f.error && !f.warning && !f.status && (
                <div className="text-[11.5px] text-ink-4">{f.help}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        {(() => {
          const m = activeMethod || spec || {};
          const hasHowTo = typeof m.how_to === 'string' && m.how_to.trim().length > 0;
          const hasHelp = hasHowTo || !!m.help_url;
          if (!hasHelp) return <span aria-hidden className="w-0" />;
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
          const sharedClass = 'py-1 px-0 text-[12px] font-medium text-accent bg-transparent border-0 cursor-pointer font-[inherit] no-underline hover:underline';
          return hasHowTo ? (
            <button
              type="button"
              onClick={onClick}
              className={sharedClass}
            >How to?</button>
          ) : (
            <a
              href={m.help_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClick}
              className={sharedClass}
            >How to?</a>
          );
        })()}
        <div className="flex gap-2 flex-wrap">
        {(activeMethod?.actions || spec.actions || [{ id: 'submit', label: 'Submit', kind: 'primary' }]).map((a) => {
          // Modify mode changes the visible label only; preserve action ID/kind for server
          // handling.
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
                // Allow spec actions to skip a field as well as the per-field controls.
                if (a.kind === 'skip' && a.field) {
                  skipField(a.field);
                  return;
                }
                dispatch(a);
              }}
              disabled={busy && a.kind !== 'cancel'}
              className={a.kind === 'primary' && busy ? 'is-busy' : undefined}
            >
              {a.kind === 'primary' && busy ? 'Working…' : label}
            </Button>
          );
        })}
        </div>
      </div>
      </>}

      <HowToModal
        open={formHowToOpen}
        title={`How to · ${(activeMethod || spec)?.label || 'Connect'}`}
        content={(activeMethod || spec)?.how_to || ''}
        onClose={() => setFormHowToOpen(false)}
      />
    </div>
  );
}

function MethodPicker({ spec, methods, onPick, onAuthorize, busy }) {
  const [howToFor, setHowToFor] = useState(null);
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
      <div className="flex flex-col gap-[6px]">
        <button
          type="button"
          disabled={busy}
          onClick={onHeroClick}
          className="flex items-center gap-3 w-full text-left px-[14px] py-3 rounded-[10px] text-ink font-[family-name:var(--font-body)] min-w-0 outline-none"
          style={{
            background: 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
            cursor: busy ? 'not-allowed' : 'pointer',
            transition: 'transform 120ms ease, background 120ms ease, border-color 120ms ease',
          }}
          onMouseOver={(e) => { if (!busy) e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
          onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent)'; }}
          onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
        >
          <FormLogo logo={spec?.logo} logoUrl={spec?.logo_url} color={spec?.logo_color} connectorId={spec?._connector_id || spec?.engine} />
          <span className="flex flex-col gap-[2px] min-w-0 flex-[1_1_auto] [overflow-wrap:anywhere] [word-break:break-word]">
            <span className="font-semibold text-[14.5px] text-ink">
              {busy ? 'Working…' : label}
            </span>
            {helper && !busy && (
              <span className="text-[11.5px] font-normal text-ink-3 leading-[1.35]">
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
              className="self-start text-[11.5px] text-accent bg-transparent border-0 p-0 cursor-pointer font-medium font-[inherit] no-underline hover:underline"
            >How to?</button>
          ) : (
            <a
              href={hero.help_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleHelp}
              className="self-start text-[11.5px] text-accent font-medium no-underline hover:underline"
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
          // Prevent help clicks from selecting the method or navigating the Electron renderer.
          e.stopPropagation();
          e.preventDefault();
          // Prefer supplied help markdown over an external URL.
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
              // Activate only the focused card itself; inner help links own their keyboard events.
              if (busy) return;
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick?.(m.id);
              }
            }}
            // Allow cards to shrink below intrinsic width so long connection URIs cannot overflow
            // the panel.
            className="flex flex-col items-stretch text-left gap-[6px] px-[14px] py-3 rounded-[9px] text-ink font-[family-name:var(--font-body)] outline-none min-w-0"
            style={{
              background: m.recommended
                ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))'
                : 'var(--surface-2)',
              border: m.recommended
                ? '1px solid color-mix(in srgb, var(--accent) 35%, transparent)'
                : '1px solid var(--line)',
              cursor: busy ? 'not-allowed' : 'pointer',
              transition: 'transform 120ms ease, background 120ms ease, border-color 120ms ease',
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
            <div className="flex items-center justify-between gap-[10px] min-w-0">
              <span className="font-semibold text-[13.5px] text-ink tracking-[0] min-w-0 flex-[1_1_auto] [overflow-wrap:anywhere] [word-break:break-word]">{m.label || m.id}</span>
              {m.recommended && (
                <Badge
                  variant="accent"
                  size="sm"
                  className="font-mono uppercase tracking-[0.04em]"
                >Recommended</Badge>
              )}
            </div>
            {m.description && (
              // Break long sample URIs inside the shrinking card instead of widening it.
              <div className="text-sm text-ink-3 leading-[1.45] [overflow-wrap:anywhere] [word-break:break-word] min-w-0">{m.description}</div>
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
                  className="self-start mt-[2px] text-[11.5px] text-accent bg-transparent border-0 p-0 cursor-pointer font-medium font-[inherit] no-underline hover:underline"
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
                  className="self-start mt-[2px] text-[11.5px] text-accent no-underline font-medium rounded-[4px] hover:underline"
                >
                  How to?
                </a>
              )
            )}
          </div>
        );
  };

  return (
    <div className="flex flex-col gap-2">
      {hero ? (
        <>
          {renderHero()}
          {rest.length > 0 && (
            <Collapsible
              hideChevron
              triggerClassName="justify-center"
              panelClassName="pt-2"
              title={(
                <span className="inline-flex items-center justify-center gap-1 w-full text-[11.5px] text-ink-3">
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
              <div className="flex flex-col gap-2">
                {rest.map(renderCard)}
              </div>
            </Collapsible>
          )}
        </>
      ) : (
        <>
          <div className="text-sm text-ink-3 mb-[2px]">
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
