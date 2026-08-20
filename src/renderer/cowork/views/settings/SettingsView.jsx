import { useState, useEffect, useMemo, useRef, useContext } from 'react';
import { useId } from 'react';
import Ico from '../../components/Icons';
import { validateSettings, revealSettingKey, testProviders, fetchRecommendedModels } from '../../api';
import { providerTypeToKeyField, providerValueToType, resolveRoleModel, resolveModelPickerValue, buildModelOptions, displayModelLabel, effectiveRoleModel, effectiveRoleProvider, mergeRecommendedModels, clampBudgetValue, clampBudgets, BUDGET_FIELDS, isBudgetUnlimited, resolveBudgetRestore, toDisplayUnits, toNaturalUnits, formatCount } from '../../lib/settingsTransform';
import { MODEL_REFRESH_TTL_MS } from '../../lib/modelRefresh';
import { trackHarnessSwapped } from '../../lib/analytics';
import { copyText as copyToClipboard } from '../../lib/clipboard';
import { deriveProviderStatus, friendlyProviderError } from '../../lib/providerStatus';
import { ToggleGroup } from '../../components/ui/ToggleGroup';
import { Switch } from '../../components/ui/Switch';
import { Badge, Button, Input, Checkbox, Select, Tooltip } from '../../components/ui';
import Spinner from '../../components/ui/Spinner';
import ModelSelect from '../../components/ModelSelect.jsx';
import { host } from '../../../platform/host';
import { SKINS, normalizeSkin } from '../../../lib/skins';
import { MINDS_API_BASE, MINDS_API_KEY_URL, MINDS_REGISTER_URL, MINDS_BILLING_URL } from '../../../lib/mindsUrls';
import { isElectron } from '../../../platform/host';
import ChannelsView from '../ChannelsView';
import UpdatesSection from './UpdatesSection';
import BackendSection from './BackendSection';
import AccountSection from './AccountSection';
import { SettingsLayoutContext, Section, SettingsSectionPanel } from './settingsLayout';

// Exported for tests. Narrows a `lastSavedJson` snapshot to reflect one
// freshly auto-saved key, without touching any other field — critical so an
// Appearance auto-save never marks a genuinely-unsaved Provider/Model edit
// (tracked in the same snapshot, via the shared page-wide Save button) as
// saved just because it happened to be present at the same time. Returns
// the input unchanged if it's null or unparseable (defensive: the caller
// should never hit that path, but a snapshot must never be corrupted).
export function patchSavedJson(prevJson, key, value) {
  if (prevJson == null) return prevJson;
  try {
    const parsed = JSON.parse(prevJson);
    parsed[key] = value;
    return JSON.stringify(parsed);
  } catch {
    return prevJson;
  }
}

// Small icon button that lives inside a text field (clear / reveal / copy).
// CORE carries the shape; the states add color/background/cursor so no state
// ever stacks two utilities for the same property.
const FIELD_ICON_BTN_CORE =
  'inline-flex items-center justify-center w-[28px] h-[26px] rounded-md border-0 p-0';
const FIELD_ICON_BTN_BASE = `${FIELD_ICON_BTN_CORE} bg-transparent text-ink-3 cursor-pointer`;
// Variant absolutely positioned against the field's right edge.
const FIELD_ICON_BTN = `${FIELD_ICON_BTN_BASE} absolute right-1 top-1/2 -translate-y-1/2`;

// Native <input type="color"> rendered as a small swatch well.
const COLOR_SWATCH_INPUT =
  'w-[64px] h-[32px] p-0.5 border border-solid border-line-2 rounded-md bg-surface cursor-pointer';

// Inline text-link button (renders inside a sentence, inherits its type).
const LINK_BTN =
  'bg-transparent border-none p-0 cursor-pointer text-accent underline text-[length:inherit] [font-family:inherit]';

// Numeric input for the Advanced Settings agent budgets. State keeps the
// server's string form (settings round-trip as strings; the page-wide dirty
// compare is a JSON diff, so types must stay stable across save → re-fetch).
// Free typing is allowed — including transiently empty/out-of-range text —
// and the value is clamped into [min, max] on blur. Two deliberate rules:
//   * An untouched field never commits (blur alone must not materialize a
//     key the server never sent — that would flip Save to dirty with zero
//     edits and PUT an unknown key to an older server).
//   * Emptied/unparseable input reverts to the last committed value, not the
//     factory default (clearing a saved 500 to retype must not save 50).
// Escape-dismiss skips blur entirely; clampBudgets() in save() is the
// backstop that keeps rejectable values out of every PUT.
function BudgetNumberField({ settingKey, value, savedValue, spec, label, setSetting, unlimitedLabel }) {
  const { min, max, fallback } = spec;
  const hintId = useId();
  // "No limit" writes the TOP of the range, which already was the off switch —
  // it was just undiscoverable, which is the whole job of this checkbox. Writing
  // `spec.max` keeps the range contiguous, so there is no sentinel to guard with
  // a server-side validator and no special case in the clamp.
  //
  // The hint below says "only the step and auto-continue caps apply" rather
  // than promising infinity, and that wording is load-bearing: at ~306 calls
  // (the server's default 50 rounds x 6 passes) 50M is reached at ~163k per
  // call, which a long conversation can carry. Never observed — largest turn in
  // 30 days was 8.26M — but not impossible.
  const showUnlimited = unlimitedLabel != null && spec.max != null;
  const isUnlimited = showUnlimited && isBudgetUnlimited(value, spec);
  // The number to put back when the switch goes off. A ref, not state: it must
  // survive re-renders without causing one, and it is read only on toggle.
  const preToggle = useRef(null);
  if (showUnlimited && !isUnlimited && value != null) preToggle.current = value;
  // The input reads/writes in `spec.unitDivisor` units (millions, for
  // maxTurnTokens) — seven-digit token counts aren't something anyone wants
  // to type or read. Storage stays in natural units throughout; only the
  // displayed text and what onChange/onBlur parse are scaled. See
  // toDisplayUnits/toNaturalUnits in settingsTransform.js.
  const hasUnit = !!spec.unitDivisor;
  const toDisplay = (v) => toDisplayUnits(v, spec);
  const toNatural = (v) => toNaturalUnits(v, spec);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="inline-flex items-start gap-2">
        <div className="flex flex-col items-start gap-1">
          {/* globals.css `.field-input` sets width:100% and loads after the
              Tailwind layer, so a w-[90px] utility loses the cascade — inline
              width is the one reliable override here. */}
          <input
            className="field-input"
            style={{ width: 90 }}
            type="number"
            inputMode="decimal"
            min={toDisplay(min)}
            max={toDisplay(max)}
            disabled={isUnlimited}
            // Show the number they'd return to, not the max: a disabled field
            // reading 50000000 invites someone to "fix" it back down by hand.
            value={isUnlimited
              ? toDisplay(resolveBudgetRestore(preToggle.current, savedValue, spec))
              : toDisplay(value ?? String(fallback))}
            onChange={(e) => setSetting(settingKey, toNatural(e.target.value))}
            onBlur={(e) => {
              if (value == null) return; // untouched — don't materialize the key
              // Emptying the field reverts to the factory default — clearing
              // any of the three budget fields is the discoverable way to
              // reset it, not a mid-retype state to preserve.
              setSetting(settingKey, clampBudgetValue(toNatural(e.target.value), spec));
            }}
            aria-label={label}
            aria-describedby={hintId}
            title={`${label} (${formatCount(toDisplay(min))}–${formatCount(toDisplay(max))}, default ${formatCount(toDisplay(fallback))}${hasUnit ? ' million tokens' : ''})`}
          />
          {hasUnit && <span className="text-[11.5px] text-ink-4 whitespace-nowrap">million tokens</span>}
        </div>
        <div id={hintId} className="flex flex-col text-[11.5px] text-ink-3">
          {isUnlimited ? (
            <span className="whitespace-nowrap">no limit — only the step and auto-continue caps apply</span>
          ) : (
            <>
              <span className="whitespace-nowrap">{formatCount(toDisplay(min))}&ndash;{formatCount(toDisplay(max))}</span>
              <span className="whitespace-nowrap">default {formatCount(toDisplay(fallback))}</span>
            </>
          )}
        </div>
      </div>
      {showUnlimited && (
        <div className="flex flex-col items-start gap-1.5">
          <span className="text-[11px] text-ink-4">&mdash; or &mdash;</span>
          <label className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
            <Checkbox
              checked={isUnlimited}
              onCheckedChange={(on) => setSetting(
                settingKey,
                on
                  ? String(spec.max)
                  : resolveBudgetRestore(preToggle.current, savedValue, spec),
              )}
              aria-label={unlimitedLabel}
            />
            <span className="text-[11.5px] text-ink-3">{unlimitedLabel}</span>
          </label>
        </div>
      )}
    </div>
  );
}

// A titled group of settings sections. Since ENG-1320 these no longer
// collapse by default: the settings subnav already isolates one section per
// screen, so a second collapse level inside a section just hid content
// behind an extra click for no benefit. The group is a static titled card
// whose content is always visible, UNLESS `collapsible` opts a specific
// group back in (e.g. Advanced Settings — rarely-touched power-user knobs
// that read as clutter left expanded by default). The heading is kept as an
// <h2> either way so groups still surface in SR heading navigation; the
// collapse toggle lives on a button nested inside it, not the heading itself.
// Mobile stays flat, as it already was (ENG-990) — collapsible groups behave
// the same there, just without the card chrome.
function SettingsGroup({ title, children, collapsible = false, defaultCollapsed = false }) {
  const { mobile } = useContext(SettingsLayoutContext);
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed);
  const headingClass =
    'm-0 font-[family-name:var(--font-sans)] text-sm font-semibold tracking-[0.04em] uppercase text-ink-3';
  const heading = collapsible ? (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      aria-expanded={!collapsed}
      className="inline-flex items-center gap-1 border-0 bg-transparent p-0 cursor-pointer text-inherit"
    >
      <span className={`inline-flex shrink-0 text-ink-4 transition-transform ${collapsed ? '' : 'rotate-90'}`} aria-hidden="true">
        {Ico.chevRight(12)}
      </span>
      {title}
    </button>
  ) : title;
  // Mobile (ENG-990): the master-detail screen already isolates one section,
  // so render the group title as a plain header with its content flowing
  // below, separated from the next group by spacing.
  if (mobile) {
    return (
      <div className="mb-1.5">
        <h2 className={`${headingClass} pt-3 px-0.5 pb-2`}>{heading}</h2>
        {!collapsed && <div className="pt-0 px-0.5 pb-1">{children}</div>}
      </div>
    );
  }

  return (
    <div className="border border-solid border-line rounded-card bg-surface-glass backdrop-blur-[var(--surface-glass-blur)] mb-[14px] overflow-hidden">
      <h2 className={`${headingClass} pt-[14px] px-[18px] ${collapsed ? 'pb-[14px]' : 'pb-0'}`}>{heading}</h2>
      {!collapsed && <div className="pt-2.5 px-[18px] pb-2">{children}</div>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, title, ariaLabel }) {
  return (
    <Input
      value={value ?? ''}
      onChange={(next) => onChange(next)}
      placeholder={placeholder}
      title={title}
      aria-label={ariaLabel}
    />
  );
}

// Drop-in for TextInput in Credentials rows. Adds a × button inside the
// field that empties the value — pairs with the trash icon on the API
// key fields so the whole Credentials card uses one clear gesture.
// Save settings still has to be clicked to commit the deletion to env.
function ClearableTextInput({ value, onChange, placeholder, ariaLabel }) {
  const v = value ?? '';
  const hasValue = v.length > 0;
  return (
    <div className="relative">
      <Input
        value={v}
        onChange={(next) => onChange(next)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        style={hasValue ? { paddingRight: 36 } : undefined}
      />
      {hasValue && (
        <Tooltip content="Clear (commits on Save settings)">
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear value"
            className={FIELD_ICON_BTN}
          >
            {Ico.close(13)}
          </button>
        </Tooltip>
      )}
    </div>
  );
}

// Masked credential input. The backend returns "***" as a sentinel for
// stored keys (the real value never leaves disk on a plain GET), so the
// eye icon does two things:
//   (a) toggles the input type between password and text, and
//   (b) when revealing a sentinel and `revealName` is set, asks the
//       server for the real stored value via /settings/reveal-key.
// The fetched value is held in local component state — we never push it
// into the parent settings object, so saving an untouched revealed value
// still sends "***" and the server skips overwriting the stored key.
// Whether toggling the eye should fetch the real stored key from the server.
//
// `isWeb` short-circuits everything: `/settings/reveal-key` returns UNMASKED
// provider secrets and is loopback-only server-side (`_require_local`), and on
// hosted the browser reaches the server from the docker bridge rather than
// 127.0.0.1 — so the fetch would 403. That is the ENG-912 shape: a panel that
// looks functional and throws on a sub-action. A web user can still SET a key
// (`PUT /settings/{key}` is not gated); they just can't read the stored one
// back, and the field keeps showing the "***" sentinel.
//
// Extracted as a pure predicate rather than inlined so both platforms' paths
// are directly testable — this gate lives inside a shared component that
// desktop depends on, and the desktop direction is the one a web-only change
// is most likely to break silently (ENG-932).
export function shouldRevealStoredKey({ isWeb, show, revealName, isSentinel, alreadyRevealed }) {
  if (isWeb) return false;
  // Only worth a round trip when the field is currently masked, the caller told
  // us which key to ask for, the value really is the server's sentinel, and we
  // haven't already fetched it.
  return !show && Boolean(revealName) && Boolean(isSentinel) && !alreadyRevealed;
}

function ApiKeyInput({ value, onChange, placeholder, disabled, revealName }) {
  const [show, setShow] = useState(false);
  // 'idle' | 'copied' | 'failed' — 'failed' surfaces feedback when the
  // clipboard helper's fallback chain (see lib/clipboard.js) also fails,
  // instead of leaving the button looking like it silently did nothing.
  const [copyState, setCopyState] = useState('idle');
  const [revealedValue, setRevealedValue] = useState(null); // null = no fetched override
  const [revealing, setRevealing] = useState(false);

  const stored = value ?? '';
  const isSentinel = stored === '***';
  // What the input renders. While the user hasn't toggled reveal we show
  // `stored` (typically "***" if the server has a key, or "" if not).
  // After a successful reveal we show the fetched value.
  const v = revealedValue ?? stored;
  const hasValue = v.length > 0;
  // Copy is gated on what the input is *displaying* — not the prop. After
  // a reveal, `v` is the real key (held locally; we never push it up to
  // the parent) so `stored` still equals "***" but the user can copy the
  // resolved value. Using `v === '***'` here keeps the "reveal first"
  // hint while the field still shows the masked sentinel.
  const isDisplayingSentinel = v === '***';
  const canCopy = hasValue && !isDisplayingSentinel;

  const onCopy = async () => {
    if (!hasValue) return;
    const ok = await copyToClipboard(v);
    if (ok) {
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } else {
      // Unlike 'copied', 'failed' doesn't auto-clear on a timer — an error
      // needs longer than 1.5s to read. It clears on the next copy attempt
      // (above) or here, on blur.
      setCopyState('failed');
    }
  };

  const onToggleShow = async () => {
    if (shouldRevealStoredKey({
      isWeb: host.isWeb,
      show,
      revealName,
      isSentinel,
      alreadyRevealed: revealedValue !== null,
    })) {
      // Reveal the real stored key from the loopback server.
      setRevealing(true);
      try {
        const real = await revealSettingKey(revealName);
        if (real) setRevealedValue(real);
      } finally {
        setRevealing(false);
      }
    }
    if (show) {
      // Going back to hidden — drop any fetched value so the next
      // reveal re-fetches (and we don't keep a plaintext key around).
      setRevealedValue(null);
    }
    setShow((s) => !s);
  };

  // If the user types, treat that as a fresh local edit. Clear any
  // revealed-from-server value and forward straight to the parent.
  const onInput = (next) => {
    if (revealedValue !== null) setRevealedValue(null);
    onChange(next);
  };

  // Trash → empty the field locally. The change only hits the server
  // on Save settings, where update_settings sees an empty string and
  // routes the key to its delete branch (`_stage_string_env` / the API
  // key block). Also resets reveal state so we don't keep a fetched
  // plaintext copy around.
  const onClearField = () => {
    setRevealedValue(null);
    setShow(false);
    onChange('');
  };

  const btnClass = FIELD_ICON_BTN_BASE;
  const btnClassActive = `${FIELD_ICON_BTN_CORE} cursor-pointer text-ink bg-surface-2`;
  const btnClassDisabled = `${FIELD_ICON_BTN_CORE} bg-transparent text-ink-3 opacity-35 cursor-not-allowed`;

  // When the field is holding the server sentinel and the user hasn't
  // toggled reveal, render the input as empty + a long bullet placeholder.
  // The literal "***" rendered as type=password is only 3 dots wide, which
  // looks like an almost-empty field rather than "a stored key is here."
  // Typing replaces the (empty) value cleanly — no asterisk contamination.
  const showSentinelAsMask = !show && v === '***';

  const copyHint = isDisplayingSentinel ? 'Reveal the key first to copy it'
    : copyState === 'copied' ? 'Copied'
      : copyState === 'failed' ? "Couldn't copy — select the key to copy manually"
        : 'Copy to clipboard';

  return (
    <div className="relative">
      <Input
        variant="mono"
        type={show ? 'text' : 'password'}
        value={showSentinelAsMask ? '' : v}
        onChange={(next) => onInput(next)}
        placeholder={showSentinelAsMask ? '••••••••••••••••' : (placeholder || '••••••••••••••••••')}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        aria-label={revealName ? `${revealName} API key` : 'API key'}
        style={{ paddingRight: 108 }}
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5">
        <span className="relative inline-flex">
          <Tooltip content={copyHint}>
            <button
              type="button"
              onClick={onCopy}
              onBlur={() => { if (copyState === 'failed') setCopyState('idle'); }}
              disabled={!canCopy}
              title={!canCopy ? copyHint : undefined}
              aria-label={copyState === 'copied' ? 'Copied to clipboard' : 'Copy key to clipboard'}
              className={canCopy ? btnClass : btnClassDisabled}
            >
              {copyState === 'copied' ? Ico.check(13) : Ico.copy(13)}
            </button>
          </Tooltip>
          {(copyState === 'copied' || copyState === 'failed') && (
            <span
              role="status"
              aria-live="polite"
              className={`absolute bottom-[calc(100%+6px)] left-1/2 py-[3px] px-2 text-[10.5px] font-semibold tracking-[0.04em] uppercase bg-[rgba(20,28,28,0.92)] border border-solid rounded-md whitespace-nowrap pointer-events-none shadow-sh-2 z-[5] ${copyState === 'failed'
                ? 'text-danger border-[color-mix(in_srgb,var(--danger)_45%,transparent)]'
                : 'text-accent border-[color-mix(in_srgb,var(--accent)_45%,transparent)]'}`}
              style={{
                // 'copied' pops in, holds, fades on its own 1.5s clock. 'failed'
                // only pops in and holds — it's cleared by state (next attempt
                // or blur), not by the animation, so it stays legible.
                animation: copyState === 'failed' ? 'failed-pop 0.2s ease forwards' : 'copied-pop 1.5s ease forwards',
              }}
            >{copyState === 'failed' ? "Couldn't copy — select the key to copy manually" : 'Copied'}</span>
          )}
        </span>
        <Tooltip content={show ? 'Hide key' : (revealing ? 'Revealing…' : 'Reveal key')}>
          <button
            type="button"
            onClick={onToggleShow}
            disabled={revealing}
            aria-label={show ? 'Hide key' : 'Reveal key'}
            aria-pressed={show}
            className={show ? btnClassActive : btnClass}
          >
            {show ? Ico.eyeOff(13) : Ico.eye(13)}
          </button>
        </Tooltip>
        <Tooltip content="Clear this key (commits on Save settings)">
          <button
            type="button"
            onClick={onClearField}
            disabled={!hasValue}
            aria-label="Clear key"
            className={hasValue ? btnClass : btnClassDisabled}
          >
            {Ico.close(13)}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

// Pill that hangs off a credential row's title to show whether the field
// is required, optional, auto-managed, or unused for the active provider.
// Drives the eye flow toward what matters for the current selection.
function RelevanceBadge({ status }) {
  if (!status || status === 'unused') return null;
  const config = {
    required: { variant: 'warning', label: 'Required' },
    optional: { variant: 'muted', label: 'Optional' },
    auto: { variant: 'success', label: 'Auto' },
  }[status];
  if (!config) return null;
  return (
    <Badge
      variant={config.variant}
      size="xs"
      className="ml-2 align-middle uppercase tracking-[0.04em]"
    >{config.label}</Badge>
  );
}

// Small green pill that confirms a credential is stored. Pairs with the
// Required / Optional relevance badge so users can answer two questions
// at a glance: "do I need this?" and "is it filled in?". Independent of
// reveal — driven purely by whether the field has a non-empty value
// (which for API keys means either the "***" sentinel from the server
// or a freshly typed key not yet saved).
//
// `active` lifts the badge visually when the credential is on the
// active provider's hot path (required / optional / auto-managed for
// this preset). Idle rows that just happen to still hold a value keep
// the muted look so the eye is drawn to what's currently in use.
function SetBadge({ hasValue, active }) {
  if (!hasValue) return null;
  return (
    <Badge
      title={active
        ? 'Stored and used by the active provider'
        : 'A value is stored, but the active provider does not use it'}
      variant="success"
      size="xs"
      className={`ml-2 align-middle uppercase tracking-[0.04em] ${active ? 'set-badge-pulse' : ''}`}
      icon={<span aria-hidden className={`w-1.5 h-1.5 rounded-full bg-current ${active
        ? 'shadow-[0_0_8px_currentColor,0_0_14px_rgba(124,196,182,0.6)]'
        : 'shadow-[0_0_4px_color-mix(in_srgb,var(--sage-500)_45%,transparent)]'}`} />}
      style={{
        // When active, the box-shadow comes from the set-badge-pulse
        // keyframes; the static value would never paint. When inactive
        // we explicitly clear any inherited shadow.
        boxShadow: active ? undefined : 'none',
        animation: active ? 'set-badge-pulse 2.4s ease-in-out infinite' : 'none',
        transition: 'box-shadow .2s ease, background .2s ease, color .2s ease',
      }}
    >
      Set
    </Badge>
  );
}

// ───────────────────────── Multi-provider helpers ─────────────────────────

const PROVIDER_TYPE_ORDER = ['minds-cloud', 'anthropic', 'openai', 'gemini', 'openai-compatible'];

export function providerStatusBadge(status, configured) {
  if (status === 'ok') return { label: 'connected', variant: 'success' };
  if (status === 'fail') return { label: 'unable to connect', variant: 'danger' };
  if (status === 'testing') return { label: 'testing…', variant: 'warning' };
  if (configured) return { label: 'not tested', variant: 'muted' };
  return null;
}

const PROVIDER_TYPE_DESC = {
  'minds-cloud': 'All frontier models in one place — Claude, GPT, Gemini, and more.',
  anthropic: 'Use Claude models with your Anthropic API key.',
  openai: 'Use GPT models with your OpenAI API key.',
  gemini: 'Use Gemini models through Google\'s OpenAI-compatible endpoint.',
  'openai-compatible': 'Any OpenAI-compatible server (Ollama, vLLM, Together, Groq, etc).',
};

const GET_KEY_URL = {
  'minds-cloud': MINDS_API_KEY_URL,
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
  'openai-compatible': null,
};

const PROTECTED_PROVIDER_TYPES = new Set(['minds-cloud']);

function makeEmptyProvider(type) {
  const base = { type, apiKey: '', isDefault: false };
  if (type === 'openai-compatible') base.baseUrl = '';
  if (type === 'minds-cloud') {
    base.mindsUrl = MINDS_API_BASE;
    base.mindsMindName = '';
    base.mindsDatasource = '';
    base.mindsDatasourceEngine = '';
    base.mindsSslVerify = true;
  }
  return base;
}

function dedupeByType(arr) {
  const map = {};
  for (const p of arr) map[p.type] = p;
  return Object.values(map);
}

function setOneDefault(arr, type) {
  return arr.map((p) => ({ ...p, isDefault: p.type === type }));
}

function ensureDefaultInvariant(arr) {
  if (!arr.length) return arr;
  if (arr.some((p) => p.isDefault)) {
    let found = false;
    return arr.map((p) => {
      if (p.isDefault && !found) { found = true; return p; }
      if (p.isDefault) return { ...p, isDefault: false };
      return p;
    });
  }
  return arr.map((p, i) => ({ ...p, isDefault: i === 0 }));
}

const PROVIDER_LABELS_LOCAL = {
  'minds-cloud': 'MindsHub',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  'openai-compatible': 'OpenAI-compatible',
};

// Wrapper that dims a Section row when the credential is unused for the
// active provider. Built on the existing Section grid so layout stays
// consistent.
function CredentialRow({ title, subtitle, status, hasValue, children }) {
  const dimmed = status === 'unused';
  // The Set badge only glows when this credential is on the active
  // provider's actual auth path — i.e. the active preset *requires* it
  // (or auto-manages it). `optional` credentials (e.g. Minds API key
  // while on Anthropic) and `unused` ones show Set in a muted style so
  // the glow stays meaningful: "this is what's authenticating you now."
  const setActive = hasValue && (status === 'required' || status === 'auto');
  const titleNode = (
    <span className="inline-flex items-center flex-wrap gap-y-1">
      {title}
      <RelevanceBadge status={status} />
      <SetBadge hasValue={hasValue} active={setActive} />
    </span>
  );
  return (
    <div className={`[transition:opacity_.15s_ease] ${dimmed ? 'opacity-50' : 'opacity-100'}`}>
      <Section title={titleNode} subtitle={subtitle}>{children}</Section>
    </div>
  );
}

// ───────────────────────── Nav sidebar ─────────────────────────

const NAV_ITEMS = [
  { id: 'agent', label: 'Agent', icon: 'robot' },
  { id: 'codingMode', label: 'Coding Mode', icon: 'code' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'channels', label: 'Channels', icon: 'chats' },
  { id: 'updates', label: 'Updates', icon: 'refresh' },
  { id: 'backend', label: 'Backend', icon: 'database' },
  { id: 'account', label: 'Account', icon: 'people' },
];

// Sections that make sense in the hosted web shell (ENG-932). Absent, not
// disabled — a nav row that opens a dead end is worse than no row:
//   backend  — start/stop/diagnostics of a server the user doesn't control.
//   updates  — App-shell version and OTA source are meaningless on hosted;
//              the server updates itself.
//   account  — renders an SSO sign-in card, but a hosted user already
//              authenticated through the console; a second sign-in is
//              confusing at best.
//   codingMode — launching an external CLI in a terminal is an Electron
//              main-process capability with no web equivalent; web keeps
//              its simple Anton/Hermes toggle inside Agent instead.
// Agent stays because it carries the model picker and reasoning effort — the
// point of the ticket. Appearance is purely cosmetic. Channels moved back here
// from its standalone sidebar entry, which only existed while Settings was
// hidden on web.
const WEB_NAV_IDS = new Set(['agent', 'appearance', 'channels']);

export function navItemsForHost(isWeb, codingModeOptionsEnabled) {
  // Fresh array on both branches — filter() already copies for web, and the
  // desktop spread keeps a caller's mutation from reaching the shared module
  // constant.
  const items = isWeb ? NAV_ITEMS.filter((i) => WEB_NAV_IDS.has(i.id)) : [...NAV_ITEMS];
  // Coding Mode is parked behind CODING_MODE_OPTIONS_ENABLED while the
  // feature is unfinished — hide its whole nav section (and, transitively,
  // any way to reach the toggle or harness picker) until it's flipped on.
  return codingModeOptionsEnabled ? items : items.filter((i) => i.id !== 'codingMode');
}

function SettingsNav({ section, onSectionChange, serverOnline = true }) {
  return (
    <nav
      role="navigation"
      aria-label="Settings sections"
      className="w-[180px] shrink-0 border-r border-y-0 border-l-0 border-solid border-line py-5 px-2.5 flex flex-col gap-0.5"
    >
      <div className="text-2xs tracking-[0.08em] uppercase text-ink-4 pt-0 px-2.5 pb-1.5 font-semibold">Settings</div>
      {navItemsForHost(host.isWeb, host.codingModeOptionsEnabled).map((item) => {
        const active = section === item.id;
        // `!host.isWeb &&`: the offline-disable exists because a dead local
        // server can't accept a save, and Backend stays enabled as the escape
        // hatch to restart it. On web there is no Backend row — and
        // `serverOnline` DOES go false there: refreshData() polls /health on
        // mount on both platforms (App.jsx), so a transient failure on hosted
        // (proxy 502, auth blip) would otherwise disable EVERY row with no
        // way out.
        const disabled = !host.isWeb && !serverOnline && item.id !== 'backend';
        const icon = Ico[item.icon] ? Ico[item.icon](15) : null;
        return (
          <button
            key={item.id}
            type="button"
            onClick={disabled ? undefined : () => onSectionChange?.(item.id)}
            aria-current={active ? 'page' : undefined}
            aria-disabled={disabled ? 'true' : undefined}
            className={`w-full flex items-center gap-2 py-2 px-2.5 rounded-[7px] border-0 text-[13px] [font-family:inherit] text-left [transition:background_120ms_ease,color_120ms_ease] ${active
              ? 'bg-surface-2 text-ink font-semibold'
              : 'bg-transparent text-ink-3 font-normal hover:bg-surface-2 hover:text-ink'} ${disabled
              ? 'opacity-35 pointer-events-none cursor-default'
              : 'cursor-pointer'}`}
          >
            {icon && (
              <span aria-hidden="true" className="inline-flex shrink-0 text-[color:inherit]">
                {icon}
              </span>
            )}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function SettingsView({
  settings, setSetting, onSave,
  theme, onThemeChange,
  skin, onSkinChange, customTheme, onCustomThemeChange,
  agentLabel,
  serverOnline = false,
  serverBusy = false,
  serverBusyKind = 'starting',
  onStartServer,
  onStopServer,
  section = 'agent',
  onSectionChange,
  isSsoConnected = false,
  ssoError = '',
  onSsoSignIn,
  // Mobile (ENG-990): render as a full page with master-detail navigation
  // instead of the desktop two-column layout. onClose closes the surface
  // from the section list (the top-bar back control drills out to it first).
  mobile = false,
  onClose,
  // Shell (installer) update notice (ENG-849): { version, currentVersion,
  // downloadUrl } or null. Shown in Updates regardless of banner dismissal —
  // Settings is a deliberate visit, so it always reflects the true state.
  shellUpdate = null,
  onDownloadShellUpdate,
  shellAutoUpdate = null,
  onDownloadShellAutoUpdate,
  onInstallShellAutoUpdate,
  onRetryShellAutoUpdate,
}) {
  const [saved, setSaved] = useState(false);
  const [validation, setValidation] = useState(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  // Per-role "use a typed model id" flag. Sticky so picking Other…
  // keeps the text input visible even when the typed value is empty.
  const [modelInputMode, setModelInputMode] = useState({ planning: false, coding: false });
  // Per-role "refetching model list on dropdown open" flag — drives the
  // trigger's spinner so a still-open dropdown showing possibly-stale
  // locked/unlocked state doesn't read as done loading.
  const [modelRefreshing, setModelRefreshing] = useState({ planning: false, coding: false, router: false });
  // Start by distrusting a persisted provider failure. The mount-time check
  // below decides whether it is still real before failure UI is shown.
  const [initialProviderTestDone, setInitialProviderTestDone] = useState(false);
  // Per-role note of when the refresh above last landed fresh data, so
  // re-opening the dropdown doesn't re-pay a round trip that just completed.
  // -Infinity, not 0: performance.now() is already well past 0 by first render, so a
  // 0 sentinel reads as "refreshed at page load" and skips the first open of the
  // session — the one open where the wallet state is most likely to be stale.
  const modelOpenState = useRef({});
  const modelOpenFor = (role) => (modelOpenState.current[role] ||= { refreshedAt: -Infinity });
  // Whether the refresh token lives in the macOS keychain (vs a file under
  // ~/.cowork). Mac-only; read from main on mount.
  const [keychainPref, setKeychainPref] = useState(false);
  // Mobile master-detail (ENG-990/ENG-991): the open section is the shared
  // `section` prop, not a separate local state — so a deep-link
  // (onOpenSettings('backend')) lands on that section AND the section-keyed
  // load effects below fire on mobile too. `section == null` is the list; a
  // row tap calls onSectionChange(id), the back control onSectionChange(null).

  useEffect(() => { if (host.isElectron && host.isMac()) host.getKeychainPref().then(setKeychainPref).catch(() => { }); }, []);

  // Optimistically flip the keychain toggle, then persist via main. Revert
  // the local state if the migration/write fails.
  const handleKeychainToggle = async (next) => {
    setKeychainPref(next);
    try {
      const ok = await host.setKeychainPref(next);
      if (!ok) setKeychainPref(!next);
    } catch {
      setKeychainPref(!next);
    }
  };

  // Tracks whether any LLM-affecting setting changed since the last
  // successful Save. Used to skip provider tests on a no-op Save so a
  // user just toggling appearance doesn't pay the network round-trip.
  const [llmDirty, setLlmDirty] = useState(false);
  // Providers currently showing the API key input instead of the status pill.
  // Starts empty — providers flip to key-edit mode when the user clicks Edit.
  // Cleared automatically after a successful save+test so the pill re-appears.
  const [editingProviders, setEditingProviders] = useState(new Set());
  // Snapshot of the last-saved settings JSON. While `settings` matches
  // this snapshot the Save button reads "Saved" — flips back to "Save
  // settings" the moment the user changes anything.
  const [lastSavedJson, setLastSavedJson] = useState(null);
  // Exclude transient test-result fields from the dirty check — they're not
  // user-editable settings and flip during Save itself, causing the button to
  // re-enable immediately after a successful save+test cycle.
  const { providerStatus: _ps, providerStatusDetails: _psd, ...settingsForDirty } = settings;
  const currentJson = JSON.stringify(settingsForDirty);
  const settingsDirty = lastSavedJson !== null && currentJson !== lastSavedJson;
  // Parsed view of the saved snapshot. The Advanced Settings budget inputs
  // use it to revert an emptied field to the last COMMITTED value — the
  // snapshot is the only place that value survives once drafts land in
  // `settings` (see BudgetNumberField).
  const lastSavedSettings = useMemo(() => {
    if (lastSavedJson == null) return null;
    try { return JSON.parse(lastSavedJson); } catch { return null; }
  }, [lastSavedJson]);
  // Capability probe for the Advanced Settings budgets: cowork-server's
  // list_settings returns a row for EVERY UserSettings field, so a server
  // with the budget settings always sends both keys and an older one never
  // does. Gating on presence keeps the section (and any possibility of
  // writing the keys) off screens backed by servers that would 400 the
  // write — the renderer ships OTA and can lead the installed server.
  // Probe the LIVE settings, not the saved snapshot: the snapshot latches on
  // the first render (offline-open would pin "no budgets" for the whole
  // mount, even after a successful fetch). Live is equally safe — the only
  // writer that can materialize these keys is the budget field itself, which
  // sits inside this gate, so on an older server they can never appear.
  const hasBudgetSettings = settings != null
    && 'maxToolRounds' in settings
    && 'maxContinuations' in settings;
  // Ref-mirror of `settings` so the post-Save snapshot can read the
  // freshly-refetched value (the closure's `settings` is stale after
  // the await but the ref tracks every render).
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; });

  // First load: snapshot once `settings` is populated so the resting
  // state is "Saved" until the user touches anything.
  useEffect(() => {
    if (lastSavedJson === null && settings && Object.keys(settings).length > 0) {
      setLastSavedJson(currentJson);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentJson]);
  const configReady = validation?.configReady ?? settings.configReady;
  const configError = validation?.configError || settings.configError;

  // Providers state — surfaced from the server, edited inline, committed
  // on Save settings. The save handler routes through the providers path
  // when `providers` is included on the patch.
  const providers = Array.isArray(settings.providers) ? settings.providers : [];
  const modelMode = settings.modelMode === 'custom' ? 'custom' : 'default';
  const overrides = settings.modelOverrides || {};
  const recommendedModels = settings.recommendedModels || {};
  const recommendedPair = settings.recommendedPair || {};
  const typeLabels = settings.providerTypeLabels || PROVIDER_LABELS_LOCAL;

  const updateProviders = (next) => setSetting('providers', dedupeByType(next));
  const availableTypesForAdd = PROVIDER_TYPE_ORDER.filter(
    (t) => !providers.some((p) => p.type === t),
  );

  const roleOverride = (role) => {
    if (modelMode !== 'custom') return null;
    const override = overrides[role];
    if (!override || typeof override !== 'object') return null;
    return { ...override, providerType: providerValueToType(override.providerType) };
  };
  const canonicalProviderForRole = (role) => effectiveRoleProvider(settings, role);
  const canonicalModelForRole = (role) => effectiveRoleModel(settings, role);
  // ENG-739: resolve the picker's current provider/model from the canonical
  // fields the SERVER executes, never from `model_overrides`. Sourcing the
  // current value from the overrides hid a stale planning_model pin
  // (latest:sonnet) behind the override's model, so the picker showed a model
  // already-selected, offered no change, and a stuck free-tier user could not
  // recover. See effectiveRoleModel / effectiveRoleProvider.
  const roleProviderType = (role) => canonicalProviderForRole(role);
  const roleModelValue = (role, fallback = '') => canonicalModelForRole(role) || fallback || '';
  const setRoleDriver = (role, providerType, model) => {
    const normalizedType = providerValueToType(providerType) || 'minds-cloud';
    // null is a tombstone ("clear the stored row so the server's enabled-aware
    // default governs", ENG-1632) and must survive to the save path untouched.
    const nextModel = model === null ? null : (model || '');
    if (role === 'planning') {
      setSetting('planningProvider', normalizedType);
      setSetting('planningModel', nextModel);
      setSetting('defaultModel', nextModel);
    } else if (role === 'router') {
      setSetting('routerProvider', normalizedType);
      setSetting('routerModel', nextModel);
    } else {
      setSetting('codingProvider', normalizedType);
      setSetting('codingModel', nextModel);
    }
  };

  // A provider is usable once it carries the credential it needs: an
  // API key for the hosted providers, or a base URL for an
  // OpenAI-compatible endpoint (key optional there). Mirrors the
  // server's _provider_configured. Note keys arrive masked ('***'),
  // which is still truthy — exactly what "has a key" should mean.
  const providerConfigured = (p) => (
    p.type === 'openai-compatible'
      ? !!(p.baseUrl || '').trim()
      : !!(p.apiKey || '').trim()
  );
  const anyProviderFailed = providers.some(
    (p) => providerConfigured(p) && (settings.providerStatus || {})[p.type] === 'fail',
  );

  // The provider that drives roles in default mode. Mirrors the
  // server's _default_provider: prefer MindsHub when it's actually
  // keyed, otherwise fall back to the first configured provider so
  // adding e.g. an Anthropic key "just works" without touching the
  // custom-model controls. Falls back to MindsHub when nothing is
  // configured so the unconfigured baseline still surfaces a row.
  const defaultModeProviderType = (() => {
    const minds = providers.find((p) => p.type === 'minds-cloud');
    if (minds && providerConfigured(minds)) return 'minds-cloud';
    const configured = providers.find(providerConfigured);
    return configured ? configured.type : 'minds-cloud';
  })();

  // Which provider types actually drive planning + coding right now.
  // Planning and coding can pick *different* providers, so the active
  // set is the union of both roles. A role with no explicit override
  // implicitly falls back to the default-mode provider (matches the
  // server's _resolve_role logic) — include that in the set so the
  // test still pings it. Used by the per-row dot, runProviderTests,
  // and the banner's effective-ready calculation.
  const activeProviderTypes = (() => {
    const types = new Set();
    if (modelMode === 'custom') {
      // ENG-739: source each role's provider from the canonical field the
      // server executes (via roleProviderType), not the orphaned
      // model_overrides — otherwise connectivity tests + the readiness banner
      // could target a different provider than the picker and the server use.
      types.add(roleProviderType('planning'));
      types.add(roleProviderType('coding'));
    } else {
      types.add(defaultModeProviderType);
    }
    return types;
  })();

  // Custom providers must carry a non-empty name. Pre-compute so the
  // Models dropdown can show the name and the Save button knows to
  // block when any custom row is missing one.
  const providerDisplayName = (p) => {
    if (p.type === 'openai-compatible') return (p.name || '').trim() || 'OpenAI-compatible';
    return typeLabels[p.type] || p.type;
  };
  const missingCustomNames = providers.some(
    (p) => p.type === 'openai-compatible' && !(p.name || '').trim(),
  );

  // MindsHub is the permanent baseline — always show its row so the
  // user has a path to a working provider without having to add one.
  useEffect(() => {
    if (!providers.some((p) => p.type === 'minds-cloud')) {
      updateProviders([makeEmptyProvider('minds-cloud'), ...providers]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.length, providers.some((p) => p.type === 'minds-cloud')]);

  const updateProviderField = (type, key, value) => {
    setLlmDirty(true);
    updateProviders(providers.map((p) => (p.type === type ? { ...p, [key]: value } : p)));
    // Sync provider card API keys to the individual settings so both
    // stay in sync. Without this, the providers JSON blob gets the new
    // key but the individual openai_api_key / anthropic_api_key /
    // minds_api_key setting stays stale.
    if (key === 'apiKey' && value !== '***') {
      const settingKey = providerTypeToKeyField(type);
      if (settingKey) setSetting(settingKey, value);
      const nextStatus = { ...(settings.providerStatus || {}) };
      const nextDetails = { ...(settings.providerStatusDetails || {}) };
      delete nextStatus[type];
      delete nextDetails[type];
      setSetting('providerStatus', nextStatus);
      setSetting('providerStatusDetails', nextDetails);
    }
    if (key === 'baseUrl' && (type === 'openai-compatible' || type === 'gemini')) {
      setSetting('openaiBaseUrl', value);
    }
  };
  const addProviderOfType = (type) => {
    if (providers.some((p) => p.type === type)) return;
    setLlmDirty(true);
    updateProviders(providers.concat([makeEmptyProvider(type)]));
    setAddPickerOpen(false);
  };
  const removeProvider = (type) => {
    // MindsHub stays as a permanent option even when unconfigured —
    // it's the recommended path and users shouldn't be able to lose it.
    if (PROTECTED_PROVIDER_TYPES.has(type)) return;
    setLlmDirty(true);
    const next = providers.filter((p) => p.type !== type);
    // Clear the individual API key so backfillProviders doesn't re-add
    // this provider on the next settings fetch.
    const keyField = providerTypeToKeyField(type);
    if (keyField) setSetting(keyField, '');

    // Role settings referencing the removed provider get re-pointed at
    // MindsHub with NO model value — tombstoned (null → row cleared) so the
    // server's enabled-aware default governs every role. Writing any model
    // here fabricates a user choice: the raw pair used to pin haiku/kimi for
    // exactly the accounts that couldn't pay for them (ENG-1632), and an
    // "affordable" seed would strand a later top-up on the free model
    // (ENG-597 spring-back). The picker shows the server-computed value for
    // unset fields after the post-save refetch.
    const adjustedOverrides = {};
    for (const role of ['planning', 'coding', 'router']) {
      const o = roleOverride(role);
      if (roleProviderType(role) === type) {
        adjustedOverrides[role] = { providerType: 'minds-cloud', model: null };
        setRoleDriver(role, 'minds-cloud', null);
      } else {
        if (o) adjustedOverrides[role] = o;
      }
    }
    setSetting('modelOverrides', adjustedOverrides);
    updateProviders(next);
  };

  // Re-verify provider connectivity and persist the result. By default tests
  // only the providers driving the planning + coding roles (each role
  // contributes its driver — a custom override or the canonical role setting),
  // so a planning/coding split pings both. Pass an explicit list to test others
  // — the mount-time background verify passes every configured provider. The
  // server merges results into the persisted status map, so dots survive a
  // reload.
  const runProviderTests = async (targetProviders = null) => {
    const toTest = targetProviders || providers.filter((p) => activeProviderTypes.has(p.type));
    if (toTest.length === 0) return null;

    const result = await testProviders(toTest);
    if (result && result.providerStatus) {
      const current = settingsRef.current?.providerStatus || {};
      const next = { ...current, ...result.providerStatus };
      const changed = Object.keys(result.providerStatus).some((k) => current[k] !== result.providerStatus[k]);
      if (changed) setSetting('providerStatus', next);
    }
    if (result && result.providerStatusDetails) {
      const currentDetails = settingsRef.current?.providerStatusDetails || {};
      setSetting('providerStatusDetails', { ...currentDetails, ...result.providerStatusDetails });
    }
    return result;
  };

  // On first mount (once settings have loaded so providers is populated),
  // re-verify every configured provider in the background so the seeded
  // connected-from-credentials dots converge to real connectivity. Ref-guarded
  // to fire a single time per mount.
  const didMountVerify = useRef(false);
  useEffect(() => {
    if (didMountVerify.current) return;
    const configured = providers.filter(providerConfigured);
    if (configured.length === 0) {
      // Nothing to verify — the picker's warning reflects config, not a
      // pending network result, so let it show without waiting.
      setInitialProviderTestDone(true);
      return;
    }
    didMountVerify.current = true;
    runProviderTests(configured)
      .catch(() => { })
      .finally(() => setInitialProviderTestDone(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  // In default model mode the role provider/model fields are never edited
  // directly — only the custom-mode controls call setRoleDriver — so the
  // persisted planning/coding roles stay pinned to whatever they were last
  // set to (e.g. minds-cloud from sign-in) and the server keeps demanding
  // that provider's key. Mirror the dropped server-side _resolve_role: pin
  // both roles to the resolved default-mode provider and its recommended
  // pair so a configured key actually drives the agent. Only repoints a role
  // whose provider differs, so unrelated saves don't rewrite the model.
  const withResolvedRoles = (s) => {
    if (modelMode === 'custom') return s;
    const type = defaultModeProviderType;
    const next = { ...s };
    // Default mode means "the server decides the models" — so a repoint writes
    // NO model value for any role, planning included. Writing one claims a
    // user intent that doesn't exist: the row is indistinguishable from a real
    // pick, so the server honors it forever, which both pinned unaffordable
    // models on wallet-locked accounts (ENG-1632 — the write survived the save
    // diff exactly for them) and, seeded "affordably", would strand a
    // topped-up account on the free model (defeats ENG-597's spring-back).
    // Tombstone instead (null → DELETE in updateSettings): the server's
    // enabled-aware default governs, and GET /settings returns the computed
    // value for unset fields, so the picker displays exactly what runs.
    // The provider still repoints: keeping a stale model id from another
    // provider would misroute (pnewsam review on #663).
    if ((providerValueToType(s.planningProvider) || 'minds-cloud') !== type) {
      next.planningProvider = type;
      next.planningModel = null;
      next.defaultModel = null;
    }
    if ((providerValueToType(s.codingProvider) || 'minds-cloud') !== type) {
      next.codingProvider = type;
      next.codingModel = null;
    }
    if ((providerValueToType(s.routerProvider) || 'minds-cloud') !== type) {
      next.routerProvider = type;
      next.routerModel = null;
    }
    return next;
  };

  const save = async () => {
    // Save runs a validation pass so the banner reflects whether the
    // new config is usable. Provider tests only fire when the LLM
    // settings actually changed since the last Save — no point hitting
    // the network when the user just toggled the dot grid.
    const shouldTestLlm = llmDirty || anyProviderFailed;
    setTesting(true);
    setTested(false);
    try {
      await onSave(withResolvedRoles(clampBudgets(settings)));
      // Record the harness swap only now that it's persisted (ENG-385). Compare
      // against the pre-save snapshot — settingsRef holds the latest value since
      // the closure `settings` is stale after the await.
      try {
        const prevHarness = lastSavedJson ? (JSON.parse(lastSavedJson).harness || 'anton') : null;
        const savedHarness = settingsRef.current?.harness || 'anton';
        if (prevHarness && savedHarness !== prevHarness) trackHarnessSwapped(prevHarness, savedHarness);
      } catch { /* analytics must never break Save */ }
      const result = await validateSettings();
      setValidation(result);
      if (shouldTestLlm) {
        // Use settingsRef.current.providers (post-save, fresh) instead of the
        // stale closure so newly-added providers with masked keys ('***') are
        // included — the backend resolves '***' from storage. Running this
        // after validateSettings (not concurrently) ensures the snapshot below
        // captures the final 'ok'/'fail' state, not the transient 'testing' state.
        const freshProviders = settingsRef.current?.providers || [];
        await runProviderTests(freshProviders.filter(providerConfigured));
        setLlmDirty(false);
        setEditingProviders(new Set());
      }
      setTested(true);
      // Snapshot the now-current settings so the Save button flips to
      // "Saved" until the user makes another edit. settingsRef tracks
      // the latest re-rendered value (the closure's `settings` is the
      // pre-save copy and stale by now).
      const { providerStatus: _ps2, providerStatusDetails: _psd2, ...savedForDirty } = settingsRef.current || {};
      setLastSavedJson(JSON.stringify(savedForDirty));
      setSaved(true);
      setTimeout(() => setTested(false), 2400);
    } catch (err) {
      setValidation({
        status: 'error',
        configReady: false,
        configError: err.message || 'Settings could not be saved.',
      });
      setSaved(false);
    } finally {
      setTesting(false);
    }
  };

  const validate = async () => {
    if (testing) return;
    setTesting(true);
    setTested(false);
    try {
      const [result] = await Promise.all([
        validateSettings(),
        runProviderTests(),
      ]);
      setValidation(result);
      setTested(true);
      setTimeout(() => setTested(false), 2400);
    } catch (err) {
      setValidation({
        status: 'error',
        configReady: false,
        configError: err.message || 'Settings could not be validated.',
      });
    } finally {
      setTesting(false);
    }
  };

  const testButtonLabel = testing
    ? 'Testing…'
    : tested
      ? (<><span className="inline-flex mr-1.5 align-middle">{Ico.check(13)}</span>Tested</>)
      : 'Test';

  // ───────────────────────── Shared footer/banner helpers ─────────────────────────

  const renderSaveFooter = () => {
    const saveDisabled = (!settingsDirty && !anyProviderFailed) || testing || missingCustomNames;
    const saveHint = missingCustomNames ? 'Each custom provider needs a name' : testing ? 'Saving…' : (!settingsDirty && !anyProviderFailed) ? 'No unsaved changes' : anyProviderFailed ? 'Re-test failed providers.' : 'Save changes and re-run provider tests.';
    return (
    <>
      <div
        role="status" aria-live="polite" aria-atomic="true"
        className="flex-1 text-[13px] font-medium text-ink-3 inline-flex items-center gap-1.5"
      >
        {testing && <span aria-hidden="true" className="spinner" style={{ width: 12, height: 12 }} />}
        {!testing && tested && configReady && <span aria-hidden="true" className="text-sage-500 inline-flex">{Ico.check(13)}</span>}
        {!testing && saved && !tested && <span aria-hidden="true" className="text-sage-500 inline-flex">{Ico.check(13)}</span>}
        <span>
          {testing ? 'Testing configuration…'
            : tested ? (configReady ? 'Test passed — provider, model, and credentials look good.' : (configError || 'Test reported a problem.'))
              : saved ? 'Settings saved.'
                : configError ? configError
                  : 'Changes apply on save.'}
        </span>
      </div>
      <Tooltip content={saveHint}>
        {/* Native title only while disabled: a disabled <button> fires no
            hover/focus events, so the styled Tooltip can't open — but the
            reason it's disabled is exactly what the user needs then. */}
        <Button
          variant="primary" onClick={save}
          disabled={saveDisabled}
          title={saveDisabled ? saveHint : undefined}
          className="w-[140px] inline-flex items-center justify-center gap-1.5"
          style={{ opacity: saveDisabled ? 0.55 : 1, cursor: saveDisabled ? 'default' : 'pointer' }}
        >
          {testing ? 'Saving…' : (settingsDirty || anyProviderFailed) ? 'Save settings' : <>{Ico.check(14)} Saved</>}
        </Button>
      </Tooltip>
    </>
    );
  };

  // ───────────────────────── Section renderers ─────────────────────────

  const renderAgentSection = () => {
    const anyProviderConfigured = providers.some(providerConfigured);
    return (
      <SettingsSectionPanel footer={renderSaveFooter()}>
        <div className="flex flex-col">
          <div className={anyProviderConfigured ? 'order-2' : 'order-none'}>
            <SettingsGroup title="LLM Providers">
              {providers.map((p) => {
                const configured = providerConfigured(p);
                const label = typeLabels[p.type] || p.type;
                const reveal = p.type === 'anthropic' ? 'anthropic'
                  : p.type === 'minds-cloud' ? 'minds'
                    : p.type === 'gemini' ? 'gemini'
                      : p.type === 'openai-compatible' ? 'openai-compatible'
                        : p.type === 'openai' ? 'openai'
                          : null;
                // Show the persisted/seeded status for any configured provider — a
                // configured provider reads as connected at startup, not just the one
                // currently driving a role. Unconfigured rows have nothing to show.
                const st = deriveProviderStatus(p.type, {
                  providerStatus: settings.providerStatus || {},
                  providerStatusDetails: settings.providerStatusDetails || {},
                  configured,
                  isSsoConnected,
                  testInProgress: testing,
                  initialTestDone: initialProviderTestDone,
                });
                const status = st.checking ? 'testing' : st.settled;
                const detail = configured ? st.detail : '';
                const friendlyError = friendlyProviderError(detail);
                const statusBadge = providerStatusBadge(status, configured);
                const statusPillTitle = status === 'ok' ? `Last test passed${detail ? ` (${detail})` : ''}`
                  : status === 'fail' ? `Last test failed${detail ? `: ${detail}` : ''}`
                    : status === 'testing' ? 'Testing…'
                      : 'Not tested yet — save settings and run a test to verify.';
                const statusPill = statusBadge ? (
                  <Badge
                    title={statusPillTitle}
                    aria-label={statusPillTitle}
                    variant={statusBadge.variant}
                    size="md"
                    className={`shrink-0 tracking-[0.01em] ${status === 'testing' ? 'set-badge-pulse' : ''}`}
                    style={{
                      animation: status === 'testing' ? 'set-badge-pulse 1.4s ease-in-out infinite' : 'none',
                    }}
                  >{statusBadge.label}</Badge>
                ) : null;
                // Each provider row is a sub-section in the Providers group,
                // so every row gets an <h3> for SR heading navigation. Known
                // types render the label visibly; the openai-compatible row
                // already shows an editable name input as its title, so the
                // <h3> uses the `.sr-only` utility (its text is the current
                // name or a sensible fallback) — keeps the visual unchanged
                // while making the row reachable by H/4 navigation.
                const headingBaseClass =
                  'm-0 p-0 leading-[1.3] text-base font-semibold text-ink';
                const customHeadingText = p.type === 'openai-compatible'
                  ? ((p.name || '').trim() || 'Custom OpenAI-compatible provider')
                  : null;
                const titleNode = (
                  <span className="inline-flex items-center flex-wrap gap-2">
                    {p.type === 'openai-compatible' ? (() => {
                      const nameEmpty = !(p.name || '').trim();
                      const errorId = `provider-name-error-${p.type}`;
                      return (
                        <div className="flex flex-col gap-[3px]">
                          <h3 className="sr-only">{customHeadingText}</h3>
                          <Input
                            value={p.name ?? ''}
                            onChange={(next) => updateProviderField('openai-compatible', 'name', next)}
                            placeholder="Custom provider name"
                            title="Display name for this custom provider — shown in the model dropdowns below."
                            aria-label="Custom provider name"
                            aria-invalid={nameEmpty || undefined}
                            aria-describedby={nameEmpty ? errorId : undefined}
                            aria-required="true"
                            style={{
                              width: 220, fontSize: 13.5, fontWeight: 600,
                              borderColor: nameEmpty ? 'color-mix(in srgb, var(--danger) 55%, transparent)' : undefined,
                            }}
                          />
                          {nameEmpty && (
                            <span id={errorId} className="text-[10.5px] text-danger">Name required</span>
                          )}
                        </div>
                      );
                    })() : (
                      <h3 className={headingBaseClass}>{label}</h3>
                    )}
                  </span>
                );
                // Show the key input when: unconfigured, never tested, or user clicked Edit.
                // Otherwise the middle column shows the status pill and an Edit button appears.
                const ssoMindsHub = p.type === 'minds-cloud' && isSsoConnected;
                // Keep a stale failed provider in badge mode while its fresh test is
                // pending; otherwise the testing badge is replaced by the masked key.
                const showKeyInput = ssoMindsHub || !configured || st.settled === 'untested'
                  || (st.settled === 'fail' && !st.checking) || editingProviders.has(p.type);
                return (
                  <div key={p.type} className={`settings-provider-row py-4 items-start ${mobile
                    // Desktop: name | key/status | actions in a 3-col grid.
                    // Mobile: a compact left-aligned column — the grid stacked
                    // but kept the status pill + a 30px-wide button column
                    // right-aligned, floating them into a lot of dead space.
                    ? 'flex flex-col gap-2.5'
                    : 'grid grid-cols-[1fr_380px_auto] gap-6'}`}>
                    {/* Left: name + description */}
                    <div>
                      {titleNode}
                      {PROVIDER_TYPE_DESC[p.type] && (
                        <div className="text-[12px] text-ink-3 mt-1.5 max-w-[380px] leading-[1.45]">
                          {PROVIDER_TYPE_DESC[p.type]}
                        </div>
                      )}
                    </div>

                    {/* Middle: status pill (tested) OR key input (editing / untested) */}
                    {showKeyInput ? (
                      <div className="grid gap-1.5">
                        {ssoMindsHub ? (
                          <div className={`flex items-center py-[5px] px-0 ${mobile ? 'justify-start' : 'justify-end'}`}>
                            {statusPill}
                          </div>
                        ) : (
                          <ApiKeyInput
                            value={p.apiKey ?? ''}
                            onChange={(v) => updateProviderField(p.type, 'apiKey', v)}
                            placeholder={
                              p.type === 'anthropic' ? 'sk-ant-••••••••' :
                                p.type === 'minds-cloud' ? 'mdb_••••••••' :
                                  p.type === 'gemini' ? 'AIza••••••••' :
                                    'sk-••••••••'
                            }
                            revealName={reveal}
                          />
                        )}
                        {p.type === 'openai-compatible' && (
                          <ClearableTextInput
                            value={p.baseUrl ?? ''}
                            onChange={(v) => updateProviderField('openai-compatible', 'baseUrl', v)}
                            placeholder="https://example.com/v1"
                            ariaLabel="Base URL"
                          />
                        )}
                        {GET_KEY_URL[p.type] && !ssoMindsHub && (
                          <div className="text-[11.5px] text-ink-3">
                            Get your API key at{' '}
                            <Tooltip content={`Open ${GET_KEY_URL[p.type].replace(/^https?:\/\//, '')} in your browser.`}>
                              <a
                                href={GET_KEY_URL[p.type]}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-accent"
                              >{GET_KEY_URL[p.type].replace(/^https?:\/\//, '')} →</a>
                            </Tooltip>
                          </div>
                        )}
                        {p.type === 'minds-cloud' && !isSsoConnected && (
                          <div className="text-[11.5px] text-ink-3">
                            Don't have an account?{' '}
                            <Tooltip content="Open the MindsHub sign-up page in your browser.">
                              <a
                                href={MINDS_REGISTER_URL}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-accent"
                              >Sign up →</a>
                            </Tooltip>
                          </div>
                        )}
                        {status === 'fail' && friendlyError && (
                          <div className="text-[11.5px] text-danger flex items-start gap-1.5">
                            <span className="shrink-0 mt-px">{Ico.key ? Ico.key(11) : '!'}</span>
                            <span>{friendlyError}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      // Status pill replaces the key input after a test result
                      <div className={`flex items-center py-[5px] px-0 gap-2.5 ${mobile ? 'justify-start' : 'justify-end'}`}>
                        {status === 'fail' && friendlyError && (
                          <span className="text-[11.5px] text-danger">{friendlyError}</span>
                        )}
                        {statusPill}
                      </div>
                    )}

                    {/* Right (desktop) / inline row (mobile): trash + edit */}
                    <div className={`flex gap-1.5 ${mobile ? 'flex-row w-auto' : 'flex-col w-[30px]'}`}>
                      {!PROTECTED_PROVIDER_TYPES.has(p.type) && (
                        <Tooltip content="Remove this provider">
                          <Button
                            variant="danger"
                            icon
                            size="sm"
                            onClick={() => removeProvider(p.type)}
                            aria-label="Remove this provider"
                          >{Ico.trash(13)}</Button>
                        </Tooltip>
                      )}
                      {!showKeyInput && (
                        <Tooltip content="Edit API key">
                          <Button
                            icon
                            size="sm"
                            onClick={() => setEditingProviders((prev) => new Set([...prev, p.type]))}
                            aria-label="Edit API key"
                          >{Ico.edit(13)}</Button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="relative pt-[14px] px-0 pb-1 min-h-[50px]">
                {/* Idle: + Add provider button. Fades + slides down when
              the picker opens. */}
                <Tooltip content={availableTypesForAdd.length === 0 ? 'All provider types are already configured' : 'Add another provider'}>
                  <Button
                    variant="subtle"
                    onClick={() => setAddPickerOpen(true)}
                    disabled={availableTypesForAdd.length === 0}
                    title={availableTypesForAdd.length === 0 ? 'All provider types are already configured' : undefined}
                    className="absolute top-[14px] left-0 inline-flex items-center gap-1.5 [transition:opacity_200ms_ease,transform_200ms_ease]"
                    style={{
                      opacity: addPickerOpen ? 0 : (availableTypesForAdd.length === 0 ? 0.45 : 1),
                      transform: addPickerOpen ? 'translateY(6px)' : 'translateY(0)',
                      pointerEvents: addPickerOpen ? 'none' : (availableTypesForAdd.length === 0 ? 'none' : 'auto'),
                      cursor: availableTypesForAdd.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >{Ico.plus(13)} Add provider</Button>
                </Tooltip>

                {/* Open: Choose Provider: <chip> <chip> · Cancel.
              Fades + slides up from below as it appears. */}
                <div
                  className="flex flex-wrap gap-1.5 items-center absolute top-[14px] left-0 right-0 [transition:opacity_220ms_ease,transform_220ms_ease]"
                  style={{
                    opacity: addPickerOpen ? 1 : 0,
                    transform: addPickerOpen ? 'translateY(0)' : 'translateY(-6px)',
                    pointerEvents: addPickerOpen ? 'auto' : 'none',
                  }}>
                  <strong className="text-sm text-ink mr-1">Choose Provider:</strong>
                  {availableTypesForAdd.map((t) => (
                    <Tooltip key={t} content={PROVIDER_TYPE_DESC[t]}>
                      <Button
                        variant="subtle"
                        onClick={() => addProviderOfType(t)}
                        style={{ fontSize: 12.5, padding: '4px 10px', fontWeight: 400 }}
                      >{typeLabels[t] || t}</Button>
                    </Tooltip>
                  ))}
                  <Tooltip content="Hide the provider picker.">
                    <Button
                      variant="subtle"
                      icon
                      size="sm"
                      onClick={() => setAddPickerOpen(false)}
                      aria-label="Close provider picker"
                      className="ml-1"
                    >{Ico.close(13)}</Button>
                  </Tooltip>
                </div>
              </div>
            </SettingsGroup>
          </div>
          <div className={anyProviderConfigured ? 'order-1' : 'order-none'}>
            <SettingsGroup title="Model Router">
              {(() => {
                // The default-mode provider is the implicit fallback for
                // any role that hasn't been explicitly assigned an
                // override (keyed MindsHub, else first configured).
                const defaultProvider =
                  providers.find((p) => p.type === defaultModeProviderType) ||
                  providers.find((p) => p.type === 'minds-cloud') ||
                  providers[0];
                const multipleProviders = providers.length > 1;

                // For each role: render provider selector (when N>1) +
                // model field. When the user picks a new provider, auto-
                // fill the role with that provider's recommended default
                // for the role. Empty overrides fall back to the default
                // provider's recommended pair.
                const RoleRow = ({ role, label }) => {
                  // Resolve the effective provider for this role. The server may
                  // store a stale planning_provider (e.g. 'anthropic') that doesn't
                  // match any configured provider card. When that happens, fall back
                  // to defaultModeProviderType (which prefers the actually-configured
                  // provider — MindsHub if available, else first configured).
                  const rawType = roleProviderType(role) || (defaultProvider?.type || '');
                  const rawProvider = providers.find((p) => p.type === rawType);
                  const curType = (rawProvider && providerConfigured(rawProvider))
                    ? rawType
                    : defaultModeProviderType;
                  const providerWasRepointed = curType !== rawType;
                  // Role slot in the per-provider default tuple
                  // [planning, coding, router]. Router falls back to the coding
                  // default when the backend hasn't sent a 3rd slot yet.
                  const roleIdx = role === 'planning' ? 0 : role === 'router' ? 2 : 1;
                  const fallbackPair = recommendedPair[curType] || ['', '', ''];
                  const fallbackModel = fallbackPair[roleIdx] || fallbackPair[1] || '';
                  const provider = providers.find((p) => p.type === curType);
                  const modelList = recommendedModels[curType] || [];
                  // minds-cloud has no free-text mode (unlike a BYOK provider,
                  // where an unlisted id is just a user-typed custom model) —
                  // same condition resolveModelPickerValue uses for its
                  // "legacy — re-select a model" stale pin.
                  const allowOther = curType !== 'minds-cloud';
                  // See resolveRoleModel: substitutes the fallback not just
                  // when the PROVIDER field was stale, but also when the
                  // provider is already correct (e.g. after an SSO sign-in)
                  // yet the paired model still names a different provider's
                  // model — the case that used to surface as "legacy —
                  // re-select a model" for the user to fix by hand.
                  const curModel = resolveRoleModel(
                    providerWasRepointed, roleModelValue(role, fallbackModel), modelList, allowOther, fallbackModel,
                  );
                  /* Per-model availability (settings.modelEnabled, sourced from MindsHub
                   * /v1/models). A model the org's wallet can't currently pay for (or
                   * whose free allowance is spent) is listed here as false — it stays
                   * selectable with a "Needs credits" tag, and picking it shows the
                   * top-up hint below (ENG-1248). Absent id ⇒ available (backwards
                   * compatible; direct providers have no such flag). */
                  const modelEnabled = settings.modelEnabled || {};
                  const isLocked = (m) => modelEnabled[m] === false;
                  const firstEnabledModel = modelList.find((m) => !isLocked(m)) || modelList[0] || '';
                  const st = deriveProviderStatus(curType, {
                    providerStatus: settings.providerStatus || {},
                    providerStatusDetails: settings.providerStatusDetails || {},
                    configured: !!(provider && providerConfigured(provider)),
                    isSsoConnected,
                    testInProgress: testing,
                    initialTestDone: initialProviderTestDone,
                  });
                  const providerUnconfigured = !!curType && st.unconfigured;
                  const providerFailed = st.failed;
                  const providerFailDetail = st.detail;
                  const isNoCredits = providerFailed && !st.checking && curType === 'minds-cloud'
                    && (providerFailDetail.includes('402')
                      || providerFailDetail.includes('429')
                      || providerFailDetail.toLowerCase().includes('credit')
                      || providerFailDetail.toLowerCase().includes('quota'));
                  const providerUnusable = (providerUnconfigured || providerFailed) && !isNoCredits && !st.checking;
                  const providerCheckingNotice = st.checking;
                  const providerWarnId = `agent-model-${role}-provider`;

                  // Reasoning effort — a per-role setting shown beside the model
                  // dropdown, only for models that advertise effort levels
                  // (settings.modelEfforts, sourced from MindsHub /v1/models + the
                  // static direct-provider catalog). Suppressed for the Hermes
                  // harness, which has no effort knob.
                  // Router has no reasoning-effort knob — it's a single cheap
                  // gating call, not a reasoning role.
                  const effortKey = role === 'planning' ? 'planningReasoningEffort'
                    : role === 'coding' ? 'codingReasoningEffort'
                    : null;
                  const harnessSupportsEffort = (settings.harness || 'anton') !== 'hermes';
                  const effortEntry = (settings.modelEfforts || {})[curModel];
                  const effortOptions = effortEntry?.efforts || [];
                  const savedEffort = effortKey ? settings[effortKey] : '';
                  const effortValue = effortOptions.includes(savedEffort)
                    ? savedEffort
                    : (effortEntry?.default || effortOptions[0] || '');
                  const showEffort = !!effortKey && harnessSupportsEffort && effortOptions.length > 0;

                  const writeOverride = (next) => {
                    const providerType = providerValueToType(next.providerType || curType) || 'minds-cloud';
                    const model = next.model || '';
                    const normalized = { providerType, model };
                    setLlmDirty(true);
                    setRoleDriver(role, providerType, model);
                    setSetting('modelOverrides', { ...overrides, [role]: normalized });
                    setSetting('modelMode', 'custom');
                    // Effort is model-specific — drop any stale level so we never
                    // send an effort the newly-selected model doesn't accept.
                    if (effortKey) setSetting(effortKey, '');
                  };

                  // Plain bold field label. Note: no dotted underline — that reads as
                  // a "hover for a tooltip" affordance, and none is wired here.
                  const fieldLabel = (text) => (
                    <span className="text-xs font-bold text-ink tracking-[0.02em]">{text}:</span>
                  );

                  // Two stacked lines (ENG-1248): the credit state + top-up
                  // action reads first on its own line, the BYOK escape hatch
                  // sits under it. Inline, the escape hatch diluted the one
                  // action that matters when the wallet is empty.
                  const noCreditsNotice = isNoCredits ? (
                    <div className="text-[12px] leading-[1.6] grid gap-px">
                      <div>
                        <span className="text-danger font-semibold">No credits available. </span>
                        <button
                          type="button"
                          onClick={() => host.openExternal ? host.openExternal(MINDS_BILLING_URL) : window.open(MINDS_BILLING_URL, '_blank')}
                          className={LINK_BTN}
                        >Top up balance →</button>
                      </div>
                      <div className="text-ink-3">Or add your own provider and API key below.</div>
                    </div>
                  ) : null;

                  return (
                    <Section title={label} subtitle={`Used for ${
                      role === 'planning' ? 'reasoning, orchestration, and responses'
                        : role === 'router' ? 'fast respond-or-delegate gating on each turn, and history summarization'
                        : 'scratchpad code generation'
                    }.`} notice={noCreditsNotice}>
                      <div className="grid gap-1.5">
                        {multipleProviders && (
                          <label className="grid gap-1">
                            {fieldLabel('Provider')}
                            <Select
                              value={curType}
                              onValueChange={(t) => {
                                // Seed the first wallet-affordable candidate,
                                // not the raw pair value: writing a locked
                                // model on a provider switch converts the
                                // server's dynamic default into a hard pin
                                // that 402s (ENG-1632). This is the ONE place
                                // the client still derives a model — allowed
                                // because it's custom mode and the value lands
                                // visibly in the model field for the user to
                                // see and change before saving (ENG-1248's
                                // informed-consent lane). ENG-1650 (server
                                // exposes resolved per-role models) retires
                                // this derivation too.
                                const pair = recommendedPair[t] || ['', '', ''];
                                const candidates = [
                                  pair[roleIdx] || pair[1],
                                  ...(recommendedModels[t] || []),
                                ].filter(Boolean);
                                const newModel =
                                  candidates.find((m) => modelEnabled[m] !== false)
                                  || candidates[0] || '';
                                setModelInputMode((m) => ({ ...m, [role]: false }));
                                writeOverride({ providerType: t, model: newModel });
                              }}
                              invalid={providerUnusable}
                              aria-describedby={(providerUnusable || providerCheckingNotice) ? providerWarnId : undefined}
                              title={`Choose which provider powers the ${role} role.`}
                              options={providers.map((p) => ({ value: p.type, label: providerDisplayName(p) }))}
                            />
                          </label>
                        )}
                        {modelList.length > 0 ? (
                          (() => {
                            // allowOther is hoisted above (also feeds curModel's
                            // staleness check). See resolveModelPickerValue +
                            // buildModelOptions: keeps the Select's
                            // value matched to a rendered option so picking a model always fires
                            // a real change and Save writes it — a login-written `latest:` pin no
                            // longer wedges the control into a no-op "Saved" (ENG-739).
                            const { showStalePin, inputMode, selectValue } =
                              resolveModelPickerValue(curModel, modelList, allowOther, modelInputMode[role]);
                            // The trailing bag carries MindsHub's authoritative
                            // maker field (so the picker's sections stop being
                            // inferred from the alias) plus the family metadata
                            // that tags the moving aliases "latest".
                            const modelOptions = buildModelOptions(
                              curModel, modelList, allowOther, showStalePin, modelEnabled,
                              settings.modelLabels || {},
                              { modelProviders: settings.modelProviders, modelFamilies: settings.modelFamilies },
                            );
                            return (
                              <>
                              <label className="grid gap-1">
                                {fieldLabel('Model')}
                                <ModelSelect
                                  value={selectValue || firstEnabledModel}
                                  onValueChange={(next) => {
                                    if (next === '__custom__') {
                                      setModelInputMode((m) => ({ ...m, [role]: true }));
                                      writeOverride({ providerType: curType, model: curModel || '' });
                                    } else {
                                      setModelInputMode((m) => ({ ...m, [role]: false }));
                                      writeOverride({ providerType: curType, model: next });
                                    }
                                  }}
                                  onOpenChange={(isOpen) => {
                                    // Opening re-checks the wallet, so a top-up made in an
                                    // external tab unlocks its models here without an app restart.
                                    // The popup opens immediately on the list we already hold and
                                    // reconciles in place when the response lands, rather than
                                    // withholding itself until then: the trigger is a click target,
                                    // and a click that produces nothing for the length of a network
                                    // round trip reads as a broken control. Briefly showing a
                                    // model as locked that a top-up has just unlocked is safe —
                                    // this list is an affordance, not the authority. Auth decides
                                    // at request time, so a stale row can mislead for a moment but
                                    // can never let a turn through that shouldn't run.
                                    if (!isOpen) return;
                                    const openState = modelOpenFor(role);
                                    if (modelRefreshing[role]) return;
                                    // Don't re-pay the round trip for a re-open moments later.
                                    if (performance.now() - openState.refreshedAt < MODEL_REFRESH_TTL_MS) return;
                                    setModelRefreshing((m) => ({ ...m, [role]: true }));
                                    fetchRecommendedModels({ refresh: true }).then((data) => {
                                      // Same merge rule as the mount-time load: an empty list or
                                      // map in the response leaves what we have alone. The
                                      // endpoint answers 200 with empty buckets when the MindsHub
                                      // fetch itself failed, and assigning those straight through
                                      // would empty the dropdown the user just clicked (for every
                                      // role — the keys are shared) until the app restarts.
                                      const merged = mergeRecommendedModels(settings, data);
                                      if (!merged) return;
                                      for (const [key, value] of Object.entries(merged)) setSetting(key, value);
                                      openState.refreshedAt = performance.now();
                                    }).catch(() => { }).finally(() => {
                                      setModelRefreshing((m) => ({ ...m, [role]: false }));
                                    });
                                  }}
                                  loading={modelRefreshing[role]}
                                  title={`Pick the model used for ${role}. Choose Other… to type a custom model id.`}
                                  options={modelOptions}
                                />
                                {inputMode && allowOther && (
                                  <TextInput
                                    value={curModel}
                                    onChange={(v) => writeOverride({ providerType: curType, model: v })}
                                    placeholder="Type a model id"
                                    title="Free-form model id sent verbatim to the provider."
                                  />
                                )}
                              </label>
                              {/* Needs-credits rows stay selectable (ENG-1248) —
                                  this hint is the informed-consent half: the
                                  choice is respected, the cost is named, and the
                                  top-up route is one click away. Outside the
                                  <label> so it doesn't leak into the combobox's
                                  accessible name (PR #579 review). */}
                              {!inputMode && !!curModel && isLocked(curModel) && (
                                <div className="text-[11.5px] text-ink-3">
                                  {displayModelLabel(curModel, settings.modelLabels || {})} needs credits.{' '}
                                  <button
                                    type="button"
                                    onClick={() => host.openExternal ? host.openExternal(MINDS_BILLING_URL) : window.open(MINDS_BILLING_URL, '_blank')}
                                    className={LINK_BTN}
                                  >Top up your balance</button>
                                  {' '}to use it.
                                </div>
                              )}
                            </>);
                          })()
                        ) : (
                          <label className="grid gap-1">
                            {fieldLabel('Model')}
                            <TextInput
                              value={curModel}
                              onChange={(v) => writeOverride({ providerType: curType, model: v })}
                              placeholder="model-id"
                              title="Model id sent verbatim to this provider."
                            />
                          </label>
                        )}
                        {showEffort && (
                          <label className="grid gap-1">
                            {fieldLabel('Reasoning effort')}
                            <Select
                              value={effortValue}
                              onValueChange={(v) => { setLlmDirty(true); setSetting(effortKey, v); }}
                              title={`Reasoning effort for the ${role} model. Higher effort trades latency/cost for deeper reasoning.`}
                              options={effortOptions.map((lvl) => ({ value: lvl, label: lvl.charAt(0).toUpperCase() + lvl.slice(1) }))}
                            />
                          </label>
                        )}
                        {providerCheckingNotice && (
                          <div id={providerWarnId} aria-live="polite" className="text-[11.5px] text-ink-3 flex items-center gap-1.5">
                            <Spinner intervalMs={90} />
                            Checking {providerDisplayName(provider)} connection…
                          </div>
                        )}
                        {providerUnusable && (
                          <div id={providerWarnId} className="text-[11.5px] text-warning">
                            {providerUnconfigured
                              ? (provider
                                ? `${providerDisplayName(provider)} isn't configured — add its credentials under LLM Providers above, or pick another provider.`
                                : 'This provider is not configured. Add it under LLM Providers above.')
                              : `${providerDisplayName(provider)} failed its last test — check it under LLM Providers above, or pick another provider.`}
                          </div>
                        )}
                      </div>
                    </Section>
                  );
                };
                return (
                  <>
                    {RoleRow({ role: 'planning', label: 'Planning model' })}
                    {RoleRow({ role: 'router', label: 'Routing and summarization model' })}
                    {RoleRow({ role: 'coding', label: 'Coding model' })}
                  </>
                );
              })()}
            </SettingsGroup>
          </div>
        </div>

        {/* Coding Mode itself lives in its own top-level nav section (see
            renderCodingModeSection) — desktop-only, since launching an
            external CLI in a terminal is an Electron main-process
            capability with no web equivalent. Web keeps its simple
            single-select Anton/Hermes toggle here instead, unaffected by
            Coding Mode since that concept doesn't exist there. */}
        {host.isWeb && (
          <SettingsGroup title="Agent Harness">
            <Section title="Harness" subtitle={`Which AI agent powers your tasks. ${agentLabel || 'Anton'} is the default; Hermes is an alternative agent with its own tool and memory system.`}>
              <ToggleGroup
                value={settings.harness || 'anton'}
                onValueChange={(v) => { setSetting('harness', v); setLlmDirty(true); }}
                aria-label="Agent harness"
                options={[
                  { value: 'anton', label: 'Anton', 'aria-label': 'Use Anton agent', title: 'Anton — the default AI agent.' },
                  ...((settings.harnessOptions || []).includes('hermes') ? [
                    { value: 'hermes', label: 'Hermes', 'aria-label': 'Use Hermes agent', title: 'Hermes — alternative agent with independent tools and memory.' },
                  ] : []),
                ]}
              />
            </Section>
          </SettingsGroup>
        )}

        <SettingsGroup title="Memory">
          <Section title="Memory mode" subtitle={`How ${agentLabel || 'Anton'} updates its long-term memory.`}>
            <ToggleGroup
              value={settings.memoryMode ?? 'autopilot'}
              onValueChange={(v) => setSetting('memoryMode', v)}
              aria-label="Memory mode"
              options={[
                { value: 'autopilot', label: 'Autopilot', title: `${agentLabel || 'Anton'} updates long-term memory automatically.` },
                { value: 'copilot', label: 'Copilot', title: `${agentLabel || 'Anton'} suggests memory updates for you to confirm.` },
                { value: 'off', label: 'Off', title: 'Disable long-term memory updates.' },
              ]}
            />
          </Section>
          <Section title="Episodic memory" subtitle="Save conversation history for future recall.">
            <Switch
              checked={settings.episodicMemory ?? true}
              onCheckedChange={(v) => setSetting('episodicMemory', v)}
              aria-label="Episodic memory"
            />
          </Section>
          <Section title="Proactive dashboards" subtitle="Auto-generate HTML reports from scratchpad output.">
            <Switch
              checked={settings.proactiveDashboards ?? false}
              onCheckedChange={(v) => setSetting('proactiveDashboards', v)}
              aria-label="Proactive dashboards"
            />
          </Section>
          <Section title="Act first, ask later" subtitle="Act on reasonable defaults and state assumptions inline, instead of stopping to ask.">
            <Switch
              checked={settings.actFirst ?? true}
              onCheckedChange={(v) => setSetting('actFirst', v)}
              aria-label="Act first, ask later"
            />
          </Section>
        </SettingsGroup>

        {hasBudgetSettings && (
          <SettingsGroup title="Advanced Settings" collapsible defaultCollapsed>
            <Section
              title="Max steps per task"
              subtitle={`How many actions (running code, reading files, searching) ${agentLabel || 'Anton'} may take on one request before pausing to check in with you. Raise it so big tasks finish in one go; lower it for a tighter leash on time and cost.`}
            >
              <BudgetNumberField
                settingKey="maxToolRounds"
                value={settings.maxToolRounds}
                savedValue={lastSavedSettings?.maxToolRounds}
                spec={BUDGET_FIELDS.maxToolRounds}
                label="Max steps per task"
                setSetting={setSetting}
              />
            </Section>
            <Section
              title="Max auto-continues"
              subtitle={`When ${agentLabel || 'Anton'} stops but the work looks unfinished, Cowork sends it back to complete the job — this caps how many times. Raise it for hands-off thoroughness; set 0 to stop after the first attempt (you'll still get a summary of what's missing).`}
            >
              <BudgetNumberField
                settingKey="maxContinuations"
                value={settings.maxContinuations}
                savedValue={lastSavedSettings?.maxContinuations}
                spec={BUDGET_FIELDS.maxContinuations}
                label="Max auto-continues"
                setSetting={setSetting}
              />
            </Section>
            {/* Gated on its OWN key, not folded into `hasBudgetSettings`.
                This setting reaches the server one release after the other two,
                so requiring it in that gate would hide the whole group — and
                the two working fields with it — on every server that predates
                it. The renderer ships OTA and leads the installed server. */}
            {'maxTurnTokens' in settings && (
              <Section
                title="Max tokens per task"
                subtitle={`The most tokens ${agentLabel || 'Anton'} may spend on one request before pausing to check in with you. Tokens are what your plan's monthly allowance is measured in, so a task that gets stuck can use up a large share of the month without finishing. Raise it if you routinely give it big jobs; lower it to cap what any single request can cost.`}
              >
                <BudgetNumberField
                  settingKey="maxTurnTokens"
                  value={settings.maxTurnTokens}
                  savedValue={lastSavedSettings?.maxTurnTokens}
                  spec={BUDGET_FIELDS.maxTurnTokens}
                  label="Max tokens per task"
                  setSetting={setSetting}
                  unlimitedLabel="No limit"
                />
              </Section>
            )}
          </SettingsGroup>
        )}
      </SettingsSectionPanel>
    );
  };

  // Appearance auto-save — every control on this page persists on its own,
  // debounced for text/color inputs so typing doesn't fire a write per
  // keystroke. Per-key status (saving/saved/error) gives the user direct
  // feedback instead of relying on the page-wide Save button, which these
  // fields no longer participate in — there's no Save button on this page
  // at all (see AutoSaveTag and renderAppearanceSection).
  const [autoSaveStatus, setAutoSaveStatus] = useState({});
  const autoSaveTimersRef = useRef({});
  const autoSaveFadeTimersRef = useRef({});
  const autoSaveRemoveTimersRef = useRef({});

  const AUTO_SAVE_HOLD_MS = 1400; // how long "Saved" stays at full opacity
  const AUTO_SAVE_FADE_MS = 500;  // opacity transition duration (matches the inline style below)

  const autoSaveSetting = (key, value, { debounceMs = 0 } = {}) => {
    setSetting(key, value);
    clearTimeout(autoSaveTimersRef.current[key]);
    clearTimeout(autoSaveFadeTimersRef.current[key]);
    clearTimeout(autoSaveRemoveTimersRef.current[key]);

    const commit = async () => {
      setAutoSaveStatus((prev) => ({ ...prev, [key]: { state: 'saving', fading: false } }));
      try {
        await onSave({ [key]: value });
        // Narrow the "last saved" snapshot to just this field so the
        // shared page-wide Save button (used by Providers/Model settings
        // elsewhere in this view) doesn't mistake an auto-saved Appearance
        // change for a pending manual one — or, worse, mark a genuinely
        // unsaved Provider edit as "Saved" just because Appearance also
        // changed at the same time.
        setLastSavedJson((prev) => patchSavedJson(prev, key, value));
        setAutoSaveStatus((prev) => ({ ...prev, [key]: { state: 'saved', fading: false } }));
        // Hold at full opacity, then fade out, then unmount — a plain status
        // message, not a button, and it disappears on its own.
        autoSaveFadeTimersRef.current[key] = setTimeout(() => {
          setAutoSaveStatus((prev) => (
            prev[key]?.state === 'saved' ? { ...prev, [key]: { state: 'saved', fading: true } } : prev
          ));
          autoSaveRemoveTimersRef.current[key] = setTimeout(() => {
            setAutoSaveStatus((prev) => {
              const { [key]: _drop, ...rest } = prev;
              return rest;
            });
          }, AUTO_SAVE_FADE_MS);
        }, AUTO_SAVE_HOLD_MS);
      } catch (err) {
        // Errors don't auto-fade — they stay until the next attempt so a
        // failed save can't go unnoticed.
        setAutoSaveStatus((prev) => ({ ...prev, [key]: { state: 'error', fading: false } }));
        console.warn(`Auto-save failed for ${key}:`, err);
      }
    };

    if (debounceMs > 0) {
      autoSaveTimersRef.current[key] = setTimeout(commit, debounceMs);
    } else {
      commit();
    }
  };

  useEffect(() => () => {
    Object.values(autoSaveTimersRef.current).forEach(clearTimeout);
    Object.values(autoSaveFadeTimersRef.current).forEach(clearTimeout);
    Object.values(autoSaveRemoveTimersRef.current).forEach(clearTimeout);
  }, []);

  function AutoSaveTag({ settingKey }) {
    const status = autoSaveStatus[settingKey];
    if (!status) return null;
    const fadeStyle = {
      opacity: status.fading ? 0 : 1,
      transition: `opacity ${AUTO_SAVE_FADE_MS}ms ease`,
    };
    if (status.state === 'saving') {
      return <span style={fadeStyle} className="text-[11.5px] text-ink-4 ml-2">Saving…</span>;
    }
    if (status.state === 'error') {
      return <span style={fadeStyle} className="text-[11.5px] text-danger ml-2">Couldn't save</span>;
    }
    return (
      <span style={fadeStyle} className="text-[11.5px] text-[var(--ok)] ml-2 inline-flex items-center gap-1">
        {Ico.check(11)} Saved
      </span>
    );
  }

  // Sidebar logo upload — read as a data URI and save as the synced
  // `navLogo` setting (same pipeline as every other setting, e.g. greeting).
  // Capped well under a reasonable size for a settings-table text column.
  const logoInputRef = useRef(null);
  const MAX_LOGO_BYTES = 300 * 1024;
  const [logoError, setLogoError] = useState(null);
  const handleLogoUpload = (file) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('Logo must be under 300 KB.');
      return;
    }
    setLogoError(null);
    const reader = new FileReader();
    reader.onload = () => autoSaveSetting('navLogo', reader.result);
    reader.readAsDataURL(file);
  };

  // Desktop-only (see the WEB_NAV_IDS comment on NAV_ITEMS above) — web
  // never navigates here since 'codingMode' is absent from WEB_NAV_IDS.
  const renderCodingModeSection = () => (
    <SettingsSectionPanel footer={renderSaveFooter()}>
      <SettingsGroup title="Coding Mode">
        <Section title="Coding mode" subtitle="Let a task pick its own agent per task — including launching in an external coding CLI (e.g. Claude Code) instead of the in-app chat, when one is installed.">
          <Switch
            checked={settings.codingModeEnabled ?? false}
            onCheckedChange={(v) => setSetting('codingModeEnabled', v)}
            aria-label="Coding mode"
          />
        </Section>
      </SettingsGroup>

      <SettingsGroup title="Available Agents">
        {/* No Switch here — Anton is the default agent and can't be
            turned off; a picker with every harness disabled would
            have nothing to run. Still listed so it's clear it's
            part of the picker. */}
        <Section title="Anton">
          <Badge variant="muted" size="xs" className="uppercase tracking-[0.04em]">Always on</Badge>
        </Section>
        {(settings.harnessOptions || []).includes('hermes') && (
          <Section title="Hermes">
            <Switch
              checked={settings.harnessHermesEnabled ?? true}
              onCheckedChange={(v) => setSetting('harnessHermesEnabled', v)}
              disabled={!settings.codingModeEnabled}
              aria-label="Enable Hermes in the harness picker"
            />
          </Section>
        )}
        <Section title="Claude-Code">
          <Switch
            checked={settings.harnessClaudeCodeEnabled ?? true}
            onCheckedChange={(v) => setSetting('harnessClaudeCodeEnabled', v)}
            disabled={!settings.codingModeEnabled}
            aria-label="Enable Claude-Code in the harness picker"
          />
        </Section>
      </SettingsGroup>
    </SettingsSectionPanel>
  );

  const renderAppearanceSection = () => (
    // No Save footer here — every control on this page auto-saves itself
    // (see autoSaveSetting/AutoSaveTag below); a page-wide Save button would
    // be dead weight that always reads "Saved" and never does anything.
    // `autoSaved` surfaces a quiet "saves automatically" note on mobile so the
    // page doesn't read as "no way to save" next to Save-button sections.
    <SettingsSectionPanel autoSaved>
      <SettingsGroup title="Appearance">
        <Section title="Style" subtitle="Normal, 8-Bit, or design your own with Custom. Combines with light and dark.">
          <ToggleGroup
            value={normalizeSkin(skin)}
            onValueChange={(v) => onSkinChange?.(v)}
            aria-label="Style"
            options={SKINS.map((s) => ({
              value: s.id,
              label: s.icon && Ico[s.icon]
                ? (<span className="inline-flex items-center gap-1.5">{Ico[s.icon](13)} {s.label}</span>)
                : s.label,
              'aria-label': `${s.label} style`,
              title: s.title,
            }))}
          />
        </Section>
        <Section title="Theme" subtitle="Light or dark — also drives the animated background.">
          <ToggleGroup
            value={theme || 'dark'}
            onValueChange={(v) => onThemeChange?.(v)}
            aria-label="Theme"
            options={[
              {
                value: 'light',
                label: (<span className="inline-flex items-center gap-1.5">{Ico.sun(13)} Light</span>),
                'aria-label': 'Light theme',
                title: 'Use the light theme.',
              },
              {
                value: 'dark',
                label: (<span className="inline-flex items-center gap-1.5">{Ico.moon(13)} Dark</span>),
                'aria-label': 'Dark theme',
                title: 'Use the dark theme.',
              },
            ]}
          />
        </Section>
        {normalizeSkin(skin) === 'custom' && customTheme && (
          <>
            <Section title="Accent color" subtitle="Buttons, highlights, focus — the brand color of your theme.">
              <input
                type="color"
                value={customTheme.accent}
                onChange={(e) => onCustomThemeChange?.({ ...customTheme, accent: e.target.value })}
                aria-label="Custom accent color"
                className={COLOR_SWATCH_INPUT}
              />
            </Section>
            <Section title="Background — Light mode" subtitle="Pick a base color for Light — surfaces and text shades derive from it — or use Light's default.">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={customTheme.bgLight || '#fafafa'}
                  onChange={(e) => onCustomThemeChange?.({ ...customTheme, bgLight: e.target.value })}
                  disabled={customTheme.bgLight === null}
                  aria-label="Custom background color — Light mode"
                  className={COLOR_SWATCH_INPUT}
                  style={{ opacity: customTheme.bgLight === null ? 0.45 : 1 }}
                />
                <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
                  <Checkbox
                    checked={customTheme.bgLight === null}
                    onCheckedChange={(v) => onCustomThemeChange?.({ ...customTheme, bgLight: v ? null : '#fafafa' })}
                    aria-label="Default Light background"
                  />
                  Default
                </label>
              </div>
            </Section>
            <Section title="Background — Dark mode" subtitle="Pick a base color for Dark — surfaces and text shades derive from it — or use Dark's default.">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={customTheme.bgDark || '#080d18'}
                  onChange={(e) => onCustomThemeChange?.({ ...customTheme, bgDark: e.target.value })}
                  disabled={customTheme.bgDark === null}
                  aria-label="Custom background color — Dark mode"
                  className={COLOR_SWATCH_INPUT}
                  style={{ opacity: customTheme.bgDark === null ? 0.45 : 1 }}
                />
                <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
                  <Checkbox
                    checked={customTheme.bgDark === null}
                    onCheckedChange={(v) => onCustomThemeChange?.({ ...customTheme, bgDark: v ? null : '#080d18' })}
                    aria-label="Default Dark background"
                  />
                  Default
                </label>
              </div>
            </Section>
            <Section title="Corners" subtitle="How sharp the surfaces feel.">
              <ToggleGroup
                value={String(customTheme.radius)}
                onValueChange={(v) => onCustomThemeChange?.({ ...customTheme, radius: Number(v) })}
                aria-label="Corner radius"
                options={[
                  { value: '0', label: 'Square', 'aria-label': 'Square corners', title: 'Sharp pixel corners.' },
                  { value: '6', label: 'Soft', 'aria-label': 'Soft corners', title: 'Gently rounded.' },
                  { value: '12', label: 'Round', 'aria-label': 'Round corners', title: 'Fully rounded.' },
                ]}
              />
            </Section>
            <Section title="Typeface" subtitle="Standard UI font, or mono everywhere for the terminal feel.">
              <ToggleGroup
                value={customTheme.font}
                onValueChange={(v) => onCustomThemeChange?.({ ...customTheme, font: v })}
                aria-label="Custom typeface"
                options={[
                  { value: 'standard', label: 'Standard', 'aria-label': 'Standard font', title: 'Inter for UI text.' },
                  { value: 'mono', label: 'Mono', 'aria-label': 'Mono font', title: 'JetBrains Mono everywhere.' },
                ]}
              />
            </Section>
            <Section title="Scanlines" subtitle="A faint CRT scanline overlay across the app.">
              <Switch
                checked={customTheme.scanlines}
                onCheckedChange={(v) => onCustomThemeChange?.({ ...customTheme, scanlines: v })}
                aria-label="Scanline overlay"
              />
            </Section>
          </>
        )}
        <Section title="Greeting" subtitle="The line shown when you start a new task.">
          <div className="flex items-center gap-1">
            <div className="flex-1">
              <TextInput
                value={settings.greeting}
                onChange={(v) => autoSaveSetting('greeting', v, { debounceMs: 600 })}
                title="Shown above the task input when you start a new task."
                ariaLabel="Greeting text"
              />
            </div>
            <AutoSaveTag settingKey="greeting" />
          </div>
        </Section>
        <Section title="Sidebar title" subtitle="Shown at the top of the left-hand nav panel. Leave blank for the default, MindsHub.">
          <div className="flex items-center gap-1">
            <div className="flex-1">
              <TextInput
                value={settings.navTitle || ''}
                onChange={(v) => autoSaveSetting('navTitle', v, { debounceMs: 600 })}
                placeholder="MindsHub"
                title="Replaces the MindsHub wordmark in the nav panel."
                ariaLabel="Sidebar title text"
              />
            </div>
            <AutoSaveTag settingKey="navTitle" />
          </div>
        </Section>
        <Section title="Sidebar title color" subtitle="Pick a color for the sidebar title, or follow the theme's default text color.">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={settings.navTitleColor || '#e8e8ec'}
              onChange={(e) => autoSaveSetting('navTitleColor', e.target.value, { debounceMs: 400 })}
              disabled={!settings.navTitleColor}
              aria-label="Sidebar title color"
              className={COLOR_SWATCH_INPUT}
              style={{ opacity: settings.navTitleColor ? 1 : 0.45 }}
            />
            <label className="inline-flex items-center gap-2 text-sm text-ink-3 cursor-pointer">
              <Checkbox
                checked={!settings.navTitleColor}
                onCheckedChange={(v) => autoSaveSetting('navTitleColor', v ? '' : '#e8e8ec')}
                aria-label="Follow theme color"
              />
              Follow theme
            </label>
            <AutoSaveTag settingKey="navTitleColor" />
          </div>
        </Section>
        <Section title="Sidebar logo" subtitle="An icon shown next to the sidebar title. PNG, JPG, or SVG, under 300 KB.">
          <div className="flex items-center gap-3">
            {settings.navLogo && (
              <img
                src={settings.navLogo}
                alt=""
                className="w-8 h-8 object-contain rounded-md border border-solid border-line-2 bg-surface"
              />
            )}
            <Button
              variant="subtle"
              onClick={() => logoInputRef.current?.click()}
            >
              {settings.navLogo ? 'Change logo' : 'Upload logo'}
            </Button>
            {settings.navLogo && (
              <Button
                variant="danger"
                onClick={() => { autoSaveSetting('navLogo', ''); setLogoError(null); }}
              >
                {Ico.trash(13)}
                Remove
              </Button>
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={(e) => { handleLogoUpload(e.target.files?.[0]); e.target.value = ''; }}
            />
            <AutoSaveTag settingKey="navLogo" />
          </div>
          {logoError && (
            <div className="text-[12px] text-danger mt-1.5">{logoError}</div>
          )}
        </Section>
        <div className="settings-hide-mobile">
          <Section title="Animated background" subtitle="Off by default. Toggle on for an animated dot-grid behind the app instead of a flat surface.">
            <div className="flex items-center">
              <Switch
                checked={settings.showDots}
                onCheckedChange={(v) => autoSaveSetting('showDots', v)}
                aria-label="Animated background"
              />
              <AutoSaveTag settingKey="showDots" />
            </div>
          </Section>
          <Section title="Show nav-panel counters" subtitle="Badge counts on Projects / Scheduled / Artifacts / Connected apps, plus the time-since label on each Recent row.">
            <div className="flex items-center">
              <Switch
                checked={settings.showCounters !== false}
                onCheckedChange={(v) => autoSaveSetting('showCounters', v)}
                aria-label="Nav-panel counters"
              />
              <AutoSaveTag settingKey="showCounters" />
            </div>
          </Section>
          <Section title="Theme toggle button" subtitle="The light/dark button in the sidebar footer.">
            <div className="flex items-center">
              <Switch
                checked={settings.showThemeToggle !== false}
                onCheckedChange={(v) => autoSaveSetting('showThemeToggle', v)}
                aria-label="Theme toggle button"
              />
              <AutoSaveTag settingKey="showThemeToggle" />
            </div>
          </Section>
          <Section title="8-bit style toggle button" subtitle="The gamepad button in the sidebar footer that switches to 8-Bit Arcade style.">
            <div className="flex items-center">
              <Switch
                checked={settings.show8bitToggle !== false}
                onCheckedChange={(v) => autoSaveSetting('show8bitToggle', v)}
                aria-label="8-bit style toggle button"
              />
              <AutoSaveTag settingKey="show8bitToggle" />
            </div>
          </Section>
          {host.codingModeOptionsEnabled && (
            <Section title="Coding mode toggle button" subtitle="The floating </> button next to the theme toggle that switches Coding mode on/off.">
              <div className="flex items-center">
                <Switch
                  checked={settings.showCodingModeToggle !== false}
                  onCheckedChange={(v) => autoSaveSetting('showCodingModeToggle', v)}
                  aria-label="Coding mode toggle button"
                />
                <AutoSaveTag settingKey="showCodingModeToggle" />
              </div>
            </Section>
          )}
        </div>
      </SettingsGroup>
    </SettingsSectionPanel>
  );

  const renderChannelsSection = () => (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <ChannelsView />
    </div>
  );

  const renderUpdatesSection = () => (
    <UpdatesSection
      footer={renderSaveFooter()}
      serverOnline={serverOnline}
      shellUpdate={shellUpdate}
      onDownloadShellUpdate={onDownloadShellUpdate}
      shellAutoUpdate={shellAutoUpdate}
      onDownloadShellAutoUpdate={onDownloadShellAutoUpdate}
      onInstallShellAutoUpdate={onInstallShellAutoUpdate}
      onRetryShellAutoUpdate={onRetryShellAutoUpdate}
    />
  );

  const renderBackendSection = () => (
    <BackendSection
      serverOnline={serverOnline}
      serverBusy={serverBusy}
      serverBusyKind={serverBusyKind}
      onStartServer={onStartServer}
      onStopServer={onStopServer}
    />
  );

  const renderAccountSection = () => (
    <AccountSection
      isSsoConnected={isSsoConnected}
      ssoError={ssoError}
      onSsoSignIn={onSsoSignIn}
    />
  );


  // Mobile (ENG-990): master-detail. The surface is a list of the six
  // sections; tapping one drills into a focused full-screen page for just
  // that section (sub-groups render flat — see SettingsGroup — and no longer
  // collapse on either platform). The top-bar back control returns to the list; from
  // the list it closes Settings (onClose). Only the open section mounts, so
  // its effects/dropdowns don't all run at once.
  if (mobile) {
    const renderers = {
      agent: renderAgentSection,
      codingMode: renderCodingModeSection,
      appearance: renderAppearanceSection,
      channels: renderChannelsSection,
      updates: renderUpdatesSection,
      backend: renderBackendSection,
      account: renderAccountSection,
    };
    const activeItem = navItemsForHost(host.isWeb, host.codingModeOptionsEnabled).find((i) => i.id === section) || null;
    const inDetail = Boolean(activeItem);
    return (
      <SettingsLayoutContext.Provider value={{ mobile: true }}>
        <header className="settings-mobile__top">
          <button
            type="button"
            className="settings-mobile__back"
            aria-label={inDetail ? 'Back to settings' : 'Close settings'}
            onClick={() => (inDetail ? onSectionChange?.(null) : onClose?.())}
          >
            {Ico.chevLeft(22)}
          </button>
          <div className="settings-mobile__title" id="settings-mobile-title">
            {activeItem ? activeItem.label : 'Settings'}
          </div>
          <span className="settings-mobile__spacer" aria-hidden="true" />
        </header>
        <div className="settings-mobile__body scroll-clean">
          {inDetail ? (
            <div className="settings-detail">
              {renderers[section]?.()}
            </div>
          ) : (
            <nav className="settings-list" role="navigation" aria-label="Settings sections">
              {navItemsForHost(host.isWeb, host.codingModeOptionsEnabled).map((item) => {
                // `!host.isWeb &&`: the offline-disable exists because a dead local
                // server can't accept a save, and Backend stays enabled as the
                // escape hatch to restart it. On web there is no Backend row —
                // and `serverOnline` DOES go false there: refreshData() polls
                // /health on mount on both platforms (App.jsx), so a transient
                // failure on hosted (proxy 502, auth blip) would otherwise
                // disable EVERY row with no way out.
                const disabled = !host.isWeb && !serverOnline && item.id !== 'backend';
                const icon = Ico[item.icon] ? Ico[item.icon](18) : null;
                return (
                  <div className="mshell-accordion" key={item.id}>
                    <button
                      type="button"
                      className="mshell-accordion__head"
                      aria-disabled={disabled || undefined}
                      disabled={disabled}
                      onClick={() => onSectionChange?.(item.id)}
                      style={disabled ? { opacity: 0.4, cursor: 'default' } : undefined}
                    >
                      {icon && (
                        <span aria-hidden="true" className="inline-flex shrink-0 text-ink-3">
                          {icon}
                        </span>
                      )}
                      <span className="mshell-accordion__label">{item.label}</span>
                      <span className="mshell-accordion__chev">{Ico.chevronRight(16)}</span>
                    </button>
                  </div>
                );
              })}
            </nav>
          )}
        </div>
      </SettingsLayoutContext.Provider>
    );
  }

  // Hiding a nav row isn't enough on its own — `navigate('settings:backend')`
  // sets the section directly, so a deep link (or a stale persisted section)
  // could still render one this host doesn't offer. Resolve through the visible
  // set and fall back to its first entry (Agent).
  const visibleNav = navItemsForHost(host.isWeb, host.codingModeOptionsEnabled);
  const effectiveSection = visibleNav.some((i) => i.id === section)
    ? section
    : visibleNav[0]?.id;

  return (
    <div className="flex-1 flex flex-row min-h-0">
      <SettingsNav section={effectiveSection} onSectionChange={onSectionChange} serverOnline={serverOnline} />

      {effectiveSection === 'agent' && renderAgentSection()}
      {effectiveSection === 'codingMode' && renderCodingModeSection()}
      {effectiveSection === 'appearance' && renderAppearanceSection()}
      {effectiveSection === 'channels' && renderChannelsSection()}
      {effectiveSection === 'updates' && renderUpdatesSection()}
      {effectiveSection === 'backend' && renderBackendSection()}
      {effectiveSection === 'account' && renderAccountSection()}
    </div>
  );
}
