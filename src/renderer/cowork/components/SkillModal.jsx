// `<SkillModal>` — Add a Skill / Edit Skill on the Skills page: the label,
// description and instructions on the left; the project and, where sharing
// exists, who can use it on the right. Saving the skill and then applying
// its audience (org sharing, ENG-3787) or its "Who can use it" choice both
// happen here; SkillsView only opens it and reacts to the result.

import { useEffect, useState } from 'react';
import { projectLabel } from '../lib/projectLabel';
import Ico from './Icons';
import { Alert, Button, Field, Select, Input, Textarea } from './ui';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import SkillAudienceFields from './SkillAudienceFields';
import { AudienceList } from './RecipientRows';
import { saveSkillAndSync, setSkillAccessAndSync, setSkillSharingAndSync } from '../lib/skillsStore';
import {
  ALWAYS_ON_BADGE_HINT,
  PRIVATE_ACCESS,
  canChangeSkillAudience,
  canEditSkill,
  isPrivateAccess,
  sameSkillAccessPayload,
  skillAccess,
  skillAccessPayload,
} from '../lib/orgSharing';
import { canUseSharedResource } from '../lib/sharedResourceAccess';
import {
  SKILL_SHARING_CREATE_HINT,
  SKILL_SHARING_LABEL,
  SKILL_SHARING_OPTIONS,
  SKILL_SHARING_PRIVATE,
  canShareSkill,
  isOwnSharedSkill,
  sharedFromValue,
  sharingValue,
} from '../lib/skillSharing';

// Sentinel for the "All projects" choice in the Project <Select>. It must
// be a non-empty string: Base UI's <Select.Value> treats an empty-string value
// as "nothing selected" and shows the placeholder, so an option with value ''
// would render as the "Select…" placeholder on the closed control even though
// its item still carries a checkmark (ENG-1246). This value never reaches
// storage — `submit` maps it back to an empty `projects` array, and it can't
// collide with a real project name.
const ALL_PROJECTS = '__all_projects__';

/* Shown in the detail view and the Edit modal, since an edit or the switch
   reaches every reader at their next answer. */
export const OWN_SHARED_CHANGE_NOTE = "It's shared, so your changes reach everyone it's shared with at their next answer.";

const AUDIENCE_OWNER_ONLY_HINT = 'Only the owner can change who can use it';

/* The text fields' look, shared with the Upload modal. */
export const skillFieldStyle = {
  width: '100%',
  border: '1px solid var(--border-01)',
  borderRadius: 8,
  padding: 8,
  fontSize: 13,
  outline: 'none',
  background: 'var(--surface-0)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-body)',
  resize: 'vertical',
  boxSizing: 'border-box',
};

// Wide enough for the form beside a ~300px settings column; capped to the
// window so a narrow one stacks the two (see the 720px breakpoint below).
const SKILL_MODAL_WIDTH = 'min(960px, 94vw)';
const SKILL_MODAL_HEIGHT = 'min(680px, 88vh)';

export function SkillModal({ open, onClose, onSaved, onError, onPartialSave, initial = null, projects = [], canShare = false, orgSharing = null }) {
  const isEdit = initial !== null;
  const [draft, setDraft] = useState({ label: '', description: '', declarative: '', project: ALL_PROJECTS, sharing: SKILL_SHARING_PRIVATE });
  const [busy, setBusy] = useState(false);
  /* Org sharing (ENG-3787): both a create and an edit show who can use the
     skill with the Share dialog's audience controls, and apply the answer
     through PUT /skills/{slug}/sharing once the skill is saved: a create's
     when it isn't Only me, an edit's only when it changed. An edit opens at
     the skill's audience, and only someone the Share dropdown would let
     change it (its owner or an admin) may; anyone else reads it. */
  const asksAudience = !!orgSharing?.enabled;
  const canChangeAudience = !isEdit || canChangeSkillAudience(initial);
  const editsAudience = asksAudience && canChangeAudience;
  const savedAccess = isEdit ? skillAccess(initial) : PRIVATE_ACCESS;
  const [access, setAccess] = useState(PRIVATE_ACCESS);
  const [audiencePending, setAudiencePending] = useState(false);
  // Bumped on each open so the audience fields re-seed from the skill.
  const [audienceKey, setAudienceKey] = useState(0);
  // Set once the skill is saved but sharing it failed: the button then
  // retries only the sharing, never a second create or save.
  const [retrySlug, setRetrySlug] = useState(null);
  const [inlineError, setInlineError] = useState('');
  /* Who can use the skill: a create asks where the list grants sharing, the
     creator's own edit where this skill's own capabilities do. A create sends
     the answer as `shared`; an edit applies a changed choice through the
     sharing route after the save, and surfaces its refusal. Org sharing
     replaces this select. */
  const asksSharing = !orgSharing?.enabled && (isEdit ? canShareSkill(initial) : canShare);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDraft({ label: initial.label || '', description: initial.description || '', declarative: initial.declarative || '', project: initial.projects?.[0] || ALL_PROJECTS, sharing: sharingValue(initial) });
    } else {
      setDraft({ label: '', description: '', declarative: '', project: ALL_PROJECTS, sharing: SKILL_SHARING_PRIVATE });
    }
    setAccess(initial ? skillAccess(initial) : PRIVATE_ACCESS);
    setAudienceKey((key) => key + 1);
    setAudiencePending(false);
    setRetrySlug(null);
    setInlineError('');
  }, [open]);

  const setField = (key, value) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleClose = () => {
    onClose();
  };

  const submit = async () => {
    if (isEdit && !canUseSharedResource(initial, 'canEdit')) {
      onError?.('You do not have permission to edit this shared skill.');
      return;
    }
    const label = isEdit ? initial.label : draft.label.trim();
    if (!label || !draft.declarative.trim()) return;
    if (editsAudience && audiencePending) return;
    const shareAfterSave = editsAudience && (isEdit
      ? !sameSkillAccessPayload(skillAccessPayload(access), skillAccessPayload(savedAccess))
      : !isPrivateAccess(access));
    setBusy(true);
    setInlineError('');
    /* The skill is saved; sharing it is the only thing left. A refusal keeps
       the dialog open with the reason, since the skill is already saved. */
    const shareSaved = async (slug, saved) => {
      try {
        await setSkillAccessAndSync(slug, skillAccessPayload(access));
      } catch (err) {
        const reason = err?.message || 'unknown error';
        setRetrySlug(slug);
        setInlineError(isEdit
          ? `Skill saved, but sharing couldn't be updated: ${reason}.`
          : `Skill created, but it couldn't be shared: ${reason}. You can share it from the skill's menu.`);
        await onPartialSave?.(saved);
        return false;
      }
      handleClose();
      await onSaved(saved, isEdit ? { updatedSharing: true } : { sharedWithAudience: true });
      return true;
    };
    if (retrySlug) {
      try {
        await shareSaved(retrySlug, { label, slug: retrySlug });
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const scopedProject = draft.project && draft.project !== ALL_PROJECTS ? [draft.project] : [];
      const payload = { label, description: draft.description, declarative: draft.declarative, projects: scopedProject };
      const sharedChoice = sharedFromValue(draft.sharing);
      /* A create sends the sharing choice inline. The edit PUT never carries
         it, so an edit applies a changed choice through the sharing route. */
      if (asksSharing && !isEdit) payload.shared = sharedChoice;
      const sharingChanged = isEdit && asksSharing && draft.sharing !== sharingValue(initial);
      const saved = await saveSkillAndSync(payload, isEdit);
      if (shareAfterSave) {
        // An edit's slug is the skill's own; a create's is the server's answer.
        const slug = isEdit ? (initial.slug || label) : (saved?.slug || saved?.label || label);
        await shareSaved(slug, saved ?? { label });
        return;
      }
      if (sharingChanged) await setSkillSharingAndSync(label, sharedChoice);
      handleClose();
      await onSaved(saved, {
        shared: (!isEdit && payload.shared === true) || (sharingChanged && sharedChoice),
        stoppedSharing: sharingChanged && !sharedChoice,
      });
    } catch (err) {
      onError?.(err?.message || 'Could not save skill.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = draft.label.trim() && draft.declarative.trim() && !busy && !(editsAudience && audiencePending);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      width={SKILL_MODAL_WIDTH}
      height={SKILL_MODAL_HEIGHT}
      labelledBy="skill-modal-title"
    >
      <ModalHeader
        id="skill-modal-title"
        title={isEdit ? 'Edit Skill' : 'Add a Skill'}
        subtitle="Write a name, description, and instructions for the skill."
        onClose={handleClose}
      />
      {/* Two columns on a wide window: what the skill says on the left, where
          it applies and who can use it on the right. Below 720px they stack,
          main first, and the body scrolls as one. */}
      <ModalBody padding="0">
        <div className="flex flex-col min-[720px]:h-full min-[720px]:min-h-0 min-[720px]:flex-row">
          <div
            data-testid="skill-modal-main"
            className="flex min-w-0 flex-col gap-3 p-5 min-[720px]:min-h-0 min-[720px]:flex-1 min-[720px]:overflow-y-auto"
          >
            {isEdit && isOwnSharedSkill(initial) && (
              <p className="m-0 text-[12px] text-ink-3" role="note">{OWN_SHARED_CHANGE_NOTE}</p>
            )}
            <Field label="Label">
              <Input
                aria-label="Label"
                value={draft.label}
                onChange={(v) => setField('label', v)}
                placeholder="weekly-status-report"
                readOnly={isEdit}
                style={{ ...skillFieldStyle, height: 34, resize: 'none', ...(isEdit && { opacity: 0.5, cursor: 'default' }) }}
                autoFocus={!isEdit}
              />
            </Field>
            <Field label="Description">
              <Textarea
                aria-label="Description"
                value={draft.description}
                onChange={(v) => setField('description', v)}
                placeholder="Generate weekly status reports from recent work. Use when asked for updates or progress summaries."
                style={{ ...skillFieldStyle, height: 80 }}
              />
            </Field>
            {/* Instructions take whatever height the column has left. */}
            <Field label="Instructions" className="min-[720px]:min-h-0 min-[720px]:flex-1">
              <Textarea
                aria-label="Instructions"
                value={draft.declarative}
                onChange={(v) => setField('declarative', v)}
                placeholder="Summarize my recent work in three sections: wins, blockers, and next steps. Keep the tone professional but not stiff..."
                className="min-[720px]:flex-1"
                style={{ ...skillFieldStyle, minHeight: 198, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
              />
            </Field>
            {inlineError && <Alert variant="danger">{inlineError}</Alert>}
          </div>
          <aside
            aria-label="Skill settings"
            className="flex flex-col gap-3 border-0 border-t border-solid border-line p-5 min-[720px]:w-[300px] min-[720px]:shrink-0 min-[720px]:overflow-y-auto min-[720px]:border-l min-[720px]:border-t-0"
          >
            <Field label="Project">
              <Select
                ariaLabel="Project"
                value={draft.project}
                onValueChange={(v) => setField('project', v)}
                style={{ ...skillFieldStyle, height: 34 }}
                options={[
                  // The global scope is a mode, not a project — set it apart from
                  // the real projects (which map 1:1 to the projects page) with a
                  // leading icon and a divider.
                  { value: ALL_PROJECTS, label: 'All projects', icon: Ico.globe(14) },
                  { separator: true },
                  // value stays the slug -- it is what `submit` persists into
                  // `skill.projects`. Only the label is for reading.
                  ...projects.map((p) => ({ value: p.name, label: projectLabel(p) })),
                ]}
              />
            </Field>
            {asksAudience && (
              <Field label={SKILL_SHARING_LABEL} help={canChangeAudience ? undefined : AUDIENCE_OWNER_ONLY_HINT}>
                <div role="group" aria-label={SKILL_SHARING_LABEL} className="min-w-0">
                  {canChangeAudience ? (
                    <SkillAudienceFields
                      key={audienceKey}
                      value={access}
                      onChange={setAccess}
                      capabilities={orgSharing}
                      // The creator can always edit their own new skill.
                      canEdit={!isEdit || canEditSkill(initial)}
                      onPendingChange={setAudiencePending}
                    />
                  ) : (
                    <div className="flex min-w-0 flex-col gap-2" data-testid="skill-audience-read-only">
                      <AudienceList
                        orgAllowed={savedAccess.orgAllowed}
                        teamIds={savedAccess.allowedTeamIds}
                        userIds={savedAccess.allowedUserIds}
                        orgName={orgSharing.org_name ?? null}
                        label={SKILL_SHARING_LABEL}
                      />
                      {savedAccess.alwaysOn && (
                        <span className="font-body text-[12px] text-ink-3">{ALWAYS_ON_BADGE_HINT}</span>
                      )}
                    </div>
                  )}
                </div>
              </Field>
            )}
            {asksSharing && (
              <Field label={SKILL_SHARING_LABEL} help={isEdit ? undefined : SKILL_SHARING_CREATE_HINT}>
                <Select
                  ariaLabel={SKILL_SHARING_LABEL}
                  value={draft.sharing}
                  onValueChange={(v) => setField('sharing', v)}
                  style={{ ...skillFieldStyle, height: 34 }}
                  options={SKILL_SHARING_OPTIONS}
                />
              </Field>
            )}
          </aside>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={handleClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSubmit} onClick={submit}>
          {!isEdit && !busy && Ico.plus(14)}
          {busy ? 'Saving…' : retrySlug ? 'Retry sharing' : isEdit ? 'Save' : 'Create'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default SkillModal;
