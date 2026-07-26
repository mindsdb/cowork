import { useState, useEffect, useRef, createContext, useContext, Children } from 'react';
import { useId } from 'react';
import Ico from '../components/Icons';
import { validateSettings, revealSettingKey, testProviders, fetchHealth, fetchRecommendedModels } from '../api';
import { providerTypeToKeyField, providerValueToType, resolveModelPickerValue, buildModelOptions, effectiveRoleModel, effectiveRoleProvider, mergeRecommendedModels } from '../lib/settingsTransform';
import { trackHarnessSwapped, resetDeviceIdentity } from '../lib/analytics';
import { ConfirmModal } from '../components/ConfirmModal';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { Switch } from '../components/ui/Switch';
import { Badge, Button, Input, Checkbox, Select } from '../components/ui';
import { host } from '../../platform/host';
import { SKINS, normalizeSkin } from '../../lib/skins';
import { MINDS_API_BASE, MINDS_API_KEY_URL, MINDS_CONSOLE_URL, MINDS_REGISTER_URL, MINDS_BILLING_URL } from '../../lib/mindsUrls';
import { getVersionInfo, isElectron, getAccessToken } from '../../platform/host';
import { unifiedVersion, SKEW_WARN_DAYS } from '../../../shared/version';
import { backendFailureCopy, exitCodeLabel } from '../../../shared/server-status';
import ChannelsView from './ChannelsView';

function decodeJwtPayload(token) {
  try {
    let payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    return JSON.parse(atob(payload));
  } catch { return null; }
}

// Exported for tests. Pure mapping from an access token to the account
// card's user object; null means "show the sign-in card" — both for a
// missing token and for one that can't be decoded (a stale identity must
// never keep rendering over a token we can no longer read, ENG-761).
export function accountUserFromToken(token) {
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return {
    name: payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' ') || null,
    email: payload.email || null,
    username: payload.preferred_username || null,
    sub: payload.sub || null,
    org: (() => {
      let org = payload.active_organization ?? payload.organization;
      if (typeof org === 'string') { try { org = JSON.parse(org); } catch { return null; } }
      return org?.displayName || org?.name || null;
    })(),
  };
}

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

function Section({ title, subtitle, notice, children }) {
  const { mobile } = useContext(SettingsLayoutContext);
  // A section whose sole control is a Switch or ToggleGroup is compact enough
  // to keep the desktop "title left / control right" row on wider mobile
  // widths instead of stacking (ENG-990). Full-width controls — text inputs,
  // selects, color pickers, the generic field wrapper — stay stacked. The
  // row only re-forms above ~440px (see the media query); the narrowest
  // phones still stack everything.
  const kids = Children.toArray(children);
  const compact = kids.length === 1 && (kids[0]?.type === Switch || kids[0]?.type === ToggleGroup);
  return (
    <div className={`settings-section${compact ? ' settings-section--inline' : ''}`} style={{
      display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0,
      padding: '16px 0',
      alignItems: 'flex-start',
    }}>
      {/* On mobile the grid collapses to one column (see the settings media
          query), so the inter-column gutters (paddingRight/Left: 24) would
          just indent the stacked label + control for no reason — drop them. */}
      <div style={{ paddingRight: mobile ? 0 : 24 }}>
        <h3 style={{
          margin: 0, padding: 0,
          fontSize: 14, fontWeight: 600, color: 'var(--text-strong)',
          fontFamily: 'inherit', lineHeight: 1.3,
        }}>{title}</h3>
        {subtitle && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>{subtitle}</div>}
        {notice && <div style={{ marginTop: 8 }}>{notice}</div>}
      </div>
      <div style={{ paddingLeft: mobile ? 0 : 24 }}>{children}</div>
    </div>
  );
}

// Collapsible group of sections. Defaults to open; click the header to
// toggle. Uses the theme tokens so it reads well in light + dark.
function CollapsibleGroup({ title, defaultOpen = true, children }) {
  const { mobile } = useContext(SettingsLayoutContext);
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const headingId = useId();
  // Mobile (ENG-990): flat and non-collapsible. The master-detail screen
  // already isolates one section, so a second collapse level just adds
  // confusion — render the group title as a plain header with its content
  // always visible, separated from the next group by spacing.
  if (mobile) {
    return (
      <div style={{ marginBottom: 6 }}>
        <h2 style={{
          margin: 0, padding: '12px 2px 8px',
          fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>{title}</h2>
        <div style={{ padding: '0 2px 4px' }}>{children}</div>
      </div>
    );
  }

  return (
    <div style={{
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--card-radius)',
      background: 'var(--surface-glass)',
      WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
      backdropFilter: 'blur(var(--surface-glass-blur))',
      marginBottom: 14,
      overflow: 'hidden',
    }}>
      {/* W3C "Accordion" pattern: heading wraps the toggle button so the
          group surfaces in SR heading navigation, while the button still
          owns interaction. h3 margin reset to keep the visual layout. */}
      <h2 id={headingId} style={{ margin: 0, padding: 0, fontWeight: 'inherit', fontSize: 'inherit' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '14px 18px', background: 'transparent', border: 0,
            fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600,
            letterSpacing: '0.04em', textTransform: 'uppercase',
            color: 'var(--text-muted)', cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span aria-hidden="true" style={{
            display: 'inline-flex', width: 14, height: 14,
            color: 'var(--text-muted)',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 180ms cubic-bezier(0.32, 0.72, 0, 1)',
          }}>{Ico.chevronRight ? Ico.chevronRight(12) : '›'}</span>
          <span style={{ flex: 1 }}>{title}</span>
        </button>
      </h2>
      {open && (
        <div id={panelId} role="region" aria-labelledby={headingId} style={{ padding: '0 18px 8px' }}>{children}</div>
      )}
    </div>
  );
}

// Shared layout shell for every settings section: scrollable content area
// on top, optional sticky footer with action buttons on the bottom.
// Pass `footer` as JSX — buttons, status text, whatever the section needs.
// Layout mode for the settings surface. Desktop (default) renders the
// two-column nav + scrolling panel inside a modal; mobile (ENG-990) renders
// a full page with accordion navigation, where each section flows naturally
// so the whole page scrolls. SettingsSectionPanel reads this to drop its
// flex-fill / internal scroll / sticky footer on mobile.
const SettingsLayoutContext = createContext({ mobile: false });

function SettingsSectionPanel({ children, footer, autoSaved = false }) {
  const { mobile } = useContext(SettingsLayoutContext);
  if (mobile) {
    // Natural flow so the whole detail page scrolls (no internal scroll or
    // width cap). A sticky full-bleed bottom bar carries the action: the Save
    // footer when the section has one (always reachable on a long page instead
    // of buried at the end), or a quiet "saves automatically" note when it
    // doesn't — so an auto-save section (Appearance) doesn't read as "no way
    // to save" next to sections with a Save button (ENG-990 QA).
    const barStyle = {
      position: 'sticky',
      bottom: 0,
      zIndex: 1,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      // Bleed past the .settings-detail 14px gutter to the screen edges.
      margin: '16px -14px 0',
      padding: '12px 14px calc(12px + env(safe-area-inset-bottom, 0))',
      borderTop: '1px solid var(--border-subtle)',
      // Opaque so scrolling content is masked behind the bar.
      background: 'var(--bg)',
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div>{children}</div>
        {footer ? (
          <div style={{ ...barStyle, gap: 10 }}>{footer}</div>
        ) : autoSaved ? (
          <div style={{ ...barStyle, color: 'var(--text-muted)', fontSize: 12.5 }}>
            <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--ok, #3aa876)' }}>
              {Ico.check ? Ico.check(13) : '✓'}
            </span>
            <span>Changes are saved automatically.</span>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div
        className="scroll-clean settings-scroll"
        style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}
      >
        <div style={{ maxWidth: 820 }}>{children}</div>
      </div>
      {footer && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 22px',
          background: 'var(--surface-glass)',
          WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
          backdropFilter: 'blur(var(--surface-glass-blur))',
          borderTop: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          {footer}
        </div>
      )}
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
    <div style={{ position: 'relative' }}>
      <Input
        value={v}
        onChange={(next) => onChange(next)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        style={hasValue ? { paddingRight: 36 } : undefined}
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="Clear (commits on Save settings)"
          aria-label="Clear value"
          style={{
            position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 26, borderRadius: 6,
            border: 0, background: 'transparent', cursor: 'pointer',
            color: 'var(--ink-3)', padding: 0,
          }}
        >
          {Ico.close(13)}
        </button>
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
function ApiKeyInput({ value, onChange, placeholder, disabled, revealName }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
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
    try {
      await navigator.clipboard.writeText(v);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable in some browser sandboxes */
    }
  };

  const onToggleShow = async () => {
    if (!show && revealName && isSentinel && revealedValue === null) {
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

  const btnStyle = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 26, borderRadius: 6,
    border: 0, background: 'transparent', cursor: 'pointer',
    color: 'var(--ink-3)', padding: 0,
  };
  const btnStyleActive = { ...btnStyle, color: 'var(--text-strong)', background: 'var(--surface-2, rgba(255,255,255,0.04))' };

  // When the field is holding the server sentinel and the user hasn't
  // toggled reveal, render the input as empty + a long bullet placeholder.
  // The literal "***" rendered as type=password is only 3 dots wide, which
  // looks like an almost-empty field rather than "a stored key is here."
  // Typing replaces the (empty) value cleanly — no asterisk contamination.
  const showSentinelAsMask = !show && v === '***';

  return (
    <div style={{ position: 'relative' }}>
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
      <div style={{
        position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
        display: 'inline-flex', alignItems: 'center', gap: 2,
      }}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            onClick={onCopy}
            disabled={!canCopy}
            title={
              isDisplayingSentinel ? 'Reveal the key first to copy it'
                : copied ? 'Copied'
                  : 'Copy to clipboard'
            }
            aria-label={copied ? 'Copied to clipboard' : 'Copy key to clipboard'}
            style={canCopy ? btnStyle : { ...btnStyle, opacity: 0.35, cursor: 'not-allowed' }}
          >
            {copied ? Ico.check(13) : Ico.copy(13)}
          </button>
          {copied && (
            <span
              role="status"
              aria-live="polite"
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 6px)',
                left: '50%',
                padding: '3px 8px',
                fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: '#7CC4B6',
                background: 'rgba(20,28,28,0.92)',
                border: '1px solid rgba(124,196,182,0.45)',
                borderRadius: 6,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                boxShadow: 'var(--sh-2)',
                animation: 'copied-pop 1.5s ease forwards',
                zIndex: 5,
              }}
            >Copied</span>
          )}
        </span>
        <button
          type="button"
          onClick={onToggleShow}
          disabled={revealing}
          title={show ? 'Hide key' : (revealing ? 'Revealing…' : 'Reveal key')}
          aria-label={show ? 'Hide key' : 'Reveal key'}
          aria-pressed={show}
          style={show ? btnStyleActive : btnStyle}
        >
          {show ? Ico.eyeOff(13) : Ico.eye(13)}
        </button>
        <button
          type="button"
          onClick={onClearField}
          disabled={!hasValue}
          title="Clear this key (commits on Save settings)"
          aria-label="Clear key"
          style={hasValue ? btnStyle : { ...btnStyle, opacity: 0.35, cursor: 'not-allowed' }}
        >
          {Ico.close(13)}
        </button>
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
      icon={<span aria-hidden style={{
        width: 6, height: 6, borderRadius: 999,
        background: 'currentColor',
        boxShadow: active
          ? '0 0 8px currentColor, 0 0 14px rgba(124,196,182,0.6)'
          : '0 0 4px rgba(93,146,135,0.45)',
      }} />}
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

// How long data from the model dropdown's on-open refresh counts as fresh.
// Re-opening inside this window skips the round trip and opens immediately;
// it only has to be short next to the 5-minute cache it stands in for.
const MODEL_REFRESH_TTL_MS = 5000;

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
    <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 4 }}>
      {title}
      <RelevanceBadge status={status} />
      <SetBadge hasValue={hasValue} active={setActive} />
    </span>
  );
  return (
    <div style={{ opacity: dimmed ? 0.5 : 1, transition: 'opacity .15s ease' }}>
      <Section title={titleNode} subtitle={subtitle}>{children}</Section>
    </div>
  );
}

// ───────────────────────── Nav sidebar ─────────────────────────

const NAV_ITEMS = [
  { id: 'agent', label: 'Agent', icon: 'robot' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'channels', label: 'Channels', icon: 'chats' },
  { id: 'updates', label: 'Updates', icon: 'refresh' },
  { id: 'backend', label: 'Backend', icon: 'database' },
  { id: 'account', label: 'Account', icon: 'people' },
];

function SettingsNav({ section, onSectionChange, serverOnline = true }) {
  return (
    <nav
      role="navigation"
      aria-label="Settings sections"
      style={{
        width: 180,
        flexShrink: 0,
        borderRight: '1px solid var(--line)',
        padding: '20px 10px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div style={{
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--ink-4)',
        padding: '0 10px 6px',
        fontWeight: 600,
      }}>Settings</div>
      {NAV_ITEMS.map((item) => {
        const active = section === item.id;
        const disabled = !serverOnline && item.id !== 'backend';
        const icon = Ico[item.icon] ? Ico[item.icon](15) : null;
        return (
          <button
            key={item.id}
            type="button"
            onClick={disabled ? undefined : () => onSectionChange?.(item.id)}
            aria-current={active ? 'page' : undefined}
            aria-disabled={disabled ? 'true' : undefined}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              opacity: disabled ? 0.35 : 1,
              pointerEvents: disabled ? 'none' : 'auto',
              cursor: disabled ? 'default' : 'pointer',
              borderRadius: 7,
              border: 0,
              background: active ? 'var(--surface-2)' : 'transparent',
              color: active ? 'var(--ink)' : 'var(--ink-3)',
              fontWeight: active ? 600 : 400,
              fontSize: 13,
              fontFamily: 'inherit',
              textAlign: 'left',
              transition: 'background 120ms ease, color 120ms ease',
            }}
            onMouseEnter={(e) => {
              if (!active && !disabled) {
                e.currentTarget.style.background = 'var(--surface-2, rgba(127,127,127,0.07))';
                e.currentTarget.style.color = 'var(--ink)';
              }
            }}
            onMouseLeave={(e) => {
              if (!active && !disabled) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--ink-3)';
              }
            }}
          >
            {icon && (
              <span aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0, color: 'inherit' }}>
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
}) {
  const [saved, setSaved] = useState(false);
  const [validation, setValidation] = useState(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Per-role "use a typed model id" flag. Sticky so picking Other…
  // keeps the text input visible even when the typed value is empty.
  const [modelInputMode, setModelInputMode] = useState({ planning: false, coding: false });
  // Per-role "refetching model list on dropdown open" flag — drives the
  // trigger's spinner so a still-open dropdown showing possibly-stale
  // locked/unlocked state doesn't read as done loading.
  const [modelRefreshing, setModelRefreshing] = useState({ planning: false, coding: false, router: false });
  // Per-role note of when the refresh above last landed fresh data, so
  // re-opening the dropdown doesn't re-pay a round trip that just completed.
  const modelOpenState = useRef({});
  const modelOpenFor = (role) => (modelOpenState.current[role] ||= { refreshedAt: 0 });
  const [versionInfo, setVersionInfo] = useState({ app: '', ui: null, source: 'web' });
  const [serverVersion, setServerVersion] = useState('');
  const [antonVersion, setAntonVersion] = useState('');
  const [showVersionDetails, setShowVersionDetails] = useState(false);
  const [versionCopied, setVersionCopied] = useState(false);
  // Whether the refresh token lives in the macOS keychain (vs a file under
  // ~/.cowork). Mac-only; read from main on mount.
  const [keychainPref, setKeychainPref] = useState(false);
  // Backend section diagnostics state
  const [diag, setDiag] = useState(null);
  const [diagBusy, setDiagBusy] = useState(false);
  // Account section — decoded from the JWT, null until loaded
  const [accountUser, setAccountUser] = useState(null);
  // Mobile master-detail (ENG-990/ENG-991): the open section is the shared
  // `section` prop, not a separate local state — so a deep-link
  // (onOpenSettings('backend')) lands on that section AND the section-keyed
  // load effects below fire on mobile too. `section == null` is the list; a
  // row tap calls onSectionChange(id), the back control onSectionChange(null).

  useEffect(() => { getVersionInfo().then(setVersionInfo).catch(() => { }); }, []);
  // Backend (server + agent) versions come from /health, which is only
  // reachable when the backend is up. Re-read whenever the Updates section is
  // shown and the backend is online, so versions populate after a cold open or
  // a start/restart from the Backend section instead of staying blank at mount.
  useEffect(() => {
    if (section !== 'updates' || !serverOnline) return undefined;
    let cancelled = false;
    fetchHealth().then((h) => {
      if (cancelled) return;
      setServerVersion(h?.server_version || '');
      setAntonVersion(h?.anton_version || '');
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [section, serverOnline]);
  useEffect(() => { if (host.isElectron && host.isMac()) host.getKeychainPref().then(setKeychainPref).catch(() => { }); }, []);
  // Re-runs when the signed-in state flips (ENG-761): previously deps
  // were [section] only, so signing in while this section was already
  // open never re-read the token — the card stayed on "Sign in". The
  // cancelled guard matches the sibling effects: getAccessToken can ride
  // a slow network refresh, and a stale resolution must not overwrite
  // what a newer run painted.
  useEffect(() => {
    if (section !== 'account') return undefined;
    let cancelled = false;
    getAccessToken().then((token) => {
      if (!cancelled) setAccountUser(accountUserFromToken(token));
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [section, isSsoConnected]);

  // Load diagnostics when Backend section is active
  useEffect(() => {
    if (section !== 'backend') return;
    let cancelled = false;
    (async () => {
      try {
        const data = await host.serverDiagnostics();
        if (!cancelled) setDiag(data || null);
      } catch {
        if (!cancelled) setDiag(null);
      }
    })();
    return () => { cancelled = true; };
  }, [section]);

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
    const nextModel = model || '';
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

    // Role settings referencing the removed provider get re-pointed
    // at MindsHub with its recommended pair for the role.
    const adjustedOverrides = {};
    for (const role of ['planning', 'coding', 'router']) {
      const o = roleOverride(role);
      if (roleProviderType(role) === type) {
        const pair = recommendedPair['minds-cloud'] || ['', '', ''];
        const roleIdx = role === 'planning' ? 0 : role === 'router' ? 2 : 1;
        const fallback = pair[roleIdx] || pair[1] || (recommendedModels['minds-cloud']?.[0] || '');
        adjustedOverrides[role] = { providerType: 'minds-cloud', model: fallback };
        setRoleDriver(role, 'minds-cloud', fallback);
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
    if (configured.length === 0) return;
    didMountVerify.current = true;
    runProviderTests(configured).catch(() => { });
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
    const pair = recommendedPair[type] || [];
    const next = { ...s };
    if ((providerValueToType(s.planningProvider) || 'minds-cloud') !== type) {
      next.planningProvider = type;
      next.planningModel = pair[0] || '';
      next.defaultModel = pair[0] || '';
    }
    if ((providerValueToType(s.codingProvider) || 'minds-cloud') !== type) {
      next.codingProvider = type;
      next.codingModel = pair[1] || '';
    }
    if ((providerValueToType(s.routerProvider) || 'minds-cloud') !== type) {
      next.routerProvider = type;
      next.routerModel = pair[2] || pair[1] || '';
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
      await onSave(withResolvedRoles(settings));
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
      ? (<><span style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}>{Ico.check(13)}</span>Tested</>)
      : 'Test';

  // Sign out: clears the persisted refresh token + every credential
  // in ~/.anton/.env (ANTON_TERMS_CONSENT and prefs stay), then
  // reloads so App.tsx re-routes the user to the onboarding flow.
  const handleLogout = async () => {
    if (loggingOut) return; // Guard against double-fire (Enter / re-click).
    setLoggingOut(true);
    try {
      await host.logout();
    } catch {
      // Swallow — partial logout is still worth recovering from on the
      // boot path, and the reload below puts us back through it.
    }
    // Rotate the analytics device identity so the next account on this machine
    // starts anonymous-fresh and merges cleanly (ENG-537).
    resetDeviceIdentity();
    // Exactly ONE reload must happen, or the two compete and leave the
    // page stuck on this confirm modal (flaky in packaged builds). On
    // Electron the main process drives webContents.reload() itself
    // after the IPC reply — that's the reliable path, so the renderer
    // must NOT also reload. On web there's no main process, so we
    // reload here.
    if (host.isWeb) {
      window.location.reload();
    }
  };

  // ───────────────────────── Backend section helpers ─────────────────────────

  const refreshDiag = async () => {
    try {
      const data = await host.serverDiagnostics();
      setDiag(data || null);
    } catch { }
  };

  const handleBackendStart = async () => {
    if (!onStartServer) return;
    setDiagBusy(true);
    try {
      await onStartServer();
      await refreshDiag();
    } finally {
      setDiagBusy(false);
    }
  };

  const handleBackendStop = async () => {
    if (!onStopServer) return;
    setDiagBusy(true);
    try {
      await onStopServer();
      await refreshDiag();
    } finally {
      setDiagBusy(false);
    }
  };

  const handleBackendRestart = async () => {
    setDiagBusy(true);
    try {
      if (onStopServer && onStartServer) {
        await onStopServer();
        await onStartServer();
      }
      await refreshDiag();
    } finally {
      setDiagBusy(false);
    }
  };

  // ───────────────────────── Shared footer/banner helpers ─────────────────────────

  const renderSaveFooter = () => (
    <>
      <div
        role="status" aria-live="polite" aria-atomic="true"
        style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        {testing && <span aria-hidden="true" className="spinner" style={{ width: 12, height: 12 }} />}
        {!testing && tested && configReady && <span aria-hidden="true" style={{ color: 'var(--sage-500, #5d9287)', display: 'inline-flex' }}>{Ico.check(13)}</span>}
        {!testing && saved && !tested && <span aria-hidden="true" style={{ color: 'var(--sage-500, #5d9287)', display: 'inline-flex' }}>{Ico.check(13)}</span>}
        <span>
          {testing ? 'Testing configuration…'
            : tested ? (configReady ? 'Test passed — provider, model, and credentials look good.' : (configError || 'Test reported a problem.'))
              : saved ? 'Settings saved.'
                : configError ? configError
                  : 'Changes apply on save.'}
        </span>
      </div>
      <Button
        variant="primary" onClick={save}
        disabled={(!settingsDirty && !anyProviderFailed) || testing || missingCustomNames}
        title={missingCustomNames ? 'Each custom provider needs a name' : testing ? 'Saving…' : (!settingsDirty && !anyProviderFailed) ? 'No unsaved changes' : anyProviderFailed ? 'Re-test failed providers.' : 'Save changes and re-run provider tests.'}
        style={{ width: 140, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: ((!settingsDirty && !anyProviderFailed) || testing || missingCustomNames) ? 0.55 : 1, cursor: ((!settingsDirty && !anyProviderFailed) || testing || missingCustomNames) ? 'default' : 'pointer' }}
      >
        {testing ? 'Saving…' : (settingsDirty || anyProviderFailed) ? 'Save settings' : <>{Ico.check(14)} Saved</>}
      </Button>
    </>
  );

  // ───────────────────────── Section renderers ─────────────────────────

  const renderAgentSection = () => {
    const anyProviderConfigured = providers.some(providerConfigured);
    return (
      <SettingsSectionPanel footer={renderSaveFooter()}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ order: anyProviderConfigured ? 2 : 0 }}>
            <CollapsibleGroup title="LLM Providers">
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
                const rawStatus = (settings.providerStatus || {})[p.type] || 'untested';
                const status = (p.type === 'minds-cloud' && isSsoConnected) ? 'ok' : configured ? rawStatus : 'untested';
                const detail = configured ? ((settings.providerStatusDetails || {})[p.type] || '') : '';
                const friendlyError = (() => {
                  if (!detail) return '';
                  if (detail === 'missing API key') return 'Add an API key on the right.';
                  if (detail === 'missing base URL') return 'Add a base URL on the right.';
                  const m = detail.match(/HTTP (\d{3})/);
                  if (m) {
                    const code = parseInt(m[1], 10);
                    if (code === 401) return 'Unauthorized — the API key was rejected.';
                    if (code === 403) return 'Forbidden — the API key does not have access.';
                    if (code === 404) return 'Endpoint not found — check the base URL.';
                    if (code === 429) return 'Rate limited — try again in a moment.';
                    if (code >= 500) return `Provider is currently unreachable (HTTP ${code}).`;
                    return `Provider rejected the request (HTTP ${code}).`;
                  }
                  if (detail.startsWith('ConnectError') || detail.startsWith('ConnectTimeout')) {
                    return 'Could not reach the provider — network or DNS problem.';
                  }
                  if (detail.startsWith('ReadTimeout') || detail.startsWith('TimeoutException')) {
                    return 'Provider did not respond in time.';
                  }
                  if (detail.startsWith('SSLError') || detail.includes('certificate')) {
                    return 'TLS / certificate problem reaching the provider.';
                  }
                  return detail;
                })();
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
                const headingBaseStyle = {
                  margin: 0, padding: 0, fontFamily: 'inherit', lineHeight: 1.3,
                  fontSize: 14, fontWeight: 600, color: 'var(--text-strong)',
                };
                const customHeadingText = p.type === 'openai-compatible'
                  ? ((p.name || '').trim() || 'Custom OpenAI-compatible provider')
                  : null;
                const titleNode = (
                  <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    {p.type === 'openai-compatible' ? (() => {
                      const nameEmpty = !(p.name || '').trim();
                      const errorId = `provider-name-error-${p.type}`;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
                              borderColor: nameEmpty ? 'rgba(224,112,96,0.55)' : undefined,
                            }}
                          />
                          {nameEmpty && (
                            <span id={errorId} style={{ fontSize: 10.5, color: '#E07060' }}>Name required</span>
                          )}
                        </div>
                      );
                    })() : (
                      <h3 style={headingBaseStyle}>{label}</h3>
                    )}
                  </span>
                );
                // Show the key input when: unconfigured, never tested, or user clicked Edit.
                // Otherwise the middle column shows the status pill and an Edit button appears.
                const ssoMindsHub = p.type === 'minds-cloud' && isSsoConnected;
                const showKeyInput = ssoMindsHub || !configured || status === 'untested' || status === 'fail' || editingProviders.has(p.type);
                return (
                  <div key={p.type} className="settings-provider-row" style={{
                    // Desktop: name | key/status | actions in a 3-col grid.
                    // Mobile: a compact left-aligned column — the grid stacked
                    // but kept the status pill + a 30px-wide button column
                    // right-aligned, floating them into a lot of dead space.
                    display: mobile ? 'flex' : 'grid',
                    flexDirection: mobile ? 'column' : undefined,
                    gridTemplateColumns: mobile ? undefined : '1fr 380px auto',
                    gap: mobile ? 10 : 24,
                    padding: '16px 0',
                    alignItems: 'flex-start',
                  }}>
                    {/* Left: name + description */}
                    <div>
                      {titleNode}
                      {PROVIDER_TYPE_DESC[p.type] && (
                        <div style={{
                          fontSize: 12, color: 'var(--text-muted)',
                          marginTop: 6, maxWidth: 380, lineHeight: 1.45,
                        }}>
                          {PROVIDER_TYPE_DESC[p.type]}
                        </div>
                      )}
                    </div>

                    {/* Middle: status pill (tested) OR key input (editing / untested) */}
                    {showKeyInput ? (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {ssoMindsHub ? (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: mobile ? 'flex-start' : 'flex-end', padding: '5px 0' }}>
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
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                            Get your API key at{' '}
                            <a
                              href={GET_KEY_URL[p.type]}
                              target="_blank"
                              rel="noreferrer noopener"
                              title={`Open ${GET_KEY_URL[p.type].replace(/^https?:\/\//, '')} in your browser.`}
                              style={{ color: 'var(--accent-500, #7CC4B6)' }}
                            >{GET_KEY_URL[p.type].replace(/^https?:\/\//, '')} →</a>
                          </div>
                        )}
                        {p.type === 'minds-cloud' && !isSsoConnected && (
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                            Don't have an account?{' '}
                            <a
                              href={MINDS_REGISTER_URL}
                              target="_blank"
                              rel="noreferrer noopener"
                              title="Open the MindsHub sign-up page in your browser."
                              style={{ color: 'var(--accent-500, #7CC4B6)' }}
                            >Sign up →</a>
                          </div>
                        )}
                        {status === 'fail' && friendlyError && (
                          <div style={{ fontSize: 11.5, color: '#E07060', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{ flexShrink: 0, marginTop: 1 }}>{Ico.key ? Ico.key(11) : '!'}</span>
                            <span>{friendlyError}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      // Status pill replaces the key input after a test result
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: mobile ? 'flex-start' : 'flex-end', padding: '5px 0', gap: 10 }}>
                        {status === 'fail' && friendlyError && (
                          <span style={{ fontSize: 11.5, color: '#E07060' }}>{friendlyError}</span>
                        )}
                        {statusPill}
                      </div>
                    )}

                    {/* Right (desktop) / inline row (mobile): trash + edit */}
                    <div style={{ display: 'flex', flexDirection: mobile ? 'row' : 'column', gap: 6, width: mobile ? 'auto' : 30 }}>
                      {!PROTECTED_PROVIDER_TYPES.has(p.type) && (
                        <Button
                          variant="danger"
                          icon
                          size="sm"
                          onClick={() => removeProvider(p.type)}
                          title="Remove this provider"
                          aria-label="Remove this provider"
                        >{Ico.trash(13)}</Button>
                      )}
                      {!showKeyInput && (
                        <Button
                          icon
                          size="sm"
                          onClick={() => setEditingProviders((prev) => new Set([...prev, p.type]))}
                          title="Edit API key"
                          aria-label="Edit API key"
                        >{Ico.edit(13)}</Button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div style={{
                position: 'relative',
                padding: '14px 0 4px',
                minHeight: 50,
              }}>
                {/* Idle: + Add provider button. Fades + slides down when
              the picker opens. */}
                <Button
                  variant="subtle"
                  onClick={() => setAddPickerOpen(true)}
                  disabled={availableTypesForAdd.length === 0}
                  title={availableTypesForAdd.length === 0 ? 'All provider types are already configured' : 'Add another provider'}
                  style={{
                    position: 'absolute', top: 14, left: 0,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    opacity: addPickerOpen ? 0 : (availableTypesForAdd.length === 0 ? 0.45 : 1),
                    transform: addPickerOpen ? 'translateY(6px)' : 'translateY(0)',
                    transition: 'opacity 200ms ease, transform 200ms ease',
                    pointerEvents: addPickerOpen ? 'none' : (availableTypesForAdd.length === 0 ? 'none' : 'auto'),
                    cursor: availableTypesForAdd.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >{Ico.plus(13)} Add provider</Button>

                {/* Open: Choose Provider: <chip> <chip> · Cancel.
              Fades + slides up from below as it appears. */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
                  opacity: addPickerOpen ? 1 : 0,
                  transform: addPickerOpen ? 'translateY(0)' : 'translateY(-6px)',
                  transition: 'opacity 220ms ease, transform 220ms ease',
                  pointerEvents: addPickerOpen ? 'auto' : 'none',
                  position: 'absolute', top: 14, left: 0, right: 0,
                }}>
                  <strong style={{
                    fontSize: 12.5, color: 'var(--text-strong)', marginRight: 4,
                  }}>Choose Provider:</strong>
                  {availableTypesForAdd.map((t) => (
                    <Button
                      key={t}
                      variant="subtle"
                      onClick={() => addProviderOfType(t)}
                      title={PROVIDER_TYPE_DESC[t]}
                      style={{ fontSize: 12.5, padding: '4px 10px', fontWeight: 400 }}
                    >{typeLabels[t] || t}</Button>
                  ))}
                  <Button
                    variant="subtle"
                    icon
                    size="sm"
                    onClick={() => setAddPickerOpen(false)}
                    title="Hide the provider picker."
                    aria-label="Close provider picker"
                    style={{ marginLeft: 4 }}
                  >{Ico.close(13)}</Button>
                </div>
              </div>
            </CollapsibleGroup>
          </div>
          <div style={{ order: anyProviderConfigured ? 1 : 0 }}>
            <CollapsibleGroup title="Agent Models">
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
                  const curModel = providerWasRepointed ? fallbackModel : roleModelValue(role, fallbackModel);
                  const provider = providers.find((p) => p.type === curType);
                  const modelList = recommendedModels[curType] || [];
                  /* Per-model availability (settings.modelEnabled, sourced from MindsHub
                   * /v1/models). A model the org's wallet can't currently pay for (or
                   * whose free allowance is spent) is listed here as false so we render
                   * it greyed + non-selectable, with an "add credits to unlock" prompt.
                   * Absent id ⇒ available (backwards compatible; direct providers have
                   * no such flag). */
                  const modelEnabled = settings.modelEnabled || {};
                  const isLocked = (m) => modelEnabled[m] === false;
                  const firstEnabledModel = modelList.find((m) => !isLocked(m)) || modelList[0] || '';
                  const providerUnconfigured = !!curType && !(provider && providerConfigured(provider));
                  const providerFailed = (settings.providerStatus || {})[curType] === 'fail';
                  const providerFailDetail = (settings.providerStatusDetails || {})[curType] || '';
                  const isNoCredits = providerFailed && curType === 'minds-cloud'
                    && (providerFailDetail.includes('402')
                      || providerFailDetail.includes('429')
                      || providerFailDetail.toLowerCase().includes('credit')
                      || providerFailDetail.toLowerCase().includes('quota'));
                  const providerUnusable = (providerUnconfigured || providerFailed) && !isNoCredits;
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
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--text-strong)',
                      letterSpacing: '0.02em',
                    }}>{text}:</span>
                  );

                  const noCreditsNotice = isNoCredits ? (
                    <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                      <span style={{ color: '#E07060', fontWeight: 600 }}>No credits available. </span>
                      <button
                        type="button"
                        onClick={() => host.openExternal ? host.openExternal(MINDS_BILLING_URL) : window.open(MINDS_BILLING_URL, '_blank')}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent, #7CC4B6)', textDecoration: 'underline', fontSize: 'inherit', fontFamily: 'inherit' }}
                      >Top up credits →</button>
                      <span style={{ color: 'var(--text-muted)' }}>{' '}or add your own provider and API key below.</span>
                    </div>
                  ) : null;

                  return (
                    <Section title={label} subtitle={`Used for ${
                      role === 'planning' ? 'reasoning, orchestration, and responses'
                        : role === 'router' ? 'fast respond-or-delegate gating on each turn, and history summarization'
                        : 'scratchpad code generation'
                    }.`} notice={noCreditsNotice}>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {multipleProviders && (
                          <label style={{ display: 'grid', gap: 4 }}>
                            {fieldLabel('Provider')}
                            <Select
                              value={curType}
                              onValueChange={(t) => {
                                const pair = recommendedPair[t] || ['', '', ''];
                                const newModel = pair[roleIdx] || pair[1] || (recommendedModels[t]?.[0] || '');
                                setModelInputMode((m) => ({ ...m, [role]: false }));
                                writeOverride({ providerType: t, model: newModel });
                              }}
                              invalid={providerUnusable}
                              aria-describedby={providerUnusable ? providerWarnId : undefined}
                              title={`Choose which provider powers the ${role} role.`}
                              options={providers.map((p) => ({ value: p.type, label: providerDisplayName(p) }))}
                            />
                          </label>
                        )}
                        {modelList.length > 0 ? (
                          (() => {
                            const allowOther = curType !== 'minds-cloud';
                            // See resolveModelPickerValue + buildModelOptions: keeps the Select's
                            // value matched to a rendered option so picking a model always fires
                            // a real change and Save writes it — a login-written `latest:` pin no
                            // longer wedges the control into a no-op "Saved" (ENG-739).
                            const { showStalePin, inputMode, selectValue } =
                              resolveModelPickerValue(curModel, modelList, allowOther, modelInputMode[role]);
                            const modelOptions = buildModelOptions(curModel, modelList, allowOther, showStalePin, modelEnabled, settings.modelLabels || {});
                            return (
                              <label style={{ display: 'grid', gap: 4 }}>
                                {fieldLabel('Model')}
                                <Select
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
                            );
                          })()
                        ) : (
                          <label style={{ display: 'grid', gap: 4 }}>
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
                          <label style={{ display: 'grid', gap: 4 }}>
                            {fieldLabel('Reasoning effort')}
                            <Select
                              value={effortValue}
                              onValueChange={(v) => { setLlmDirty(true); setSetting(effortKey, v); }}
                              title={`Reasoning effort for the ${role} model. Higher effort trades latency/cost for deeper reasoning.`}
                              options={effortOptions.map((lvl) => ({ value: lvl, label: lvl.charAt(0).toUpperCase() + lvl.slice(1) }))}
                            />
                          </label>
                        )}
                        {providerUnusable && (
                          <div id={providerWarnId} style={{ fontSize: 11.5, color: '#E07060' }}>
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
            </CollapsibleGroup>
          </div>
        </div>

        <CollapsibleGroup title="Agent Harness">
          <Section title="Harness" subtitle={`Which AI agent powers your tasks. ${agentLabel || 'Anton'} is the default; Hermes is an alternative agent with its own tool and memory system.`}>
            <ToggleGroup
              value={settings.harness || 'anton'}
              onValueChange={(v) => { setSetting('harness', v); setLlmDirty(true); }}
              aria-label="Agent harness"
              options={[
                { value: 'anton', label: 'Anton', 'aria-label': 'Use Anton agent', title: 'Anton — the default AI agent.' },
                { value: 'hermes', label: 'Hermes', 'aria-label': 'Use Hermes agent', title: 'Hermes — alternative agent with independent tools and memory.' },
              ]}
            />
          </Section>
        </CollapsibleGroup>

        <CollapsibleGroup title="Memory" defaultOpen={false}>
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
              title={`Save conversation history so ${agentLabel || 'Anton'} can recall past tasks.`}
              aria-label="Episodic memory"
            />
          </Section>
          <Section title="Proactive dashboards" subtitle="Auto-generate HTML reports from scratchpad output.">
            <Switch
              checked={settings.proactiveDashboards ?? false}
              onCheckedChange={(v) => setSetting('proactiveDashboards', v)}
              title="Auto-generate HTML reports from scratchpad output."
              aria-label="Proactive dashboards"
            />
          </Section>
          <Section title="Act first, ask later" subtitle="Act on reasonable defaults and state assumptions inline, instead of stopping to ask.">
            <Switch
              checked={settings.actFirst ?? true}
              onCheckedChange={(v) => setSetting('actFirst', v)}
              title={`${agentLabel || 'Anton'} acts on sensible defaults and surfaces its assumptions as it goes, instead of pausing to ask.`}
              aria-label="Act first, ask later"
            />
          </Section>
        </CollapsibleGroup>
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
      return <span style={{ ...fadeStyle, fontSize: 11.5, color: 'var(--ink-4)', marginLeft: 8 }}>Saving…</span>;
    }
    if (status.state === 'error') {
      return <span style={{ ...fadeStyle, fontSize: 11.5, color: 'var(--danger, #e5484d)', marginLeft: 8 }}>Couldn't save</span>;
    }
    return (
      <span style={{ ...fadeStyle, fontSize: 11.5, color: 'var(--ok, #3aa876)', marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
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

  const renderAppearanceSection = () => (
    // No Save footer here — every control on this page auto-saves itself
    // (see autoSaveSetting/AutoSaveTag below); a page-wide Save button would
    // be dead weight that always reads "Saved" and never does anything.
    // `autoSaved` surfaces a quiet "saves automatically" note on mobile so the
    // page doesn't read as "no way to save" next to Save-button sections.
    <SettingsSectionPanel autoSaved>
      <CollapsibleGroup title="Appearance">
        <Section title="Style" subtitle="Normal, 8-Bit, or design your own with Custom. Combines with light and dark.">
          <ToggleGroup
            value={normalizeSkin(skin)}
            onValueChange={(v) => onSkinChange?.(v)}
            aria-label="Style"
            options={SKINS.map((s) => ({
              value: s.id,
              label: s.icon && Ico[s.icon]
                ? (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{Ico[s.icon](13)} {s.label}</span>)
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
                label: (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{Ico.sun(13)} Light</span>),
                'aria-label': 'Light theme',
                title: 'Use the light theme.',
              },
              {
                value: 'dark',
                label: (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{Ico.moon(13)} Dark</span>),
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
                style={{ width: 64, height: 32, padding: 2, border: '1px solid var(--line-2)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer' }}
              />
            </Section>
            <Section title="Background — Light mode" subtitle="Pick a base color for Light — surfaces and text shades derive from it — or use Light's default.">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  type="color"
                  value={customTheme.bgLight || '#fafafa'}
                  onChange={(e) => onCustomThemeChange?.({ ...customTheme, bgLight: e.target.value })}
                  disabled={customTheme.bgLight === null}
                  aria-label="Custom background color — Light mode"
                  style={{ width: 64, height: 32, padding: 2, border: '1px solid var(--line-2)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', opacity: customTheme.bgLight === null ? 0.45 : 1 }}
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  type="color"
                  value={customTheme.bgDark || '#080d18'}
                  onChange={(e) => onCustomThemeChange?.({ ...customTheme, bgDark: e.target.value })}
                  disabled={customTheme.bgDark === null}
                  aria-label="Custom background color — Dark mode"
                  style={{ width: 64, height: 32, padding: 2, border: '1px solid var(--line-2)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', opacity: customTheme.bgDark === null ? 0.45 : 1 }}
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
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
                title="Toggle the CRT scanline overlay."
                aria-label="Scanline overlay"
              />
            </Section>
          </>
        )}
        <Section title="Greeting" subtitle="The line shown when you start a new task.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="color"
              value={settings.navTitleColor || '#e8e8ec'}
              onChange={(e) => autoSaveSetting('navTitleColor', e.target.value, { debounceMs: 400 })}
              disabled={!settings.navTitleColor}
              aria-label="Sidebar title color"
              style={{ width: 64, height: 32, padding: 2, border: '1px solid var(--line-2)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', opacity: settings.navTitleColor ? 1 : 0.45 }}
            />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {settings.navLogo && (
              <img
                src={settings.navLogo}
                alt=""
                style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--surface)' }}
              />
            )}
            <Button
              variant="subtle"
              onClick={() => logoInputRef.current?.click()}
              title="Choose a logo image."
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
              style={{ display: 'none' }}
              onChange={(e) => { handleLogoUpload(e.target.files?.[0]); e.target.value = ''; }}
            />
            <AutoSaveTag settingKey="navLogo" />
          </div>
          {logoError && (
            <div style={{ fontSize: 12, color: 'var(--danger, #e5484d)', marginTop: 6 }}>{logoError}</div>
          )}
        </Section>
        <div className="settings-hide-mobile">
          <Section title="Animated background" subtitle="Off by default. Toggle on for an animated dot-grid behind the app instead of a flat surface.">
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Switch
                checked={settings.showDots}
                onCheckedChange={(v) => autoSaveSetting('showDots', v)}
                title="Toggle the animated grid background."
                aria-label="Animated background"
              />
              <AutoSaveTag settingKey="showDots" />
            </div>
          </Section>
          <Section title="Show nav-panel counters" subtitle="Badge counts on Projects / Scheduled / Artifacts / Connected apps, plus the time-since label on each Recent row.">
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Switch
                checked={settings.showCounters !== false}
                onCheckedChange={(v) => autoSaveSetting('showCounters', v)}
                title="Show badge counts on Projects, Scheduled, Artifacts and Connected apps."
                aria-label="Nav-panel counters"
              />
              <AutoSaveTag settingKey="showCounters" />
            </div>
          </Section>
          <Section title="Theme toggle button" subtitle="The light/dark button in the sidebar footer.">
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Switch
                checked={settings.showThemeToggle !== false}
                onCheckedChange={(v) => autoSaveSetting('showThemeToggle', v)}
                title="Show or hide the sidebar's light/dark theme toggle."
                aria-label="Theme toggle button"
              />
              <AutoSaveTag settingKey="showThemeToggle" />
            </div>
          </Section>
          <Section title="8-bit style toggle button" subtitle="The gamepad button in the sidebar footer that switches to 8-Bit Arcade style.">
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Switch
                checked={settings.show8bitToggle !== false}
                onCheckedChange={(v) => autoSaveSetting('show8bitToggle', v)}
                title="Show or hide the sidebar's 8-bit style toggle."
                aria-label="8-bit style toggle button"
              />
              <AutoSaveTag settingKey="show8bitToggle" />
            </div>
          </Section>
        </div>
      </CollapsibleGroup>
    </SettingsSectionPanel>
  );

  const renderChannelsSection = () => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <ChannelsView />
    </div>
  );

  const renderUpdatesSection = () => (
    <SettingsSectionPanel footer={renderSaveFooter()}>
      <div style={{
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)',
        background: 'var(--surface-glass)',
        WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
        backdropFilter: 'blur(var(--surface-glass-blur))',
        marginBottom: 14, overflow: 'hidden', padding: '0 18px 8px',
      }}>
        <Section
          title="Current version"
          subtitle="The version currently running. Server and UI updates are applied automatically at launch; components under the hood are shown in details."
        >
          {(() => {
            const baked = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
            // App shell = installed Electron shell (changes only on reinstall).
            const shellVer = versionInfo.app || baked;
            // The running renderer's own baked version is authoritative for the
            // UI version — it's compiled into whichever bundle actually loaded
            // (OTA or bundled). Main-process cache metadata (`versionInfo.ui`)
            // can lag the loaded renderer (OTA off, missing cache, post-
            // rollback), so it only informs the source label, never the version.
            const uiVer = baked || versionInfo.ui || '';
            const uiSource = versionInfo.source === 'ota' ? 'OTA'
              : versionInfo.source === 'web' ? 'web' : 'bundled';
            // Unified "content" headline = ISO week of the newest of the
            // hot-updated components (UI + server + agent). App shell is
            // excluded — it updates via reinstall and is shown on its own line.
            const unified = unifiedVersion([uiVer, serverVersion, antonVersion]);
            const outOfSync = !!unified && unified.skewDays >= SKEW_WARN_DAYS;
            const rows = [
              ['App shell', shellVer || '—'],
              ['UI', uiVer ? `${uiVer} (${uiSource})` : '—'],
              ['Server', serverVersion || '—'],
              ['Agent', antonVersion || '—'],
            ];
            const copyText = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: 'var(--text-strong)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span title={unified ? unified.weekOf : undefined} style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600 }}>
                    {unified ? unified.label : (shellVer || '—')}
                  </span>
                  {outOfSync && (
                    <span
                      title={`Underlying components span ${unified.skewDays} days — a component is lagging. See details.`}
                      style={{ color: 'var(--warning, #c47f00)', fontSize: 11.5, fontWeight: 600 }}
                    >
                      ⚠ out of sync
                    </span>
                  )}
                  {unified && (
                    <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{unified.weekOf}</span>
                  )}
                </div>
                {isElectron && (
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 12 }}>
                    <span style={{ marginRight: 4 }}>App shell</span>{shellVer || '—'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setShowVersionDetails((v) => !v)}
                  style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 11.5 }}
                >
                  {showVersionDetails ? 'Hide details' : 'Details'}
                </button>
                {showVersionDetails && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--surface-glass)' }}>
                    {rows.map(([k, v]) => (
                      <span key={k}>
                        <span style={{ color: 'var(--text-muted)', marginRight: 6, display: 'inline-block', minWidth: 64 }}>{k}</span>{v}
                      </span>
                    ))}
                    <Button
                      onClick={() => {
                        navigator.clipboard?.writeText(copyText);
                        setVersionCopied(true);
                        setTimeout(() => setVersionCopied(false), 1500);
                      }}
                      style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    >
                      {versionCopied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </Section>
      </div>
    </SettingsSectionPanel>
  );

  const renderBackendSection = () => {
    if (host.isWeb) {
      return (
        <SettingsSectionPanel>
          <div style={{
            padding: '32px 0',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, textAlign: 'center',
            color: 'var(--text-muted)', fontSize: 13,
          }}>
            <span style={{ fontSize: 32, lineHeight: 1 }}>☁</span>
            <div style={{ fontWeight: 600, color: 'var(--text-strong)', fontSize: 14 }}>Backend is managed server-side</div>
            <div style={{ maxWidth: 320 }}>The Python backend runs on the server — it isn't controllable from this interface.</div>
          </div>
        </SettingsSectionPanel>
      );
    }

    const FONT_MONO = "var(--font-mono, 'JetBrains Mono', monospace)";
    const error = diag?.lastError;
    const log = (diag?.recentLog || '').trim();
    const port = diag?.port;
    const errorKind = diag?.lastErrorKind ?? null;
    const startedAt = diag?.lastStartAt
      ? new Date(diag.lastStartAt).toLocaleTimeString()
      : null;
    // "never started" is wrong for a backend that was still importing when we
    // stopped waiting for it (the most common failure on a slow machine's first
    // launch), and equally wrong for one the user deliberately stopped — a
    // signal kill leaves no exit code, so both used to land on that string.
    const exitLabel = exitCodeLabel({
      kind: errorKind,
      exitCode: diag?.lastExitCode ?? null,
      stopIntentional: diag?.lastStopIntentional ?? null,
    });
    const failureCopy = backendFailureCopy({
      kind: errorKind,
      hasLog: log.length > 0,
      port: port ?? null,
      portHolderPid: diag?.portHolderPid ?? null,
    });

    const state = serverBusy
      ? (serverBusyKind === 'stopping' ? 'stopping' : 'starting')
      : serverOnline ? 'online' : 'offline';
    const offlineKind = state === 'offline'
      && !error
      && diag?.lastStopIntentional === true
      ? 'stopped'
      : 'failed';

    const STATUS_META = {
      online: { title: 'MindsHub backend is running', subtitle: 'The local Python server is responding to /health.', iconColor: 'var(--success, #1F8F5F)', iconBgMix: 'var(--success, #1F8F5F)' },
      starting: { title: 'MindsHub backend is starting…', subtitle: 'Spawning the local Python server. This usually takes a few seconds.', iconColor: 'var(--accent)', iconBgMix: 'var(--accent)' },
      stopping: { title: 'MindsHub backend is stopping…', subtitle: 'Waiting for the local Python server to terminate.', iconColor: 'var(--ink-3)', iconBgMix: 'var(--ink-3)' },
      offline: offlineKind === 'stopped'
        ? { title: 'MindsHub backend is stopped', subtitle: 'You stopped the local Python server. Click "Start backend" below to bring it back up.', iconColor: 'var(--ink-3)', iconBgMix: 'var(--ink-3)' }
        : { title: 'MindsHub backend isn\'t running', subtitle: "The local Python server didn't start. The most recent error and log tail are captured below.", iconColor: 'var(--danger)', iconBgMix: 'var(--danger)' },
    }[state];

    const backendFooter = (
      <>
        <Button onClick={refreshDiag} title="Refresh diagnostics">
          {Ico.refresh(14)}Refresh
        </Button>
        {(onStartServer || onStopServer) && state !== 'offline' && (
          <Button onClick={handleBackendStop} disabled={diagBusy || serverBusy || !onStopServer}>
            {(diagBusy && serverBusyKind === 'stopping') ? 'Stopping…' : 'Stop backend'}
          </Button>
        )}
        {(onStartServer || onStopServer) && (
          <Button variant="primary" onClick={state === 'offline' ? handleBackendStart : handleBackendRestart}
            disabled={diagBusy || serverBusy || (state === 'offline' ? !onStartServer : !(onStartServer && onStopServer))}
          >{diagBusy ? (state === 'offline' ? 'Starting…' : 'Restarting…') : (state === 'offline' ? 'Start backend' : 'Restart backend')}</Button>
        )}
      </>
    );

    return (
      <SettingsSectionPanel footer={backendFooter}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Status card — status header + port + logs */}
          <div style={{
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)',
            background: 'var(--surface-glass)',
            WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
            backdropFilter: 'blur(var(--surface-glass-blur))',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--line)',
              fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em',
              textTransform: 'uppercase', color: 'var(--ink-4)',
            }}>Status</div>

            {/* Status summary row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px' }}>
              <span style={{
                display: 'inline-grid', placeItems: 'center',
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                background: `color-mix(in srgb, ${STATUS_META.iconBgMix} 14%, var(--surface))`,
                color: STATUS_META.iconColor,
                border: `1px solid color-mix(in srgb, ${STATUS_META.iconBgMix} 35%, transparent)`,
              }}>
                {Ico.power ? Ico.power(16) : '⏻'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{STATUS_META.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>{STATUS_META.subtitle}</div>
              </div>
            </div>

            {/* Port + exit code + last attempt chips */}
            <div style={{
              display: 'flex', gap: 8, padding: '0 16px 14px',
              fontFamily: FONT_MONO, fontSize: 11,
            }}>
              <div style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 9.5, marginRight: 6 }}>Port</span>
                <span style={{ color: 'var(--ink)' }}>{port ?? '—'}</span>
              </div>
              {state === 'offline' && (
                <div style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 9.5, marginRight: 6 }}>Exit</span>
                  <span style={{ color: 'var(--ink)' }}>{exitLabel}</span>
                </div>
              )}
              {startedAt && (
                <div style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 9.5, marginRight: 6 }}>Started</span>
                  <span style={{ color: 'var(--ink)' }}>{startedAt}</span>
                </div>
              )}
            </div>

            {/* Headline error inside card — offline + start-failure */}
            {state === 'offline' && offlineKind === 'failed' && (
              <div style={{ padding: '0 16px 14px' }}>
                {error ? (
                  <div style={{
                    padding: '10px 12px', borderRadius: 8,
                    background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
                    border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
                    color: 'var(--danger)', fontSize: 12.5, lineHeight: 1.5,
                    fontFamily: FONT_MONO, wordBreak: 'break-word',
                  }}>{error}</div>
                ) : (
                  <div style={{
                    padding: '10px 12px', borderRadius: 8,
                    background: 'var(--surface-2)', border: '1px solid var(--line)',
                    color: 'var(--ink-3)', fontSize: 12.5, lineHeight: 1.5,
                  }}>No specific start error was captured. Check the log tail — the process may have died after starting.</div>
                )}
              </div>
            )}

            {/* Recent log */}
            <div style={{ borderTop: '1px solid var(--line)', padding: '10px 16px 14px' }}>
              <div style={{
                fontFamily: FONT_MONO, fontSize: 10, color: 'var(--ink-4)',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6,
              }}>Log</div>
              <pre style={{
                margin: 0, padding: '10px 12px',
                background: 'var(--surface-2)', border: '1px solid var(--line)',
                borderRadius: 8, fontFamily: FONT_MONO, fontSize: 11.5, lineHeight: 1.55,
                color: 'var(--ink-2)', maxHeight: 200, overflow: 'auto',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text',
              }}>{log || '(no log captured yet)'}</pre>
            </div>
          </div>

          {/* What actually happened + what to do about it. Driven by the
              failure kind, so the panel never asks for a log in the state
              where no log can exist. */}
          {state === 'offline' && offlineKind === 'failed' && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              <div style={{ color: 'var(--ink-2)', fontWeight: 600, marginBottom: 4 }}>{failureCopy.headline}</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {failureCopy.hints.map((hint) => <li key={hint}>{hint}</li>)}
              </ul>
            </div>
          )}


        </div>
      </SettingsSectionPanel>
    );
  };

  const renderAccountSection = () => {
    const CARD = {
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--card-radius)',
      background: 'var(--surface-glass)',
      WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
      backdropFilter: 'blur(var(--surface-glass-blur))',
      marginBottom: 14, overflow: 'hidden',
    };

    // User info card — shown on both Electron and web if we have a token
    const userCard = accountUser && (
      <div style={{ ...CARD }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '16px 18px',
        }}>
          {/* Avatar circle with initials */}
          <div style={{
            width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
            background: 'color-mix(in srgb, var(--accent, #5d9287) 18%, var(--surface))',
            border: '1px solid color-mix(in srgb, var(--accent, #5d9287) 35%, transparent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 700, color: 'var(--accent, #5d9287)',
            userSelect: 'none',
          }} aria-hidden="true">
            {accountUser.name
              ? accountUser.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
              : accountUser.email
                ? accountUser.email[0].toUpperCase()
                : '?'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {accountUser.name && (
              <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {accountUser.name}
              </div>
            )}
            {accountUser.email && (
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: accountUser.name ? 2 : 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {accountUser.email}
              </div>
            )}
            {!accountUser.name && !accountUser.email && accountUser.username && (
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{accountUser.username}</div>
            )}
          </div>
          <a
            href={MINDS_CONSOLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flexShrink: 0, fontSize: 12, fontWeight: 500,
              color: 'var(--accent, #5d9287)', textDecoration: 'none',
              padding: '5px 10px', borderRadius: 6,
              border: '1px solid color-mix(in srgb, var(--accent, #5d9287) 40%, transparent)',
              background: 'color-mix(in srgb, var(--accent, #5d9287) 8%, transparent)',
            }}
          >MindsHub ↗</a>
        </div>
        {/* Extra rows for username / org if present */}
        {(accountUser.username || accountUser.org) && (
          <div style={{
            borderTop: '1px solid var(--line)',
            padding: '10px 18px',
            display: 'flex', gap: 20,
          }}>
            {accountUser.username && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 2 }}>Username</div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>{accountUser.username}</div>
              </div>
            )}
            {accountUser.org && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 2 }}>Organization</div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>{accountUser.org}</div>
              </div>
            )}
          </div>
        )}
      </div>
    );

    const signInCard = !accountUser && onSsoSignIn && (
      <div style={{
        ...CARD,
        padding: '32px 28px 28px',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 24,
        background: 'color-mix(in srgb, var(--accent, #5d9287) 5%, var(--surface-glass))',
        borderColor: 'color-mix(in srgb, var(--accent, #5d9287) 28%, transparent)',
      }}>
        {/* Header */}
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1.25, marginBottom: 6 }}>
            Enable cloud capabilities
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 440 }}>
            Sign in with MindsHub to access every model, cloud execution, and publishing — all in one place.
          </div>
        </div>

        {/* Feature grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', width: '100%' }}>
          {[
            { icon: '⇌', label: 'Seamless model router', desc: 'The simplest way to use all models in one place — Claude, GPT, DeepSeek, Kimi, and more.' },
            { icon: '⟁', label: 'Remote tasks', desc: 'Run code and long tasks on managed infrastructure, not your laptop.', soon: true },
            { icon: <svg width="17" height="13" viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15.5 12H5a4 4 0 0 1-.5-7.97A5 5 0 0 1 14.5 6h1a3 3 0 0 1 0 6Z" /></svg>, label: 'Share & collaborate', desc: 'Share dashboards, reports, and artifacts — and work on them together.' },
            { icon: '⊹', label: 'Unified account', desc: 'One login, one bill — no juggling API keys across providers.' },
          ].map(({ icon, label, desc, soon }) => (
            <div key={label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{
                fontSize: 16, lineHeight: 1,
                color: 'var(--accent, #5d9287)',
                marginTop: 2, flexShrink: 0,
                display: 'inline-flex', alignItems: 'center',
              }}>{icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-strong)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {label}
                  {soon && (
                    <span style={{
                      fontSize: 9.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                      padding: '1px 5px', borderRadius: 99,
                      background: 'rgba(127,127,127,0.1)', border: '1px solid rgba(127,127,127,0.2)',
                      color: 'var(--text-muted)',
                    }}>coming soon</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Last sign-in failure (ENG-761) — without this, a failed
            browser flow left the card looking untouched and the user
            with no idea anything went wrong. */}
        {ssoError && (
          <div role="alert" style={{
            width: '100%', padding: '10px 14px', borderRadius: 8,
            fontSize: 12.5, lineHeight: 1.55,
            color: 'var(--danger, #c0564f)',
            background: 'color-mix(in srgb, var(--danger, #c0564f) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger, #c0564f) 30%, transparent)',
          }}>
            Sign-in didn't complete: {ssoError}
          </div>
        )}

        {/* CTA */}
        <Button variant="primary" onClick={onSsoSignIn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          Sign in / Sign up to MindsHub
        </Button>
      </div>
    );

    if (!host.isElectron) {
      return (
        <SettingsSectionPanel>
          {userCard || (
            <div style={{ padding: '32px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              <div style={{ fontWeight: 600, color: 'var(--text-strong)', fontSize: 14 }}>Managed via MindsHub</div>
              <div style={{ maxWidth: 320 }}>Account management is handled through MindsHub for the web version.</div>
            </div>
          )}
        </SettingsSectionPanel>
      );
    }

    return (
      <SettingsSectionPanel>
        {signInCard}
        {userCard}
        {accountUser && <div style={{ ...CARD, padding: '0 18px 8px' }}>
          <Section title="Sign out" subtitle="Disconnect from MindsHub and remove every stored credential on this device. Cowork will return to the onboarding flow on the next launch.">
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="danger" onClick={() => setLogoutConfirmOpen(true)} disabled={loggingOut} title="Sign out and clear stored credentials">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </Button>
            </div>
          </Section>
        </div>}
      </SettingsSectionPanel>
    );
  };

  const logoutConfirm = (
    <ConfirmModal
      open={logoutConfirmOpen}
      title="Sign out of Cowork?"
      message="This clears your stored API keys and disconnects from MindsHub. You'll need to sign in again to keep using Cowork."
      confirmLabel="Sign out"
      cancelLabel="Cancel"
      destructive
      busy={loggingOut}
      busyLabel="Signing out…"
      onConfirm={handleLogout}
      onClose={() => setLogoutConfirmOpen(false)}
    />
  );

  // Mobile (ENG-990): master-detail. The surface is a list of the six
  // sections; tapping one drills into a focused full-screen page for just
  // that section (sub-groups render flat — see CollapsibleGroup — so there's
  // no nested collapsing). The top-bar back control returns to the list; from
  // the list it closes Settings (onClose). Only the open section mounts, so
  // its effects/dropdowns don't all run at once.
  if (mobile) {
    const renderers = {
      agent: renderAgentSection,
      appearance: renderAppearanceSection,
      channels: renderChannelsSection,
      updates: renderUpdatesSection,
      backend: renderBackendSection,
      account: renderAccountSection,
    };
    const activeItem = NAV_ITEMS.find((i) => i.id === section) || null;
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
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
              {NAV_ITEMS.map((item) => {
                const disabled = !serverOnline && item.id !== 'backend';
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
                        <span aria-hidden="true" style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--text-muted)' }}>
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
        {logoutConfirm}
      </SettingsLayoutContext.Provider>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
      <SettingsNav section={section} onSectionChange={onSectionChange} serverOnline={serverOnline} />

      {section === 'agent' && renderAgentSection()}
      {section === 'appearance' && renderAppearanceSection()}
      {section === 'channels' && renderChannelsSection()}
      {section === 'updates' && renderUpdatesSection()}
      {section === 'backend' && renderBackendSection()}
      {section === 'account' && renderAccountSection()}

      {logoutConfirm}
    </div>
  );
}
