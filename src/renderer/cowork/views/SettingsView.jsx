import { useState, useEffect, useRef } from 'react';
import { useId } from 'react';
import Ico from '../components/Icons';
import { validateSettings, revealSettingKey, testProviders, fetchHealth } from '../api';
import { providerTypeToKeyField, providerValueToType, modelLabel } from '../lib/settingsTransform';
import { trackHarnessSwapped, resetDeviceIdentity } from '../lib/analytics';
import { ConfirmModal } from '../components/ConfirmModal';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { Switch } from '../components/ui/Switch';
import { host } from '../../platform/host';
import { SKINS, normalizeSkin } from '../../lib/skins';
import { MINDS_API_BASE, MINDS_API_KEY_URL, MINDS_CONSOLE_URL, MINDS_REGISTER_URL, MINDS_BILLING_URL } from '../../lib/mindsUrls';
import { getUIVersion, isElectron, getAccessToken } from '../../platform/host';
import ChannelsView from './ChannelsView';

function decodeJwtPayload(token) {
  try {
    let payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    return JSON.parse(atob(payload));
  } catch { return null; }
}

function Section({ title, subtitle, notice, children }) {
  return (
    <div className="settings-section" style={{
      display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0,
      padding: '16px 0',
      alignItems: 'flex-start',
    }}>
      <div style={{ paddingRight: 24 }}>
        <h3 style={{
          margin: 0, padding: 0,
          fontSize: 14, fontWeight: 600, color: 'var(--text-strong)',
          fontFamily: 'inherit', lineHeight: 1.3,
        }}>{title}</h3>
        {subtitle && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>{subtitle}</div>}
        {notice && <div style={{ marginTop: 8 }}>{notice}</div>}
      </div>
      <div style={{ paddingLeft: 24 }}>{children}</div>
    </div>
  );
}

// Collapsible group of sections. Defaults to open; click the header to
// toggle. Uses the theme tokens so it reads well in light + dark.
function CollapsibleGroup({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const headingId = useId();
  return (
    <div style={{
      border: '1px solid var(--border-subtle)',
      borderRadius: 10,
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
function SettingsSectionPanel({ children, footer }) {
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
    <input
      className="field-input"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
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
      <input
        className="field-input"
        value={v}
        onChange={(e) => onChange(e.target.value)}
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
      <input
        className="field-input mono"
        type={show ? 'text' : 'password'}
        value={showSentinelAsMask ? '' : v}
        onChange={(e) => onInput(e.target.value)}
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
                boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
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
  const palette = {
    required: { fg: '#E5B57A', bg: 'rgba(229,181,122,0.12)', bd: 'rgba(229,181,122,0.30)', label: 'Required' },
    optional: { fg: 'var(--text-muted)', bg: 'rgba(127,127,127,0.10)', bd: 'var(--border-subtle)', label: 'Optional' },
    auto: { fg: 'var(--sage-500, #5d9287)', bg: 'rgba(93,146,135,0.12)', bd: 'rgba(93,146,135,0.30)', label: 'Auto' },
  }[status];
  if (!palette) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      marginLeft: 8, padding: '1px 7px',
      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: palette.fg, background: palette.bg,
      border: `1px solid ${palette.bd}`, borderRadius: 999,
      verticalAlign: 'middle',
    }}>{palette.label}</span>
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
    <span
      title={active
        ? 'Stored and used by the active provider'
        : 'A value is stored, but the active provider does not use it'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        marginLeft: 8, padding: '1px 8px 1px 7px',
        fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: active ? '#7CC4B6' : 'var(--sage-500, #5d9287)',
        background: active ? 'rgba(124,196,182,0.18)' : 'rgba(93,146,135,0.10)',
        border: `1px solid ${active ? 'rgba(124,196,182,0.55)' : 'rgba(93,146,135,0.28)'}`,
        borderRadius: 999, verticalAlign: 'middle',
        // When active, the box-shadow comes from the set-badge-pulse
        // keyframes; the static value would never paint. When inactive
        // we explicitly clear any inherited shadow.
        boxShadow: active ? undefined : 'none',
        animation: active ? 'set-badge-pulse 2.4s ease-in-out infinite' : 'none',
        transition: 'box-shadow .2s ease, background .2s ease, color .2s ease',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: 999,
        background: active ? '#7CC4B6' : 'var(--sage-500, #5d9287)',
        boxShadow: active
          ? '0 0 8px #7CC4B6, 0 0 14px rgba(124,196,182,0.6)'
          : '0 0 4px rgba(93,146,135,0.45)',
      }} />
      Set
    </span>
  );
}

// ───────────────────────── Multi-provider helpers ─────────────────────────

const PROVIDER_TYPE_ORDER = ['minds-cloud', 'anthropic', 'openai', 'gemini', 'openai-compatible'];

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
  onSsoSignIn,
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
  const [uiVersion, setUiVersion] = useState('');
  const [serverVersion, setServerVersion] = useState('');
  // Whether the refresh token lives in the macOS keychain (vs a file under
  // ~/.cowork). Mac-only; read from main on mount.
  const [keychainPref, setKeychainPref] = useState(false);
  // Backend section diagnostics state
  const [diag, setDiag] = useState(null);
  const [diagBusy, setDiagBusy] = useState(false);
  // Account section — decoded from the JWT, null until loaded
  const [accountUser, setAccountUser] = useState(null);

  useEffect(() => { getUIVersion().then(setUiVersion).catch(() => { }); }, []);
  useEffect(() => { fetchHealth().then((h) => setServerVersion(h?.server_version || '')).catch(() => { }); }, []);
  useEffect(() => { if (host.isElectron && host.isMac()) host.getKeychainPref().then(setKeychainPref).catch(() => { }); }, []);
  useEffect(() => {
    if (section !== 'account') return;
    getAccessToken().then((token) => {
      if (!token) return;
      const payload = decodeJwtPayload(token);
      if (!payload) return;
      setAccountUser({
        name: payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' ') || null,
        email: payload.email || null,
        username: payload.preferred_username || null,
        sub: payload.sub || null,
        org: (() => {
          let org = payload.active_organization ?? payload.organization;
          if (typeof org === 'string') { try { org = JSON.parse(org); } catch { return null; } }
          return org?.displayName || org?.name || null;
        })(),
      });
    }).catch(() => { });
  }, [section]);

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
  const canonicalProviderForRole = (role) => providerValueToType(
    role === 'planning' ? settings.planningProvider : settings.codingProvider,
  ) || 'minds-cloud';
  const canonicalModelForRole = (role) => {
    if (role === 'planning') return settings.planningModel ?? settings.defaultModel ?? '';
    return settings.codingModel ?? '';
  };
  const roleProviderType = (role) => roleOverride(role)?.providerType || canonicalProviderForRole(role);
  const roleModelValue = (role, fallback = '') => {
    const override = roleOverride(role);
    if (override && Object.prototype.hasOwnProperty.call(override, 'model')) {
      return override.model || '';
    }
    return canonicalModelForRole(role) || fallback || '';
  };
  const setRoleDriver = (role, providerType, model) => {
    const normalizedType = providerValueToType(providerType) || 'minds-cloud';
    const nextModel = model || '';
    if (role === 'planning') {
      setSetting('planningProvider', normalizedType);
      setSetting('planningModel', nextModel);
      setSetting('defaultModel', nextModel);
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
      types.add(overrides.planning?.providerType || defaultModeProviderType);
      types.add(overrides.coding?.providerType || defaultModeProviderType);
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
    for (const role of ['planning', 'coding']) {
      const o = roleOverride(role);
      if (roleProviderType(role) === type) {
        const pair = recommendedPair['minds-cloud'] || ['', ''];
        const fallback = pair[role === 'planning' ? 0 : 1] || (recommendedModels['minds-cloud']?.[0] || '');
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
      <button
        className="btn-primary" onClick={save}
        disabled={(!settingsDirty && !anyProviderFailed) || testing || missingCustomNames}
        title={missingCustomNames ? 'Each custom provider needs a name' : testing ? 'Saving…' : (!settingsDirty && !anyProviderFailed) ? 'No unsaved changes' : anyProviderFailed ? 'Re-test failed providers.' : 'Save changes and re-run provider tests.'}
        style={{ width: 140, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: ((!settingsDirty && !anyProviderFailed) || testing || missingCustomNames) ? 0.55 : 1, cursor: ((!settingsDirty && !anyProviderFailed) || testing || missingCustomNames) ? 'default' : 'pointer' }}
      >
        {testing ? 'Saving…' : (settingsDirty || anyProviderFailed) ? 'Save settings' : <>{Ico.check(14)} Saved</>}
      </button>
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
                const statusPillLabel = status === 'ok' ? 'connected'
                  : status === 'fail' ? 'unable to connect'
                    : status === 'testing' ? 'testing…'
                      : configured ? 'not tested'
                        : null;
                const statusPillTitle = status === 'ok' ? `Last test passed${detail ? ` (${detail})` : ''}`
                  : status === 'fail' ? `Last test failed${detail ? `: ${detail}` : ''}`
                    : status === 'testing' ? 'Testing…'
                      : 'Not tested yet — save settings and run a test to verify.';
                const statusPillColor = status === 'ok'
                  ? { bg: 'rgba(124,196,182,0.15)', border: 'rgba(124,196,182,0.4)', color: '#7CC4B6' }
                  : status === 'fail'
                    ? { bg: 'rgba(224,112,96,0.15)', border: 'rgba(224,112,96,0.4)', color: '#E07060' }
                    : status === 'testing'
                      ? { bg: 'rgba(229,181,122,0.12)', border: 'rgba(229,181,122,0.35)', color: '#E5B57A' }
                      : configured
                        ? { bg: 'rgba(127,127,127,0.08)', border: 'rgba(127,127,127,0.2)', color: 'var(--text-muted)' }
                        : null;
                const statusPill = statusPillColor ? (
                  <span
                    title={statusPillTitle}
                    aria-label={statusPillTitle}
                    style={{
                      display: 'inline-flex', alignItems: 'center',
                      padding: '2px 8px', borderRadius: 999,
                      fontSize: 11, fontWeight: 500, letterSpacing: '0.01em',
                      background: statusPillColor.bg,
                      border: `1px solid ${statusPillColor.border}`,
                      color: statusPillColor.color,
                      flexShrink: 0,
                      animation: status === 'testing' ? 'set-badge-pulse 1.4s ease-in-out infinite' : 'none',
                    }}
                  >{statusPillLabel}</span>
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
                          <input
                            className="field-input"
                            value={p.name ?? ''}
                            onChange={(e) => updateProviderField('openai-compatible', 'name', e.target.value)}
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
                const iconBtnStyle = {
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 30, height: 30, borderRadius: 8,
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                };
                return (
                  <div key={p.type} className="settings-provider-row" style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 380px auto',
                    gap: 24,
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
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '5px 0' }}>
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
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '5px 0', gap: 10 }}>
                        {status === 'fail' && friendlyError && (
                          <span style={{ fontSize: 11.5, color: '#E07060' }}>{friendlyError}</span>
                        )}
                        {statusPill}
                      </div>
                    )}

                    {/* Right: trash + edit buttons */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 30 }}>
                      {!PROTECTED_PROVIDER_TYPES.has(p.type) && (
                        <button
                          type="button"
                          onClick={() => removeProvider(p.type)}
                          title="Remove this provider"
                          style={{ ...iconBtnStyle, color: '#E07060' }}
                        >{Ico.trash(13)}</button>
                      )}
                      {!showKeyInput && (
                        <button
                          type="button"
                          onClick={() => setEditingProviders((prev) => new Set([...prev, p.type]))}
                          title="Edit API key"
                          style={{ ...iconBtnStyle, color: 'var(--ink-3)' }}
                        >{Ico.edit(13)}</button>
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
                <button
                  className="btn-secondary"
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
                >{Ico.plus(13)} Add provider</button>

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
                    <button
                      key={t}
                      type="button"
                      onClick={() => addProviderOfType(t)}
                      className="btn-secondary"
                      title={PROVIDER_TYPE_DESC[t]}
                      style={{ fontSize: 12.5, padding: '4px 10px', fontWeight: 400 }}
                    >{typeLabels[t] || t}</button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAddPickerOpen(false)}
                    title="Hide the provider picker."
                    aria-label="Close provider picker"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 26, height: 26, marginLeft: 4, borderRadius: 6,
                      background: 'transparent', border: 0,
                      color: 'var(--text-muted)', cursor: 'pointer',
                    }}
                  >{Ico.close(13)}</button>
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
                  const cur = roleOverride(role) || {};
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
                  const fallbackPair = recommendedPair[curType] || ['', ''];
                  const fallbackModel = fallbackPair[role === 'planning' ? 0 : 1] || '';
                  const curModel = providerWasRepointed ? fallbackModel : roleModelValue(role, fallbackModel);
                  const provider = providers.find((p) => p.type === curType);
                  const modelList = recommendedModels[curType] || [];
                  // Per-model availability (settings.modelEnabled, sourced from MindsHub
                  // /v1/models). A model the user's tier can't use is listed here as
                  // false so we render it greyed + non-selectable — an upgrade prompt.
                  // Absent id ⇒ available (backwards compatible; direct providers have
                  // no such flag).
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
                  const effortKey = role === 'planning' ? 'planningReasoningEffort' : 'codingReasoningEffort';
                  const harnessSupportsEffort = (settings.harness || 'anton') !== 'hermes';
                  const effortEntry = (settings.modelEfforts || {})[curModel];
                  const effortOptions = effortEntry?.efforts || [];
                  const savedEffort = settings[effortKey];
                  const effortValue = effortOptions.includes(savedEffort)
                    ? savedEffort
                    : (effortEntry?.default || effortOptions[0] || '');
                  const showEffort = harnessSupportsEffort && effortOptions.length > 0;

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
                    setSetting(effortKey, '');
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
                    <Section title={label} subtitle={`Used for ${role === 'planning' ? 'reasoning, orchestration, and responses' : 'scratchpad code generation'}.`} notice={noCreditsNotice}>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {multipleProviders && (
                          <label style={{ display: 'grid', gap: 4 }}>
                            {fieldLabel('Provider')}
                            <select
                              className="settings-select"
                              value={curType}
                              onChange={(e) => {
                                const t = e.target.value;
                                const pair = recommendedPair[t] || ['', ''];
                                const newModel = pair[role === 'planning' ? 0 : 1] || (recommendedModels[t]?.[0] || '');
                                setModelInputMode((m) => ({ ...m, [role]: false }));
                                writeOverride({ providerType: t, model: newModel });
                              }}
                              aria-invalid={providerUnusable || undefined}
                              aria-describedby={providerUnusable ? providerWarnId : undefined}
                              title={`Choose which provider powers the ${role} role.`}
                              style={{ width: '100%', ...(providerUnusable ? { borderColor: '#E07060', boxShadow: '0 0 0 1px rgba(224,112,96,0.45)' } : {}) }}
                            >
                              {providers.map((p) => (
                                <option key={p.type} value={p.type}>{providerDisplayName(p)}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        {modelList.length > 0 ? (
                          (() => {
                            const allowOther = curType !== 'minds-cloud';
                            const savedIsCustom = !!curModel && !modelList.includes(curModel);
                            const inputMode = modelInputMode[role] || savedIsCustom;
                            const selectValue = inputMode ? '__custom__' : curModel;
                            return (
                              <label style={{ display: 'grid', gap: 4 }}>
                                {fieldLabel('Model')}
                                <select
                                  className="settings-select"
                                  value={selectValue || firstEnabledModel}
                                  onChange={(e) => {
                                    if (e.target.value === '__custom__') {
                                      setModelInputMode((m) => ({ ...m, [role]: true }));
                                      writeOverride({ providerType: curType, model: curModel || '' });
                                    } else {
                                      setModelInputMode((m) => ({ ...m, [role]: false }));
                                      writeOverride({ providerType: curType, model: e.target.value });
                                    }
                                  }}
                                  title={`Pick the model used for ${role}. Choose Other… to type a custom model id.`}
                                  style={{ width: '100%' }}
                                >
                                  {modelList.map((m) => (
                                    <option key={m} value={m} disabled={isLocked(m)}>
                                      {modelLabel(m)}{isLocked(m) ? ' — Upgrade to unlock' : ''}
                                    </option>
                                  ))}
                                  {allowOther && <option value="__custom__">Other…</option>}
                                </select>
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
                            <select
                              className="settings-select"
                              value={effortValue}
                              onChange={(e) => { setLlmDirty(true); setSetting(effortKey, e.target.value); }}
                              title={`Reasoning effort for the ${role} model. Higher effort trades latency/cost for deeper reasoning.`}
                              style={{ width: '100%', textTransform: 'capitalize' }}
                            >
                              {effortOptions.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                            </select>
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

  const renderAppearanceSection = () => (
    <SettingsSectionPanel footer={renderSaveFooter()}>
      <CollapsibleGroup title="Appearance">
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
            <Section title="Background" subtitle="Pick a base color — surfaces and text shades derive from it — or follow the Light/Dark theme.">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  type="color"
                  value={customTheme.bg || (theme === 'light' ? '#fafafa' : '#080d18')}
                  onChange={(e) => onCustomThemeChange?.({ ...customTheme, bg: e.target.value })}
                  disabled={customTheme.bg === null}
                  aria-label="Custom background color"
                  style={{ width: 64, height: 32, padding: 2, border: '1px solid var(--line-2)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', opacity: customTheme.bg === null ? 0.45 : 1 }}
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={customTheme.bg === null}
                    onChange={(e) => onCustomThemeChange?.({ ...customTheme, bg: e.target.checked ? null : (theme === 'light' ? '#fafafa' : '#080d18') })}
                  />
                  Follow Light/Dark
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
          <TextInput
            value={settings.greeting}
            onChange={(v) => setSetting('greeting', v)}
            title="Shown above the task input when you start a new task."
            ariaLabel="Greeting text"
          />
        </Section>
        <div className="settings-hide-mobile">
          <Section title="Animated background" subtitle="Toggle off if you prefer a flat surface instead of an animated grid.">
            <Switch
              checked={settings.showDots}
              onCheckedChange={(v) => setSetting('showDots', v)}
              title="Toggle the animated grid background."
              aria-label="Animated background"
            />
          </Section>
          <Section title="Show nav-panel counters" subtitle="Badge counts on Projects / Scheduled / Artifacts / Connected apps, plus the time-since label on each Recent row.">
            <Switch
              checked={settings.showCounters !== false}
              onCheckedChange={(v) => setSetting('showCounters', v)}
              title="Show badge counts on Projects, Scheduled, Artifacts and Connected apps."
              aria-label="Nav-panel counters"
            />
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
        border: '1px solid var(--border-subtle)', borderRadius: 10,
        background: 'var(--surface-glass)',
        WebkitBackdropFilter: 'blur(var(--surface-glass-blur))',
        backdropFilter: 'blur(var(--surface-glass-blur))',
        marginBottom: 14, overflow: 'hidden', padding: '0 18px 8px',
      }}>
        <Section
          title="Current version"
          subtitle="The app, UI bundle, and server versions currently running."
        >
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            fontFamily: 'var(--font-mono)', fontSize: 12.5,
            color: 'var(--text-strong)',
          }}>
            <span>
              <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>App</span>
              {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '—'}
            </span>
            {isElectron && uiVersion && uiVersion !== 'bundled' && uiVersion !== 'web' && (
              <span>
                <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>UI</span>
                {uiVersion}
                {uiVersion !== (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '') && (
                  <span style={{ color: 'var(--text-warning, #c49000)', marginLeft: 6, fontSize: 11 }}>
                    (differs from app)
                  </span>
                )}
              </span>
            )}
            {isElectron && uiVersion === 'bundled' && (
              <span>
                <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>UI</span>
                bundled
              </span>
            )}
            {serverVersion && (
              <span>
                <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>Server</span>
                {serverVersion}
              </span>
            )}
          </div>
        </Section>
        <Section
          title="UI updates"
          subtitle="How over-the-air UI updates are applied when a new version is published. Server updates are always applied automatically on launch."
        >
          <ToggleGroup
            value={settings.uiUpdateMode ?? 'auto'}
            onValueChange={(v) => setSetting('uiUpdateMode', v)}
            aria-label="UI update mode"
            options={[
              { value: 'auto', label: 'Auto', title: 'Download and apply UI updates automatically.' },
              { value: 'manual', label: 'Manual', title: 'Only apply UI updates when triggered manually.' },
            ]}
          />
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
    const exitCode = diag?.lastExitCode;
    const startedAt = diag?.lastStartAt
      ? new Date(diag.lastStartAt).toLocaleTimeString()
      : null;

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
        <button type="button" onClick={refreshDiag} title="Refresh diagnostics"
          style={{ cursor: 'pointer', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-2)', padding: '7px 14px', borderRadius: 7, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500 }}
        >Refresh</button>
        {(onStartServer || onStopServer) && state !== 'offline' && (
          <button type="button" onClick={handleBackendStop} disabled={diagBusy || serverBusy || !onStopServer}
            style={{ cursor: (diagBusy || serverBusy) ? 'progress' : 'pointer', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-2)', padding: '7px 14px', borderRadius: 7, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, opacity: (diagBusy || serverBusy) ? 0.7 : 1 }}
          >{(diagBusy && serverBusyKind === 'stopping') ? 'Stopping…' : 'Stop backend'}</button>
        )}
        {(onStartServer || onStopServer) && (
          <button type="button" onClick={state === 'offline' ? handleBackendStart : handleBackendRestart}
            disabled={diagBusy || serverBusy || (state === 'offline' ? !onStartServer : !(onStartServer && onStopServer))}
            style={{ cursor: (diagBusy || serverBusy) ? 'progress' : 'pointer', background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff', padding: '7px 14px', borderRadius: 7, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, opacity: (diagBusy || serverBusy) ? 0.7 : 1 }}
          >{diagBusy ? (state === 'offline' ? 'Starting…' : 'Restarting…') : (state === 'offline' ? 'Start backend' : 'Restart backend')}</button>
        )}
      </>
    );

    return (
      <SettingsSectionPanel footer={backendFooter}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Status card — status header + port + logs */}
          <div style={{
            border: '1px solid var(--border-subtle)', borderRadius: 10,
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
                  <span style={{ color: 'var(--ink)' }}>{exitCode ?? '—'}</span>
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

          {state === 'offline' && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              Common causes: a stale process holding port {port ?? 26866}, a missing Python interpreter (re-run the installer), or a crash in a route handler. Restart the backend below — if it keeps failing, copy the log and share it for support.
            </div>
          )}


        </div>
      </SettingsSectionPanel>
    );
  };

  const renderAccountSection = () => {
    const CARD = {
      border: '1px solid var(--border-subtle)', borderRadius: 10,
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
            { icon: <svg width="17" height="13" viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15.5 12H5a4 4 0 0 1-.5-7.97A5 5 0 0 1 14.5 6h1a3 3 0 0 1 0 6Z" /></svg>, label: 'Publish & collaborate', desc: 'Share dashboards, reports, and artifacts — and work on them together.' },
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

        {/* CTA */}
        <button
          type="button"
          onClick={onSsoSignIn}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '10px 20px', borderRadius: 9, border: 'none',
            background: 'var(--accent, #5d9287)',
            color: '#fff',
            fontSize: 14, fontWeight: 650, fontFamily: 'inherit',
            cursor: 'pointer',
            boxShadow: '0 2px 12px color-mix(in srgb, var(--accent, #5d9287) 40%, transparent)',
            transition: 'opacity 120ms ease, box-shadow 120ms ease',
          }}
          onMouseOver={(e) => { e.currentTarget.style.opacity = '0.88'; }}
          onMouseOut={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          Sign in / Sign up to MindsHub
        </button>
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
              <button type="button" onClick={() => setLogoutConfirmOpen(true)} disabled={loggingOut} title="Sign out and clear stored credentials"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#E07060', background: 'rgba(224,112,96,0.08)', border: '1px solid rgba(224,112,96,0.35)', cursor: loggingOut ? 'progress' : 'pointer', fontFamily: 'inherit', opacity: loggingOut ? 0.7 : 1 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </Section>
        </div>}
      </SettingsSectionPanel>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
      <SettingsNav section={section} onSectionChange={onSectionChange} serverOnline={serverOnline} />

      {section === 'agent' && renderAgentSection()}
      {section === 'appearance' && renderAppearanceSection()}
      {section === 'channels' && renderChannelsSection()}
      {section === 'updates' && renderUpdatesSection()}
      {section === 'backend' && renderBackendSection()}
      {section === 'account' && renderAccountSection()}

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
    </div>
  );
}
