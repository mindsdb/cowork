// Agent-created skills are drafts, independent of artifacts; users explicitly save them to the
// shared skill store
// or download SKILL.md. Opening the card is read-only.

import { useState } from 'react';

import Ico from './Icons';
import Button from './ui/Button';
import { Card } from './ui/Card';
import { Modal, ModalHeader, ModalBody } from './ui/Modal';
import { Tooltip } from './ui';
import { MarkdownContent } from './markdown/MarkdownContent';
import { saveSkillAndSync, useSkills } from '../lib/skillsStore';
import { downloadBlob } from '../lib/browserDownload';
import { deleteSkillDraft } from '../api';
import {
  canUseSharedResource,
  isReservedProjectName,
} from '../lib/sharedResourceAccess';

// The event contains the full SKILL.md, so download works offline and after reload. Download
// exports only SKILL.md;
// Save installs all files in a multi-file bundle.
function downloadText(filename, text, mime = 'text/markdown;charset=utf-8') {
  downloadBlob(new Blob([text ?? ''], { type: mime }), filename);
}

function SkillModal({ skill, open, onClose }) {
  const body = skill.instructions || skill.skill_md || '_No content._';
  return (
    <Modal open={open} onClose={onClose} width="640px" labelledBy="skill-card-modal-title">
      <ModalHeader
        id="skill-card-modal-title"
        title={skill.name || skill.slug || 'Skill'}
        subtitle={skill.description || undefined}
        onClose={onClose}
      />
      <ModalBody padding="20px 22px">
        {/* Opt back into text selection — the app root sets user-select:none. */}
        <div style={{ userSelect: 'text' }}>
          <MarkdownContent text={body} />
        </div>
      </ModalBody>
    </Modal>
  );
}

export default function SkillCard({ skill, projectName }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'ok'|'error', text }
  const { skills, catalogueStatus, reload } = useSkills();

  const name = skill.name || skill.slug || 'Skill';
  const slug = skill.slug || skill.label;
  const catalogueLoaded = catalogueStatus === 'loaded';
  /* The catalogue status is module-global, so every mounted card sees
     'loading' whenever any surface refreshes the list. The store keeps the
     last settled list across that refresh, so the remembered entry stays the
     newest server verdict: honouring it keeps a forbidden skill read only
     instead of flipping to an enabled create for the length of the reload.
     A remembered entry can only withhold the button, never authorise a
     replace. */
  const knownSkill = Array.isArray(skills)
    ? skills.find((candidate) => candidate.label === slug)
    : null;
  // Only a verified catalogue can classify this draft as an update. Without
  // one, POST the member-wide create and let the server resolve identity
  // atomically; a collision may become a PUT only after a fresh capability
  // response explicitly allows it.
  const existingSkill = catalogueLoaded ? knownSkill : null;
  const canSave = knownSkill
    ? canUseSharedResource(knownSkill, 'canEdit')
    : true;
  // Compare revision content, not just slug existence, before showing Saved; ignore round-trip
  // whitespace. ENG-645 RC #2.
  const isSaved = saved || (Array.isArray(skills) && skills.some(
    (s) => s.label === slug && (s.declarative || '').trim() === (skill.instructions || '').trim()
  ));

  const handleDownload = (e) => {
    e.stopPropagation();
    const filename = `${skill.slug || skill.label || 'skill'}.md`;
    downloadText(filename, skill.skill_md || skill.instructions || '');
    setStatus({ kind: 'ok', text: 'Downloaded' });
  };

  const handleSave = async (e) => {
    e.stopPropagation();
    if (saving || saved || !canSave) return;
    setSaving(true);
    setStatus(null);

    // `declarative` is the API's instructions alias (matches SkillsView's save);
    // `label` is the slug identity used for both create and the PUT URL.
    const payload = {
      label: slug,
      name: skill.name || undefined,
      description: skill.description || undefined,
      // instructions only — never the raw SKILL.md (its YAML frontmatter
      // would get double-stored inside the body). Download uses skill_md.
      declarative: skill.instructions || '',
    };
    const exists = !!existingSkill;

    // Scope is set on CREATE only, and only for a real project. Hosted Cowork
    // reserves `general`; desktop also preserves its legacy `default` project.
    // On UPDATE we omit `projects`:
    // the API replaces the whole list, so sending just the current project would
    // wipe the skill's other project associations.
    const isReserved = isReservedProjectName(projectName);
    const createPayload = (projectName && !isReserved)
      ? { ...payload, projects: [projectName] }
      : payload;

    const markSaved = () => {
      setSaved(true);
      setStatus({ kind: 'ok', text: 'Saved to your skills' });
      // Clean up the saved draft without failing the save UI if idempotent cleanup fails.
      if (projectName && slug) deleteSkillDraft(projectName, slug).catch(() => {});
    };

    try {
      await saveSkillAndSync(exists ? payload : createPayload, exists);
      markSaved();
    } catch (err) {
      // A stale list can race another create. Refresh before considering an
      // update so hosted Cowork never turns a 409 into a PUT without a fresh
      // server capability decision. Desktop keeps its local-owner fallback.
      if (!exists && /already exists/i.test(err?.message || '')) {
        try {
          const refreshed = await reload?.({ afterCurrent: true });
          const collision = refreshed?.ok && Array.isArray(refreshed.skills)
            ? refreshed.skills.find((candidate) => candidate.label === slug)
            : null;
          if (!canUseSharedResource(collision, 'canEdit')) {
            setStatus({
              kind: 'error',
              text: collision
                ? 'You do not have permission to replace this shared skill.'
                : 'Could not verify permission to replace this shared skill. Try again.',
            });
            return;
          }
          await saveSkillAndSync(payload, true);
          markSaved();
        } catch (err2) {
          setStatus({ kind: 'error', text: err2?.message || 'Could not save skill.' });
        }
      } else {
        setStatus({ kind: 'error', text: err?.message || 'Could not save skill.' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card
        padding="compact"
        interactive
        onActivate={() => setOpen(true)}
        style={{ marginTop: 4 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr auto', alignItems: 'center', gap: 14 }}>
          <div
            aria-hidden="true"
            style={{
              width: 56, height: 56, borderRadius: 'var(--r-lg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent)', background: 'var(--surface-2)', border: '1px solid var(--line)',
            }}
          >
            {Ico.cube(24)}
          </div>

          <div style={{ minWidth: 0 }}>
            <div className="s-h3" style={{
              color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {name}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
              {status ? (
                <span style={{ color: status.kind === 'error' ? 'var(--danger)' : 'var(--success, #1F8F5F)' }}>
                  {status.text}
                </span>
              ) : isSaved ? 'Saved' : 'Draft · not saved'}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip content="Download skill">
              <Button
                icon
                size="sm"
                variant="subtle"
                onClick={handleDownload}
                aria-label="Download skill"
              >
                {Ico.download(16)}
              </Button>
            </Tooltip>
            <Button
              size="sm"
              variant={saved ? 'subtle' : 'primary'}
              disabled={saving || saved || !canSave}
              title={!canSave ? 'You do not have permission to replace this shared skill.' : undefined}
              onClick={handleSave}
            >
              {saved ? 'Saved' : saving ? 'Saving…' : !canSave ? 'Read only' : 'Save skill'}
            </Button>
          </div>
        </div>
      </Card>

      <SkillModal skill={skill} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
