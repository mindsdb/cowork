// `<SkillShareMenu>` — a skill's Share dropdown inside a hosted org
// (ENG-3787): an anchored popover, the same pattern as the artifact publish
// dropdown (PublishMenu), holding the shared `<AudiencePanel>` through
// `<SkillAudienceFields>`: Only me, Everyone at ‹org›, or Specific teams and
// people, plus "Always include in every task" where it applies.
//
// The footer says "Up to date" until the audience differs from the skill's,
// then offers Update. A refusal (400 someone outside the org, 403 not an
// admin) shows in place and keeps the dropdown open; a success closes it.
//
// Only the owner or an admin changes who a skill reaches
// (`canChangeSkillAudience`). Anyone else it opens for, such as a member of a
// team the skill is shared with, gets "Always include in every task" alone,
// and Update sends `always_on` alone.
//
//   <SkillShareMenu skill={skill} capabilities={caps} onSave={save}
//     trigger={<Button>Share</Button>} tooltip="Shared with 2 teams" />

import { cloneElement, useEffect, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Alert, Button, Spinner, Tooltip } from './ui';
import SkillAudienceFields, { AlwaysOnRow } from './SkillAudienceFields';
import {
  alwaysOnLockReason, canBeAlwaysOn, canChangeSkillAudience, canEditSkill, sameSkillAccessPayload,
  skillAccess, skillAccessPayload,
} from '../lib/orgSharing';
import { UpToDateTag } from './UpToDateTag';

export const SKILL_SHARE_TITLE = 'Who can use this skill';
const AUDIENCE_LOCKED_NOTE = 'Only its owner or an admin can change who can use it.';

/**
 * @param {{
 *   skill: object,
 *   capabilities: { can_share_org?: boolean, org_name?: string | null },
 *   onSave: (access: { org_allowed: boolean, allowed_team_ids: string[], allowed_user_ids: string[], always_on: boolean } | { always_on: boolean }) => Promise<void>,
 *   trigger: import('react').ReactElement,
 *   tooltip?: string | null,
 *   align?: 'start' | 'center' | 'end',
 * }} props
 */
export function SkillShareMenu({ skill, capabilities, onSave, trigger, tooltip = null, align = 'end' }) {
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState(() => skillAccess(skill));
  // "Specific teams and people" picked with nobody in it: Update waits.
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Bumped on each open so the fields re-seed from the skill.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!open) return;
    setAccess(skillAccess(skill));
    setPending(false);
    setBusy(false);
    setError('');
    setGeneration((g) => g + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, skill?.label]);

  const saved = skillAccess(skill);
  const audienceLocked = !canChangeSkillAudience(skill);
  const payload = audienceLocked ? { always_on: access.alwaysOn === true } : skillAccessPayload(access);
  const changed = audienceLocked
    ? access.alwaysOn !== saved.alwaysOn
    : !sameSkillAccessPayload(payload, skillAccessPayload(saved));

  const update = async () => {
    if (busy || pending || !changed) return;
    setBusy(true);
    setError('');
    try {
      await onSave(payload);
      setOpen(false);
    } catch (err) {
      setError(err?.message || "Couldn't change who can use this skill.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      {/* Who it's shared with, on hover; not over the open dropdown. The
          tooltip sits inside the trigger's render so the popover keeps its
          anchor. */}
      <Popover.Trigger
        render={(props) => (
          <Tooltip content={open ? null : tooltip}>{cloneElement(trigger, props)}</Tooltip>
        )}
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align={align} sideOffset={8} style={{ zIndex: 90 }}>
          <Popover.Popup
            aria-label={skill ? `Share ${skill.label}` : 'Share'}
            className="flex max-h-[min(640px,80vh)] flex-col overflow-hidden rounded-[14px] bg-surface font-body outline-none"
            style={{ width: 'min(380px, 92vw)', boxShadow: 'var(--sh-popup)' }}
          >
            <div className="flex items-baseline justify-between gap-2 py-3 px-4 border-b border-t-0 border-x-0 border-solid border-line">
              <span className="s-h3">{SKILL_SHARE_TITLE}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="bg-transparent border-0 cursor-pointer p-0 font-body text-sm font-medium text-accent"
              >Dismiss</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-3 px-4">
              {open && (audienceLocked ? (
                <div className="flex flex-col gap-3">
                  <p className="m-0 font-body text-[12px] text-ink-3" role="note">{AUDIENCE_LOCKED_NOTE}</p>
                  {canBeAlwaysOn(saved) && (
                    <AlwaysOnRow
                      checked={access.alwaysOn}
                      onCheckedChange={(next) => setAccess((current) => ({ ...current, alwaysOn: next }))}
                      lockReason={alwaysOnLockReason(saved, {
                        canShareOrg: capabilities?.can_share_org === true,
                        canEdit: canEditSkill(skill),
                      })}
                    />
                  )}
                </div>
              ) : (
                <SkillAudienceFields
                  key={`${skill?.label}:${generation}`}
                  value={access}
                  onChange={setAccess}
                  capabilities={capabilities}
                  canEdit={canEditSkill(skill)}
                  onPendingChange={setPending}
                />
              ))}
            </div>
            {error && <Alert variant="danger" className="mx-4 mb-3">{error}</Alert>}
            <div className="flex items-center justify-end gap-2 py-3 px-4 border-t border-b-0 border-x-0 border-solid border-line">
              {changed ? (
                <Button variant="primary" onClick={update} disabled={busy || pending}>
                  {busy && <Spinner style={{ color: 'currentColor' }} />}
                  {busy ? 'Updating…' : 'Update'}
                </Button>
              ) : <UpToDateTag />}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default SkillShareMenu;
