// Controlled by value/onChange. Initialize with accessDraftFromArtifact; submit with
// buildAccessPayload.

import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import Ico from '../../Icons';
import { Checkbox, Textarea, Tooltip } from '../../ui';

const FONT_MONO = "var(--font-mono)";

const INPUT_SHELL = 'flex items-center gap-[6px] bg-surface-2 border border-solid border-line rounded-card-row pt-0 pr-2 pb-0 pl-[10px]';
const BARE_INPUT = 'flex-1 min-w-0 bg-transparent border-0 [outline:none] text-ink font-[family-name:var(--font-mono)] text-[13px] py-[9px] px-0';


// ownerOnly is UI-only; map it to restricted with an empty audience on the wire, and derive it on
// reads.
export function accessDraftFromArtifact(artifact) {
  const serverMode = artifact?.accessMode || (artifact?.accessProtected ? 'password' : 'public');
  const mode = serverMode === 'restricted' && isOwnerOnlySelection(artifact)
    ? 'ownerOnly'
    : serverMode;
  return {
    mode,
    password: artifact?.accessPassword || '',
    emailsText: (artifact?.accessEmails || []).join(', '),
    orgAllowed: !!artifact?.orgAllowed,
  };
}

// "Only me" on the wire is `restricted` with no recipients and no org. The
// server also sends an explicit `ownerOnly`; prefer it, and fall back to the
// derivation for a record written before that flag existed.
export function isOwnerOnlySelection(artifact) {
  if (artifact?.ownerOnly != null) return !!artifact.ownerOnly;
  return (artifact?.accessEmails || []).length === 0 && !artifact?.orgAllowed;
}

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

// Validate each access mode without silently discarding malformed addresses, which could change the
// intended audience.
export function isAccessDraftValid(draft) {
  if (!draft) return false;
  if (draft.mode === 'public') return true;
  if (draft.mode === 'ownerOnly') return true;
  if (draft.mode === 'password') return (draft.password || '').trim().length > 0;
  if (draft.mode === 'restricted') {
    const { valid, invalid } = parseEmailList(draft.emailsText);
    if (invalid.length) return false;
    // An empty Specific people selection is incomplete; Only you is now an explicit separate
    // option.
    return valid.length > 0 || !!draft.orgAllowed;
  }
  return false;
}

// Translate the UI draft to the publish API access payload.
export function buildAccessPayload(draft) {
  if (draft?.mode === 'password') return { mode: 'password', password: (draft.password || '').trim() };
  // Collapse the UI mode back to the wire shape. `owner_only` is load-bearing:
  // `restricted` with neither emails nor an org would otherwise be read as an
  // empty selection and degrade to public — the exact opposite of the choice.
  if (draft?.mode === 'ownerOnly') {
    return { mode: 'restricted', emails: [], org_allowed: false, owner_only: true };
  }
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


// Share access labels with PublishMenu’s summary so wording stays consistent.
export const ACCESS_LABELS = {
  public: { icon: Ico.globe, title: 'Public', desc: 'Anyone on the internet with the URL' },
  password: { icon: Ico.lock, title: 'Password protected', desc: 'Anyone on the internet with the password' },
  restricted: {
    icon: Ico.people,
    title: 'Specific people',
    desc: 'Only the people you list — or your whole org',
  },
  ownerOnly: { icon: Ico.lock, title: 'Only you', desc: 'Nobody else can open this' },
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

export function AccessChooser({
  value,
  onChange,
  // Order runs private → public, so the least exposing choice is the one the
  // eye lands on first.
  modes = ['ownerOnly', 'restricted', 'password', 'public'],
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
        {modes.includes('ownerOnly') && (
          <OptionCard value="ownerOnly" active={draft.mode === 'ownerOnly'} icon={Ico.lock(16)}
            title={ACCESS_LABELS.ownerOnly.title} desc={ACCESS_LABELS.ownerOnly.desc} />
        )}
        {modes.includes('restricted') && (
          <OptionCard value="restricted" active={draft.mode === 'restricted'} icon={Ico.people(16)}
            title={ACCESS_LABELS.restricted.title} desc={ACCESS_LABELS.restricted.desc} />
        )}
        {modes.includes('password') && (
          <OptionCard value="password" active={draft.mode === 'password'} icon={Ico.lock(16)}
            title={ACCESS_LABELS.password.title} desc={ACCESS_LABELS.password.desc} />
        )}
        {modes.includes('public') && (
          <OptionCard value="public" active={draft.mode === 'public'} icon={Ico.globe(16)}
            title={ACCESS_LABELS.public.title} desc={ACCESS_LABELS.public.desc} />
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
                ? 'Add someone, or choose “Only you”'
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
