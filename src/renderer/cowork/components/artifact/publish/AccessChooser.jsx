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

const FONT_MONO = "var(--font-mono)";

// Shared class strings for the bare-input shell (a bordered row wrapping an
// unstyled <input>), so the password field and any future inputs stay in sync.
const INPUT_SHELL = 'flex items-center gap-[6px] bg-surface-2 border border-solid border-line rounded-card-row pt-0 pr-2 pb-0 pl-[10px]';
const BARE_INPUT = 'flex-1 min-w-0 bg-transparent border-0 [outline:none] text-ink font-[family-name:var(--font-mono)] text-[13px] py-[9px] px-0';

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
// non-empty secret, restricted needs input that isn't malformed. An empty
// restricted selection is an explicit owner-only publish (ENG-1769); a
// malformed address blocks submission rather than being dropped, which would
// silently publish to the owner alone.
export function isAccessDraftValid(draft) {
  if (!draft) return false;
  if (draft.mode === 'public') return true;
  if (draft.mode === 'password') return (draft.password || '').trim().length > 0;
  if (draft.mode === 'restricted') {
    const { invalid } = parseEmailList(draft.emailsText);
    return invalid.length === 0;
  }
  return false;
}

// Turn a draft into the `access` payload `publishArtifact` expects. `owner_only`
// is derived, never stored on the draft: the textarea is the source of truth.
export function buildAccessPayload(draft) {
  if (draft?.mode === 'password') return { mode: 'password', password: (draft.password || '').trim() };
  if (draft?.mode === 'restricted') {
    const { valid } = parseEmailList(draft.emailsText);
    const orgAllowed = !!draft.orgAllowed;
    return {
      mode: 'restricted',
      emails: valid,
      org_allowed: orgAllowed,
      owner_only: valid.length === 0 && !orgAllowed,
    };
  }
  return { mode: 'public' };
}

// ── Presentation ───────────────────────────────────────────────────────

// Single source of truth for the access option copy. PublishMenu imports this
// for its summary card, so the wording can't drift between the picker and the
// "currently published as" view.
export const ACCESS_LABELS = {
  public: { icon: Ico.globe, title: 'Public', desc: 'Anyone on the internet with the URL' },
  password: { icon: Ico.lock, title: 'Password protected', desc: 'Anyone on the internet with the password' },
  restricted: {
    icon: Ico.people,
    title: 'For you and selected users',
    desc: 'Only you and people you list — or your whole org',
  },
  // Not a mode: the summary variant shown when a restricted publish has no
  // recipients and no org (ENG-1769).
  ownerOnly: { icon: Ico.people, title: 'Only you', desc: 'Nobody else can open this' },
};

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
      <span
        className="inline-grid place-items-center shrink-0 w-[30px] h-[30px] rounded-card-row bg-surface border border-solid border-line"
        style={{ color: active ? 'var(--accent)' : 'var(--ink-3)' }}
      >{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-body font-semibold text-[13px] text-ink">{title}</span>
        <span className="block font-body text-[11.5px] text-ink-3 mt-px">{desc}</span>
      </span>
      {/* Radio dot — driven by the controlled `active` so its border color
          stays a plain inline style (no data-attribute stylesheet). */}
      <span
        className="shrink-0 w-[16px] h-[16px] rounded-full inline-grid place-items-center"
        style={{
          border: `1.5px solid ${active ? 'var(--accent)' : 'var(--ink-4)'}`,
          transition: 'border-color 120ms ease',
        }}
      >
        {active && <span className="w-[8px] h-[8px] rounded-full bg-accent" />}
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
        className="flex flex-col gap-2"
        aria-label="Who can access your app"
      >
        {modes.includes('public') && (
          <OptionCard value="public" active={draft.mode === 'public'} icon={Ico.globe(16)}
            title={ACCESS_LABELS.public.title} desc={ACCESS_LABELS.public.desc} />
        )}
        {modes.includes('password') && (
          <OptionCard value="password" active={draft.mode === 'password'} icon={Ico.lock(16)}
            title={ACCESS_LABELS.password.title} desc={ACCESS_LABELS.password.desc} />
        )}
        {modes.includes('restricted') && (
          <OptionCard value="restricted" active={draft.mode === 'restricted'} icon={Ico.people(16)}
            title={ACCESS_LABELS.restricted.title} desc={ACCESS_LABELS.restricted.desc} />
        )}
      </RadioGroup>

      {draft.mode === 'password' && (
        <div className="mt-2">
          <div className={INPUT_SHELL}>
            <input
              type={draft._reveal ? 'text' : 'password'}
              value={draft.password}
              onChange={(e) => set({ password: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter' && isAccessDraftValid(draft)) onSubmit?.(); }}
              autoFocus
              placeholder="Add a password"
              className={BARE_INPUT}
            />
            <Tooltip content={draft._reveal ? 'Hide' : 'Show'}>
              <button type="button" onClick={() => set({ _reveal: !draft._reveal })}
                aria-label={draft._reveal ? 'Hide password' : 'Show password'}
                className="bg-transparent border-0 cursor-pointer text-ink-4 inline-flex p-1">
                {draft._reveal ? Ico.eyeOff(15) : Ico.eye(15)}
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {draft.mode === 'restricted' && (
        <div className="mt-2">
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
          <div className="font-body text-xs text-ink-4 mt-[6px]">
            {invalidEmails.length
              ? `${invalidEmails.length} invalid — fix to publish: ${invalidEmails.join(', ')}`
              : (parsedEmails.length === 0 && !draft.orgAllowed
                ? 'Only you will have access'
                : `${parsedEmails.length} recipient${parsedEmails.length === 1 ? '' : 's'}`)}
            {' '}· comma- or newline-separated.
          </div>
          <label className="flex items-center gap-2 mt-2 cursor-pointer font-body text-sm text-ink">
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
