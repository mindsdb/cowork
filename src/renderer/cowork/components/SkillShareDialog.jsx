// `<SkillShareDialog>` — who a skill reaches inside a hosted org (ENG-3787):
// only the caller, specific people, teams, or everyone at the org. The three
// audiences combine; "Only me" is the state with none of them, and picking it
// clears the rest. A skill reaching the whole org or a team can also be made
// "always on": part of every task for everyone it reaches, instead of being
// recalled when it's relevant.

import { useEffect, useState } from 'react';
import Ico from './Icons';
import { Alert, Button, Checkbox, Input, Spinner, Tooltip } from './ui';
import { Switch } from './ui/Switch';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import { useHubTeams } from '../hooks/useOrgSharing';
import TeamPicker from './TeamPicker';
import {
  ALWAYS_ON_HELP,
  ALWAYS_ON_LABEL,
  ORG_ADMIN_ONLY_HINT,
  SHARING_NOTE,
  alwaysOnLockReason,
  audiencePayload,
  canBeAlwaysOn,
  canEditSkill,
  everyoneAtLabel,
  isPrivateAudience,
  parseEmailInput,
  skillAudience,
} from '../lib/orgSharing';

function AlwaysOnRow({ checked, onCheckedChange, lockReason }) {
  const control = (
    <div className="flex items-center justify-between gap-3">
      <span className="font-body text-[13px] font-semibold text-ink">{ALWAYS_ON_LABEL}</span>
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={!!lockReason}
        aria-label={ALWAYS_ON_LABEL}
      />
    </div>
  );
  return (
    <div className="flex flex-col gap-1 rounded-card border border-solid border-line bg-surface-2 py-[10px] px-3">
      {lockReason ? (
        // A disabled switch fires no hover of its own, so the hint hangs off
        // a wrapper.
        <Tooltip content={lockReason}>
          <div data-testid="always-on-locked">{control}</div>
        </Tooltip>
      ) : control}
      <span className="font-body text-[11.5px] text-ink-3">{ALWAYS_ON_HELP}</span>
    </div>
  );
}

function OptionRow({ label, description, checked, onCheckedChange, disabled = false, children }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-solid border-line bg-surface-2 py-[10px] px-3">
      <div>
        <label className={`flex items-center gap-[10px] font-body text-[13px] font-semibold text-ink ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
          <Checkbox checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
          {label}
        </label>
        {description && <span className="block pl-[26px] font-body text-[11.5px] text-ink-3 mt-px">{description}</span>}
      </div>
      {checked && children && <div className="pl-[26px]">{children}</div>}
    </div>
  );
}

// Typed addresses become chips on Enter, comma or blur. Anything that isn't
// an email stays in the box with a note, so nothing is dropped silently.
function EmailChips({ emails, onChange, onPendingChange }) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState([]);

  const commit = () => {
    const { valid, invalid: bad } = parseEmailInput(text, emails);
    if (valid.length) onChange([...emails, ...valid]);
    setInvalid(bad);
    setText(bad.join(', '));
    onPendingChange(bad.length > 0);
  };

  return (
    <div className="flex flex-col gap-2">
      {emails.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-wrap gap-[6px]" aria-label="People">
          {emails.map((email) => (
            <li key={email} className="inline-flex items-center gap-1 rounded-full border border-solid border-line bg-surface py-[2px] pl-[10px] pr-1 font-body text-[12px] text-ink">
              {email}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={() => onChange(emails.filter((e) => e !== email))}
                className="inline-flex bg-transparent border-0 cursor-pointer p-[2px] text-ink-4"
              >{Ico.close(12)}</button>
            </li>
          ))}
        </ul>
      )}
      <Input
        aria-label="Add people by email"
        value={text}
        placeholder="name@company.com"
        onChange={(v) => {
          setText(v);
          if (invalid.length) setInvalid([]);
          onPendingChange(v.trim().length > 0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
        }}
        onBlur={commit}
      />
      {invalid.length > 0 && (
        <span className="font-body text-xs text-danger" role="alert">
          {invalid.length === 1 ? `Not an email: ${invalid[0]}` : `Not emails: ${invalid.join(', ')}`}
        </span>
      )}
    </div>
  );
}

/**
 * @param {{
 *   skill: object | null,
 *   capabilities: { can_share_org: boolean, org_name: string | null },
 *   onClose: () => void,
 *   onSave: (audience: { org: boolean, team_ids: string[], emails: string[], always_on: boolean }) => Promise<void>,
 * }} props
 */
export function SkillShareDialog({ skill, capabilities, onClose, onSave }) {
  const open = !!skill;
  const [audience, setAudience] = useState(() => skillAudience(skill));
  // Text in the email box that hasn't become a chip, so Save waits for it.
  const [emailPending, setEmailPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Teams load only while the dialog is open.
  const teamsState = useHubTeams(open);
  // Which audience rows are open, apart from whether they name anyone yet,
  // so ticking "Teams" shows the list before a team is picked.
  const [showPeople, setShowPeople] = useState(false);
  const [showTeams, setShowTeams] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial = skillAudience(skill);
    setAudience(initial);
    setShowPeople(initial.emails.length > 0);
    setShowTeams(initial.teamIds.length > 0);
    setEmailPending(false);
    setBusy(false);
    setError('');
  }, [open, skill?.label]);

  const orgName = capabilities?.org_name ?? null;
  const canShareOrg = capabilities?.can_share_org === true;
  const canEdit = canEditSkill(skill);
  // Always on resets to off once neither the org nor a team is picked.
  const set = (patch) => setAudience((current) => {
    const next = { ...current, ...patch };
    return canBeAlwaysOn(next) ? next : { ...next, alwaysOn: false };
  });
  const showAlwaysOn = canBeAlwaysOn(audience);
  const onlyMe = isPrivateAudience(audience) && !showPeople && !showTeams;

  const save = async () => {
    if (busy || emailPending) return;
    setBusy(true);
    setError('');
    try {
      await onSave(audiencePayload(audience));
    } catch (err) {
      setError(err?.message || "Couldn't change who can use this skill.");
    } finally {
      setBusy(false);
    }
  };

  const orgRow = (
    <OptionRow
      label={everyoneAtLabel(orgName)}
      description="Everyone in the organization can use it."
      checked={audience.org}
      disabled={!canShareOrg}
      onCheckedChange={(next) => set({ org: next })}
    />
  );

  return (
    <Modal open={open} onClose={onClose} width="min(480px, 94vw)" labelledBy="skill-share-title">
      <ModalHeader
        id="skill-share-title"
        title={skill ? `Share ${skill.label}` : 'Share'}
        subtitle="Choose who can use this skill. Only you can change it."
        onClose={onClose}
      />
      <ModalBody padding="20px">
        <div className="flex flex-col gap-2">
          <OptionRow
            label="Only me"
            description="Nobody else can use it."
            checked={onlyMe}
            disabled={onlyMe}
            onCheckedChange={(next) => {
              if (!next) return;
              setAudience({ org: false, teamIds: [], emails: [], alwaysOn: false });
              setShowPeople(false);
              setShowTeams(false);
              setEmailPending(false);
            }}
          />
          <OptionRow
            label="Specific people"
            description="People you add by email."
            checked={showPeople}
            onCheckedChange={(next) => {
              setShowPeople(next);
              if (!next) { set({ emails: [] }); setEmailPending(false); }
            }}
          >
            <EmailChips
              emails={audience.emails}
              onChange={(emails) => set({ emails })}
              onPendingChange={setEmailPending}
            />
          </OptionRow>
          <OptionRow
            label="Teams"
            description="Everyone in the teams you pick."
            checked={showTeams}
            onCheckedChange={(next) => {
              setShowTeams(next);
              if (!next) set({ teamIds: [] });
            }}
          >
            <TeamPicker teamsState={teamsState} teamIds={audience.teamIds} onChange={(teamIds) => set({ teamIds })} />
          </OptionRow>
          {canShareOrg ? orgRow : (
            // A disabled control fires no hover of its own, so the hint hangs
            // off a wrapper.
            <Tooltip content={ORG_ADMIN_ONLY_HINT}>
              <div data-testid="org-option-locked">{orgRow}</div>
            </Tooltip>
          )}
          {showAlwaysOn && (
            <AlwaysOnRow
              checked={audience.alwaysOn}
              onCheckedChange={(next) => set({ alwaysOn: next })}
              lockReason={alwaysOnLockReason(audience, { canShareOrg, canEdit })}
            />
          )}
          <p className="m-0 mt-1 font-body text-xs text-ink-3" role="note">{SHARING_NOTE}</p>
          {error && <Alert variant="danger">{error}</Alert>}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy || emailPending}>
          {busy && <Spinner style={{ color: 'currentColor' }} />}
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default SkillShareDialog;
