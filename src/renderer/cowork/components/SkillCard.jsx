// Inline skill-draft card + modal.
//
// Rendered for a skill the agent BUILT this turn (a `response.skill_created`
// step, badge 'Skill'). Deliberately NOT the artifact card and NOT backed by
// the artifact system — a built skill is a draft the user explicitly acts on:
//   • Download → save the SKILL.md to the Downloads folder (client-side, no
//     server round-trip), and
//   • Save     → persist it into Cowork skills (shared store → the Skills page
//     and the "/" menu update live).
// Clicking the card body opens the SKILL.md in a read-only modal.
//
// Composes the existing primitives (Card / Button / Modal / Ico / Markdown) —
// no new UI is invented here.

import { useState } from 'react';

import Ico from './Icons';
import Button from './ui/Button';
import { Card } from './ui/Card';
import { Modal, ModalHeader, ModalBody } from './ui/Modal';
import { Select, Tooltip } from './ui';
import { MarkdownContent } from './markdown/MarkdownContent';
import { saveSkillAndSync, useSkills } from '../lib/skillsStore';
import { downloadBlob, downloadUnavailableMessage } from '../lib/browserDownload';
import { deleteSkillDraft } from '../api';
import {
  canUseSharedResource,
  isReservedProjectName,
} from '../lib/sharedResourceAccess';
import { useTranslation } from '../../lib/i18n';
import {
  skillSharingLabel,
  skillSharingOptions,
  SKILL_SHARING_PRIVATE,
  sharedFromValue,
} from '../lib/skillSharing';

// Trigger a browser save-as for a text file, fully client-side (no server).
// The event payload already carries the full SKILL.md, so download works
// offline and on reload. ponytail: single SKILL.md only — multi-file skills
// keep their siblings via Save (which installs the whole bundle); a client zip
// would mean a new dependency for a rare case.
function downloadText(filename, text, mime = 'text/markdown;charset=utf-8') {
  return downloadBlob(new Blob([text ?? ''], { type: mime }), filename);
}

function SkillModal({ skill, open, onClose }) {
  const { t } = useTranslation('library');
  const body = skill.instructions || skill.skill_md || t('skillCard.noContent');
  return (
    <Modal open={open} onClose={onClose} width="min(640px, 92vw)" labelledBy="skill-card-modal-title">
      <ModalHeader
        id="skill-card-modal-title"
        title={skill.name || skill.slug || t('skillCard.skill')}
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
  const { t } = useTranslation('library');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'ok'|'error', text }
  const [sharing, setSharing] = useState(SKILL_SHARING_PRIVATE);
  const { skills, catalogueStatus, reload, canShare } = useSkills();

  const name = skill.name || skill.slug || t('skillCard.skill');
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
  /* Saving a new skill asks who can use it, where the server lets this person
     share. An update never changes sharing, so neither a known skill's PUT nor
     the create-collision fallback below sends the choice. The remembered entry
     withholds the question, as it withholds the save: a refresh elsewhere
     must not ask on an update, since the collision fallback would drop the
     answer. */
  const asksSharing = canShare && !knownSkill && !saved;
  // "Saved" only when THIS revision is in the store — compare instructions, not
  // just slug existence: editing an existing skill seeds the draft from the
  // stored version, so slug-existence alone would falsely show "Saved" before
  // the refinement is saved (ENG-645 RC #2). Trimmed to ignore round-trip
  // whitespace; a mismatch errs to "Draft · not saved" (the safe side).
  const isSaved = saved || (Array.isArray(skills) && skills.some(
    (s) => s.label === slug && (s.declarative || '').trim() === (skill.instructions || '').trim()
  ));

  const handleDownload = (e) => {
    e.stopPropagation();
    const filename = `${skill.slug || skill.label || 'skill'}.md`;
    const saved = downloadText(filename, skill.skill_md || skill.instructions || '');
    setStatus(saved
      ? { kind: 'ok', text: t('skillCard.downloaded') }
      : { kind: 'error', text: downloadUnavailableMessage('Could not download this skill.') });
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
    // A saved skill with this slug → PUT; else POST.
    const exists = !!existingSkill;

    // Scope is set on CREATE only, and only for a real project. Hosted Cowork
    // reserves `general`; desktop also preserves its legacy `default` project.
    // On UPDATE we omit `projects`:
    // the API replaces the whole list, so sending just the current project would
    // wipe the skill's other project associations.
    const isReserved = isReservedProjectName(projectName);
    const scopedPayload = (projectName && !isReserved)
      ? { ...payload, projects: [projectName] }
      : payload;
    const sharedOnCreate = asksSharing && sharedFromValue(sharing);
    /* A skill shared with everyone is created unscoped. The card never shows
       the chat's project, so the person never chose it, and a reader applies
       the creator's scope (shared_turn_skills in cowork/services/skills.py), so
       a silent scope would keep the skill out of every other person's turns.
       The creator's own copy then applies in all of their projects. */
    const createBase = sharedOnCreate ? payload : scopedPayload;
    const createPayload = asksSharing
      ? { ...createBase, shared: sharedOnCreate }
      : scopedPayload;

    const markSaved = (text) => {
      setSaved(true);
      setStatus({ kind: 'ok', text });
      // Sweep the on-disk draft now it lives in the store; fire-and-forget (the
      // server is idempotent, and a lingering draft must never fail the save UI).
      if (projectName && slug) deleteSkillDraft(projectName, slug).catch(() => {});
    };

    try {
      await saveSkillAndSync(exists ? payload : createPayload, exists);
      markSaved(sharedOnCreate ? t('skillCard.savedShared') : t('skillCard.savedToSkills'));
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
                ? t('skillCard.noPermission')
                : t('skillCard.verifyFailed'),
            });
            return;
          }
          await saveSkillAndSync(payload, true);
          /* The update keeps the existing skill's sharing, so a person who
             answered the question learns their answer did not apply. */
          markSaved(asksSharing ? t('skillCard.sharingKept') : t('skillCard.savedToSkills'));
        } catch (err2) {
          setStatus({ kind: 'error', text: err2?.message || t('skillCard.saveFailed') });
        }
      } else {
        setStatus({ kind: 'error', text: err?.message || t('skillCard.saveFailed') });
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
          {/* Icon — `cube` distinguishes a skill from the artifact card's doc/sparkle. */}
          <div
            aria-hidden="true"
            style={{
              width: 56, height: 56, borderRadius: 'var(--r-lg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent)', background: 'var(--surface-2)', border: '1px solid var(--line)',
            }}
          >
            {Ico.cube(20)}
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
              ) : isSaved ? t('skillCard.saved') : t('skillCard.draft')}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip content={t('skillCard.download')}>
              <Button
                icon
                size="sm"
                variant="subtle"
                onClick={handleDownload}
                aria-label={t('skillCard.download')}
              >
                {Ico.download(16)}
              </Button>
            </Tooltip>
            {asksSharing && (
              /* The card body opens the SKILL.md, so a click or key on the
                 choice (its options render in a portal, whose events still
                 bubble through React) must not reach it. */
              <span
                className="inline-flex"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Select
                  size="sm"
                  ariaLabel={skillSharingLabel()}
                  title={skillSharingLabel()}
                  options={skillSharingOptions()}
                  value={sharing}
                  onValueChange={setSharing}
                  disabled={saving}
                  width={176}
                  menuMinWidth={300}
                />
              </span>
            )}
            <Button
              size="sm"
              variant={saved ? 'subtle' : 'primary'}
              disabled={saving || saved || !canSave}
              title={!canSave ? t('skillCard.noPermission') : undefined}
              onClick={handleSave}
            >
              {saved ? t('skillCard.saved') : saving ? t('skillCard.saving') : !canSave ? t('skillCard.readOnly') : t('skillCard.save')}
            </Button>
          </div>
        </div>
      </Card>

      <SkillModal skill={skill} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
