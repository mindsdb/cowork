// AccessChooser — the "Who can access your app" picker.
//
// One controlled component shared by every publish surface (the viewer's
// inline publish popover and the Artifacts grid dialog) so the
// Public / Password / Restricted logic — and its validation — lives in
// exactly one place. Built on Base UI's RadioGroup/Radio for real
// radiogroup semantics + arrow-key navigation; skinned inline with the
// app's `--accent` / `--surface` / `--line` tokens so it stays
// theme-aware without a bespoke stylesheet.
//
// Controlled via a single `value` draft + `onChange`:
//   const [draft, setDraft] = useState(accessDraftFromArtifact(artifact));
//   <AccessChooser value={draft} onChange={setDraft} />
//   // on confirm: publish(buildAccessPayload(draft))

import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import Ico from '../../Icons';
import { Checkbox, Textarea, Tooltip } from '../../ui';

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "var(--font-mono)";

// Static style objects — hoisted to module scope so they aren't re-created on
// every render (the values never depend on props).
const INPUT_SHELL = {
  display: 'flex', alignItems: 'center', gap: 6,
  background: 'var(--surface-2)', border: '1px solid var(--line)',
  borderRadius: 8, padding: '0 8px 0 10px',
};
const BARE_INPUT = {
  flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none',
  color: 'var(--ink)', fontFamily: FONT_MONO, fontSize: 13, padding: '9px 0',
};

// ── Access-draft helpers (the contract between UI and the publish API) ──

// Seed a draft from an artifact's current (owner-side) access state, so
// re-opening the chooser pre-selects what's already live.
export function accessDraftFromArtifact(artifact) {
  const mode = artifact?.accessMode || (artifact?.accessProtected ? 'password' : 'public');
  return {
    mode,
    password: artifact?.accessPassword || '',
    emailsText: (artifact?.accessEmails || []).join(', '),
    orgAllowed: !!artifact?.orgAllowed,
  };
}

// Loose-but-practical email shape check. Splits on whitespace, commas and
// semicolons; trims, lowercases, de-dupes; partitions valid vs invalid.
const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function parseEmailList(raw) {
  const parts = (raw || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    (_EMAIL_RE.test(p) ? valid : invalid).push(p);
  }
  return { valid, invalid };
}

// Whether the draft can be submitted: public always, password needs a
// non-empty secret, restricted needs at least one recipient or the org.
export function isAccessDraftValid(draft) {
  if (!draft) return false;
  if (draft.mode === 'public') return true;
  if (draft.mode === 'password') return (draft.password || '').trim().length > 0;
  if (draft.mode === 'restricted') {
    const { valid } = parseEmailList(draft.emailsText);
    return valid.length > 0 || !!draft.orgAllowed;
  }
  return false;
}

// Turn a draft into the `access` payload `publishArtifact` expects.
export function buildAccessPayload(draft) {
  if (draft?.mode === 'password') return { mode: 'password', password: (draft.password || '').trim() };
  if (draft?.mode === 'restricted') {
    const { valid } = parseEmailList(draft.emailsText);
    return { mode: 'restricted', emails: valid, org_allowed: !!draft.orgAllowed };
  }
  return { mode: 'public' };
}

// ── Presentation ───────────────────────────────────────────────────────

function OptionCard({ value, active, icon, title, desc }) {
  return (
    <Radio.Root
      value={value}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        textAlign: 'left', cursor: 'pointer',
        padding: '10px 12px', borderRadius: 'var(--card-radius)',
        background: active ? 'var(--accent-bg)' : 'var(--surface-2)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      <span style={{
        display: 'inline-grid', placeItems: 'center', flexShrink: 0,
        width: 30, height: 30, borderRadius: 8,
        background: 'var(--surface)', border: '1px solid var(--line)',
        color: active ? 'var(--accent)' : 'var(--ink-3)',
      }}>{icon}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{title}</span>
        <span style={{ display: 'block', fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-3)', marginTop: 1 }}>{desc}</span>
      </span>
      {/* Radio dot — driven by the controlled `active` so it stays a
          plain inline style (no data-attribute stylesheet). */}
      <span style={{
        flexShrink: 0, width: 16, height: 16, borderRadius: 999,
        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--ink-4)'}`,
        display: 'inline-grid', placeItems: 'center',
        transition: 'border-color 120ms ease',
      }}>
        {active && <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--accent)' }} />}
      </span>
    </Radio.Root>
  );
}

// `modes` lets a caller restrict the offered set (e.g. ['public','password']);
// defaults to all three. `value`/`onChange` are the controlled draft.
export function AccessChooser({
  value,
  onChange,
  modes = ['public', 'password', 'restricted'],
  onSubmit,
}) {
  const draft = value;
  const set = (patch) => onChange?.({ ...draft, ...patch });
  const { valid: parsedEmails, invalid: invalidEmails } = parseEmailList(draft.emailsText);

  return (
    <div>
      <RadioGroup
        value={draft.mode}
        onValueChange={(m) => set({ mode: m })}
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        aria-label="Who can access your app"
      >
        {modes.includes('public') && (
          <OptionCard value="public" active={draft.mode === 'public'} icon={Ico.globe(16)}
            title="Public" desc="Anyone on the internet with the URL" />
        )}
        {modes.includes('password') && (
          <OptionCard value="password" active={draft.mode === 'password'} icon={Ico.lock(16)}
            title="Password protected" desc="Anyone on the internet with the password" />
        )}
        {modes.includes('restricted') && (
          <OptionCard value="restricted" active={draft.mode === 'restricted'} icon={Ico.people(16)}
            title="For selected users" desc="Only people you list — or your whole org" />
        )}
      </RadioGroup>

      {draft.mode === 'password' && (
        <div style={{ marginTop: 8 }}>
          <div style={INPUT_SHELL}>
            <input
              type={draft._reveal ? 'text' : 'password'}
              value={draft.password}
              onChange={(e) => set({ password: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && isAccessDraftValid(draft)) onSubmit?.(); }}
              autoFocus
              placeholder="Add a password"
              style={BARE_INPUT}
            />
            <Tooltip content={draft._reveal ? 'Hide' : 'Show'}>
              <button type="button" onClick={() => set({ _reveal: !draft._reveal })}
                aria-label={draft._reveal ? 'Hide password' : 'Show password'}
                style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--ink-4)', display: 'inline-flex', padding: 4 }}>
                {draft._reveal ? Ico.eyeOff(15) : Ico.eye(15)}
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {draft.mode === 'restricted' && (
        <div style={{ marginTop: 8 }}>
          <Textarea
            value={draft.emailsText}
            onChange={(v) => set({ emailsText: v })}
            autoFocus
            rows={3}
            placeholder="alice@acme.com, bob@acme.com"
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8,
              color: 'var(--ink)', fontFamily: FONT_MONO, fontSize: 13, padding: '9px 10px', outline: 'none',
            }}
          />
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
            {parsedEmails.length} recipient{parsedEmails.length === 1 ? '' : 's'}
            {invalidEmails.length ? ` · ${invalidEmails.length} invalid ignored` : ''}
            {' '}· comma- or newline-separated.
          </div>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer',
            fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink)',
          }}>
            <Checkbox checked={draft.orgAllowed}
              onCheckedChange={(v) => set({ orgAllowed: v })}
              aria-label="Everyone in my organization" />
            Everyone in my organization
          </label>
        </div>
      )}
    </div>
  );
}

export default AccessChooser;
