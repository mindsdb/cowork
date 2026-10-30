// `<SkillShareDialog>` — who a skill reaches inside a hosted org (ENG-3787):
// only the caller, everyone at the org, or specific teams and people. A skill
// reaching the whole org or a team can also be made "always on": part of
// every task for everyone it reaches, instead of being recalled when it's
// relevant. The controls themselves are `<SkillAudienceFields>`, shared with
// the Add a Skill dialog.

import { useEffect, useState } from 'react';
import { Alert, Button, Spinner } from './ui';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal';
import SkillAudienceFields from './SkillAudienceFields';
import { canEditSkill, skillAccess, skillAccessPayload } from '../lib/orgSharing';

/**
 * @param {{
 *   skill: object | null,
 *   capabilities: { can_share_org: boolean, org_name: string | null },
 *   onClose: () => void,
 *   onSave: (access: { org_allowed: boolean, allowed_team_ids: string[], allowed_user_ids: string[], always_on: boolean }) => Promise<void>,
 * }} props
 */
export function SkillShareDialog({ skill, capabilities, onClose, onSave }) {
  const open = !!skill;
  const [access, setAccess] = useState(() => skillAccess(skill));
  // "Specific teams and people" picked with nobody in it: Save waits.
  const [audiencePending, setAudiencePending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Bumped on each open so the fields re-seed which rows are open.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!open) return;
    setAccess(skillAccess(skill));
    setAudiencePending(false);
    setBusy(false);
    setError('');
    setGeneration((g) => g + 1);
  }, [open, skill?.label]);

  const save = async () => {
    if (busy || audiencePending) return;
    setBusy(true);
    setError('');
    try {
      await onSave(skillAccessPayload(access));
    } catch (err) {
      setError(err?.message || "Couldn't change who can use this skill.");
    } finally {
      setBusy(false);
    }
  };

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
          {open && (
            <SkillAudienceFields
              key={`${skill?.label}:${generation}`}
              value={access}
              onChange={setAccess}
              capabilities={capabilities}
              canEdit={canEditSkill(skill)}
              onPendingChange={setAudiencePending}
            />
          )}
          {error && <Alert variant="danger">{error}</Alert>}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy || audiencePending}>
          {busy && <Spinner style={{ color: 'currentColor' }} />}
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default SkillShareDialog;
