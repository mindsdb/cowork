import { useEffect, useRef, useState } from 'react';
import { projectLabel, projectLabelByName } from '../lib/projectLabel';
import Ico from '../components/Icons';
import {
  PageHeader, SearchInput, SortPill, CollectionState,
  ListGroup, ListItem,
} from '../components/collection';
import { Alert, Menu, Badge, Button, Field, Select, Input, Textarea, Tooltip } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { Switch } from '../components/ui/Switch';
import { useToastManager } from '../components/ui/Toast';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import OverflowMenu from '../components/OverflowMenu';
import { fetchProjects, uploadSkillFile } from '../api';
import {
  useSkills, saveSkillAndSync, deleteSkillAndSync, setSkillSharingAndSync, setSkillAccessAndSync,
} from '../lib/skillsStore';
import { useHubTeams, useSharingCapabilities } from '../hooks/useOrgSharing';
import SkillShareMenu from '../components/SkillShareMenu';
import SkillAudienceFields from '../components/SkillAudienceFields';
import SkillDetail from '../components/SkillDetail';
import { ShareStateLabel, shareStateIcon } from '../components/ShareStateLabel';
import {
  ALWAYS_ON_BADGE,
  ALWAYS_ON_BADGE_HINT,
  canEditSkill,
  groupSkillsBySection,
  isPrivateAccess,
  PRIVATE_ACCESS,
  isSkillAlwaysOn,
  skillAccessPayload,
  skillShareState,
  skillAudienceBadge,
  skillOwnerEmail,
  skillSection,
} from '../lib/orgSharing';
import { relativeAge } from '../lib/formatTime';
import SharedResourceAttribution from '../components/SharedResourceAttribution';
import {
  canUseSharedResource,
  sharedResourceAttribution,
} from '../lib/sharedResourceAccess';
import {
  SKILL_SHARING_CREATE_HINT,
  SKILL_SHARING_LABEL,
  SKILL_SHARING_OPTIONS,
  SKILL_SHARING_PRIVATE,
  canShareSkill,
  isSharedSkill,
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

/* The same sentence cowork-server answers when it refuses a change to a skill
   someone else shares with the caller. */
const SHARED_SKILL_NOTE = "This skill is shared with you and can't be changed here.";

/* Why Edit or Uninstall is disabled, shown beside the menu item. Only an
   explicit `shared: true` names sharing; a built-in keeps its own label. */
function lockedActionHint(skill) {
  if (skill.isBuiltin) return 'Built-in';
  if (isSharedSkill(skill)) return 'Shared with you';
  return 'Admin or creator';
}

/* The caller's own skill that others use: `shared: true` with the edit
   capability granted, since cowork-server grants a shared skill's capabilities
   only to its creator (_skill_response in cowork/api/v1/endpoints/skills.py).
   Others read the creator's copy live, `enabled` included (shared_turn_skills
   in cowork/services/skills.py), so the creator's switch and Uninstall reach
   them too. */
function isOwnSharedSkill(skill) {
  return isSharedSkill(skill) && canUseSharedResource(skill, 'canEdit');
}

/* The detail note on an always-on team or org-wide skill someone else shares. */
const ALWAYS_ON_DETAIL = "It's part of every task, and only its owner can change it.";

const OWN_SHARED_SWITCH_HINT = "Turning it on or off changes it for everyone it's shared with.";
const OWN_SHARED_REMOVE_NOTE = "It's shared, so everyone it's shared with loses it too.";
/* Shown in the detail view and the Edit modal, since an edit or the switch
   reaches every reader at their next answer. */
const OWN_SHARED_CHANGE_NOTE = "It's shared, so your changes reach everyone it's shared with at their next answer.";

// The detail view's note for a skill the caller can't edit.
function readOnlyNote(skill) {
  if (skill.isBuiltin) return 'Built-in skills are read only.';
  if (isSharedSkill(skill)) return SHARED_SKILL_NOTE;
  return 'Read only — only the creator or an organization admin can change this skill.';
}

/* The on/off switch, on a row and in the detail header. Its label and
   tooltip say what flipping it does; where it is locked, the tooltip says
   why. A team or org-wide skill someone else owns has no switch at all, only
   the reason. */
export const TURN_ON_LABEL = 'Turn on: Anton can use this skill';
export const TURN_OFF_LABEL = "Turn off: Anton won't use this skill";
const NO_PERMISSION_SWITCH_HINT = 'You do not have permission to enable or disable this skill.';

function SkillEnabledControl({ skill, checked, hiddenReason = null, onChange, size = 'sm' }) {
  if (hiddenReason) {
    return (
      <span
        role="img"
        aria-label={hiddenReason}
        title={hiddenReason}
        data-testid="skill-switch-locked"
        className="inline-grid w-[32px] place-items-center text-ink-4"
      >{Ico.lock(14)}</span>
    );
  }
  const canDisable = canUseSharedResource(skill, 'canDisable');
  const label = checked ? TURN_OFF_LABEL : TURN_ON_LABEL;
  const title = !canDisable
    ? NO_PERMISSION_SWITCH_HINT
    : isOwnSharedSkill(skill) ? `${label}. ${OWN_SHARED_SWITCH_HINT}` : label;
  return (
    <Switch
      size={size}
      checked={checked}
      aria-label={label}
      title={title}
      disabled={!canDisable}
      onCheckedChange={(next) => { if (canDisable) onChange(next); }}
    />
  );
}

// The small tile before a skill's name.
function SkillTile({ skill }) {
  return (
    <span
      aria-hidden="true"
      className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-[6px] border border-solid border-line bg-surface-2 font-mono text-[12px] font-semibold text-ink-3"
    >{Ico.cube(12)}</span>
  );
}

// A kit row: tile, name, one line of description, then a row of badges (who
// it reaches, Always on, who shared it). Project and last update sit at the
// right; the switch, Share and the overflow menu after them. Share and the
// menu show on hover or focus, and always on a touch screen.
function SkillRow({ skill, onClick, projects = [], orgSharing = null, actions = null }) {
  const age = relativeAge(skill.updatedAt);
  // Project label, not slug (ENG-1676); unscoped skills apply everywhere.
  const project = projectLabelByName(projects, skill.projects?.[0] || skill.project);
  /* With org sharing on, a skill someone else owns names them; the caller's
     own skills need no byline. */
  const sharedBy = orgSharing && !canEditSkill(skill) ? skillOwnerEmail(skill) : null;
  const author = orgSharing ? null : sharedResourceAttribution(skill)?.createdBy;
  /* `shared: true` marks the creator's own shared skill and one someone else
     shares alike; the detail view's actions tell the two apart. */
  const shared = !orgSharing && isSharedSkill(skill);
  const audience = orgSharing ? skillAudienceBadge(skill, orgSharing) : null;
  const alwaysOn = !!orgSharing && isSkillAlwaysOn(skill);
  const hasBadges = skill.enabled === false || skill.isBuiltin || shared || audience || alwaysOn || sharedBy;
  return (
    <ListItem
      as="article"
      aria-label={skill.label}
      leading={<SkillTile skill={skill} />}
      title={skill.label}
      description={skill.description || skill.declarative?.slice(0, 120) || '—'}
      onActivate={() => onClick(skill)}
      meta={(
        <>
          <span className="inline-flex min-w-0 items-center gap-1">
            {Ico.folder(12)}
            <span className="truncate">{project || 'All projects'}</span>
          </span>
          {author && <span className="max-w-[160px] truncate" title={author}>{author}</span>}
          {age && <span className="whitespace-nowrap">Updated {age}</span>}
        </>
      )}
      actions={actions}
    >
      {hasBadges && (
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5" data-testid="skill-badges">
          {skill.enabled === false && <Badge variant="muted" size="sm">Disabled</Badge>}
          {skill.isBuiltin && <Badge variant="muted" size="sm">Built-in</Badge>}
          {shared && <Badge variant="muted" size="sm">Shared</Badge>}
          {audience && <Badge variant="default" size="sm">{audience}</Badge>}
          {alwaysOn && (
            <Tooltip content={ALWAYS_ON_BADGE_HINT}>
              <span className="relative z-10 inline-flex"><Badge variant="accent" size="sm">{ALWAYS_ON_BADGE}</Badge></span>
            </Tooltip>
          )}
          {sharedBy && <span className="max-w-[240px] truncate font-body text-xs text-ink-4" title={sharedBy}>Shared by {sharedBy}</span>}
        </div>
      )}
    </ListItem>
  );
}

// Share and the overflow menu: shown on hover or keyboard focus within the
// row, and always where there is no hover (touch).
const REVEAL_ACTIONS = 'flex items-center gap-1 opacity-0 transition-opacity duration-hover group-hover/item:opacity-100 group-focus-within/item:opacity-100 [@media(hover:none)]:opacity-100';

// Section headers: an icon, the title and how many skills it holds.
const SECTION_ICONS = {
  mine: Ico.lock,
  shared_with_me: Ico.user,
  team: Ico.people,
  org: Ico.building,
  builtin: Ico.cube,
};

// Page margin of the row group, shared with its loading skeleton so loading
// does not shift the layout.
const LIST_CLASS = 'mx-8 mb-[60px]';

const fieldStyle = {
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

function SkillModal({ open, onClose, onSaved, onError, onPartialSave, initial = null, projects = [], canShare = false, orgSharing = null }) {
  const isEdit = initial !== null;
  const [draft, setDraft] = useState({ label: '', description: '', declarative: '', project: ALL_PROJECTS, sharing: SKILL_SHARING_PRIVATE });
  const [busy, setBusy] = useState(false);
  /* Org sharing (ENG-3787): a create asks who can use the skill with the
     Share dialog's audience controls, and applies a non-private answer
     through PUT /skills/{slug}/sharing once the skill exists. Edits leave
     the audience to the Share dialog. */
  const asksAudience = !!orgSharing?.enabled && !isEdit;
  const [access, setAccess] = useState(PRIVATE_ACCESS);
  const [audiencePending, setAudiencePending] = useState(false);
  // Set once the skill exists but sharing it failed: Create then retries
  // only the sharing, never a second create.
  const [createdSlug, setCreatedSlug] = useState(null);
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
    setAccess(PRIVATE_ACCESS);
    setAudiencePending(false);
    setCreatedSlug(null);
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
    if (asksAudience && audiencePending) return;
    const shareAfterCreate = asksAudience && !isPrivateAccess(access);
    setBusy(true);
    setInlineError('');
    /* The skill exists; sharing it is the only thing left. A refusal keeps
       the dialog open with the reason, since the skill is already saved. */
    const shareCreated = async (slug, saved) => {
      try {
        await setSkillAccessAndSync(slug, skillAccessPayload(access));
      } catch (err) {
        setCreatedSlug(slug);
        setInlineError(`Skill created, but it couldn't be shared: ${err?.message || 'unknown error'}. You can share it from the skill's menu.`);
        await onPartialSave?.(saved);
        return false;
      }
      handleClose();
      await onSaved(saved, { sharedWithAudience: true });
      return true;
    };
    if (createdSlug) {
      try {
        await shareCreated(createdSlug, { label, slug: createdSlug });
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
      if (shareAfterCreate) {
        await shareCreated(saved?.slug || saved?.label || label, saved ?? { label });
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

  const canSubmit = draft.label.trim() && draft.declarative.trim() && !busy && !(asksAudience && audiencePending);

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
                style={{ ...fieldStyle, height: 34, resize: 'none', ...(isEdit && { opacity: 0.5, cursor: 'default' }) }}
                autoFocus={!isEdit}
              />
            </Field>
            <Field label="Description">
              <Textarea
                aria-label="Description"
                value={draft.description}
                onChange={(v) => setField('description', v)}
                placeholder="Generate weekly status reports from recent work. Use when asked for updates or progress summaries."
                style={{ ...fieldStyle, height: 80 }}
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
                style={{ ...fieldStyle, minHeight: 198, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
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
                style={{ ...fieldStyle, height: 34 }}
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
              <Field label={SKILL_SHARING_LABEL}>
                <div role="group" aria-label={SKILL_SHARING_LABEL} className="min-w-0">
                  <SkillAudienceFields
                    value={access}
                    onChange={setAccess}
                    capabilities={orgSharing}
                    // The creator can always edit their own new skill.
                    canEdit
                    onPendingChange={setAudiencePending}
                  />
                </div>
              </Field>
            )}
            {asksSharing && (
              <Field label={SKILL_SHARING_LABEL} help={isEdit ? undefined : SKILL_SHARING_CREATE_HINT}>
                <Select
                  ariaLabel={SKILL_SHARING_LABEL}
                  value={draft.sharing}
                  onValueChange={(v) => setField('sharing', v)}
                  style={{ ...fieldStyle, height: 34 }}
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
          {busy ? 'Saving…' : isEdit ? 'Save' : createdSlug ? 'Retry sharing' : 'Create'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function UploadSkillModal({ open, onClose, onSaved, onError, canShare = false }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile]         = useState(null);
  const [busy, setBusy]         = useState(false);
  const [sharing, setSharing]   = useState(SKILL_SHARING_PRIVATE);
  const inputRef                = useRef(null);

  useEffect(() => {
    if (!open) { setFile(null); setBusy(false); setSharing(SKILL_SHARING_PRIVATE); }
  }, [open]);

  const pickFile = (f) => { if (f) setFile(f); };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const saved = await uploadSkillFile(file, canShare ? { shared: sharedFromValue(sharing) } : {});
      onClose();
      await onSaved(saved, { shared: canShare && sharedFromValue(sharing) });
    } catch (err) {
      onError?.(err.message || 'Could not upload skill.');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files[0]);
  };

  return (
    <Modal open={open} onClose={onClose} width="549px" labelledBy="upload-skill-title">
      <ModalHeader id="upload-skill-title" title="Upload Skill Files" subtitle="Upload a .md or .skill file to import a skill." onClose={onClose} />
      <ModalBody padding="20px">
        <div className="flex flex-col gap-4">

          {/* Drop zone */}
          <div
            onClick={() => !file && !busy && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className="h-[160px] rounded-card flex flex-col items-center justify-center gap-3 py-6 [transition:border-color_var(--dur-hover)_ease,background_var(--dur-hover)_ease]"
            style={{
              border: `1px dashed ${dragging ? 'var(--accent)' : file ? 'var(--accent)' : 'var(--line-2)'}`,
              background: dragging ? 'var(--accent-bg)' : file ? 'var(--accent-bg)' : 'var(--surface-2)',
              cursor: file ? 'default' : 'pointer',
            }}
          >
            {file ? (
              <>
                <span className="text-accent">{Ico.upload(32)}</span>
                <span className="text-[13.5px] font-[family-name:var(--font-body)] text-ink-2 font-medium">
                  {file.name}
                </span>
                <span className="text-[12px] font-[family-name:var(--font-body)] text-ink-4">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
                <Button
                  variant="subtle"
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                >
                  Remove
                </Button>
              </>
            ) : (
              <>
                <span className="text-ink-4">{Ico.upload(32)}</span>
                <span className="text-[13.5px] font-[family-name:var(--font-body)] text-ink-3">
                  Drag and drop or click to upload
                </span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".md,.skill,.zip"
              className="hidden"
              onChange={(e) => { pickFile(e.target.files[0]); e.target.value = ''; }}
            />
          </div>

          {/* File requirements */}
          <div className="text-[12px] leading-[16px] text-ink-3 font-[family-name:var(--font-body)]">
            <div className="font-medium mb-1">File requirements</div>
            <ul className="m-0 pl-[18px]">
              <li>.md or .skill file must contain skill name and description formatted in YAML</li>
              <li>.zip file must include a SKILL.md file</li>
            </ul>
          </div>

          {canShare && (
            <Field label={SKILL_SHARING_LABEL} help={SKILL_SHARING_CREATE_HINT}>
              <Select
                ariaLabel={SKILL_SHARING_LABEL}
                value={sharing}
                onValueChange={setSharing}
                disabled={busy}
                style={{ ...fieldStyle, height: 34 }}
                options={SKILL_SHARING_OPTIONS}
              />
            </Field>
          )}

        </div>
      </ModalBody>
      <ModalFooter align="space-between">
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        {file && (
          <Button variant="primary" disabled={busy} onClick={upload}>
            {!busy && Ico.upload(14)}
            {busy ? 'Uploading…' : 'Upload'}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

const COWORK_PREFILL = "Let's create a skill together using your /skill-creator skill. First ask me what the skill should do.";

function CreateSkillDropdown({ onWrite, onUpload, onCowork }) {
  const items = [
    { id: 'write',  label: 'Write Skill Instructions', icon: Ico.edit(14),    onClick: onWrite },
    { id: 'cowork', label: 'Create With Cowork',      icon: Ico.sparkle(14), onClick: () => onCowork?.(COWORK_PREFILL) },
    { id: 'upload', label: 'Upload a skill',           icon: Ico.upload(14),  onClick: onUpload },
  ];
  const trigger = (
    <Button
      variant="primary"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingRight: 10 }}
    >
      {Ico.plus(14)}
      <span>Create skill</span>
      <span className="inline-flex text-inherit opacity-70">{Ico.chevDown(12)}</span>
    </Button>
  );
  return <Menu trigger={trigger} items={items} align="end" width={220} />;
}

const SORT_OPTIONS = [
  { id: 'name',   label: 'Name' },
  { id: 'recent', label: 'Recent' },
];

export default function SkillsView({ onCreateWithCowork, onTryInChat }) {
  // Skills come from the shared store so saves/deletes here sync the composer
  // "/" menu (and skill-card saves sync back to this page) with no reload.
  const { skills, reload, canShare }  = useSkills();
  const [projects, setProjects]       = useState([]);
  const [selected, setSelected]       = useState(null);
  const [modalSkill, setModalSkill]   = useState(null); // null = closed, undefined = new, skill = edit
  const [uploadOpen, setUploadOpen]   = useState(false);
  const toastManager = useToastManager();
  const [search, setSearch]           = useState('');
  const [sortBy, setSortBy]           = useState('name');
  // Rows by default: skills are a catalogue you scan and manage. Phones get
  // rows too.
  // Skill awaiting the remove confirmation.
  const [removing, setRemoving]       = useState(null);
  /* "Who can use it" changes still in flight: skill label → the value each
     one asks for. A skill reopened while its change runs shows that value,
     held, rather than the list's older one. */
  const [pendingSharing, setPendingSharing] = useState(() => new Map());
  const searchRef = useRef(null);
  /* Org sharing (ENG-3787) groups the list by who each skill reaches and
     replaces the "Who can use it" select with the Share dialog. Off on every
     other build, where the page is as it was. */
  const sharingCapabilities = useSharingCapabilities();
  const orgSharingOn = sharingCapabilities.enabled;
  const teamsState = useHubTeams(orgSharingOn);
  const orgSharing = orgSharingOn
    ? { teams: teamsState.teams, orgName: sharingCapabilities.org_name }
    : null;
  /* On/off changes in flight: skill label → the value asked for, so a row's
     switch moves at once and moves back on a refusal. */
  const [enabledPending, setEnabledPending] = useState(() => new Map());

  // type: 'success' | 'error' (mapped to the shared Toast's 'danger').
  const showToast = (msg, type = 'error') => toastManager.add({ title: msg, type: type === 'error' ? 'danger' : type });

  useEffect(() => {
    fetchProjects().then(setProjects);
    reload();
  }, []);

  useEffect(() => {
    if (!selected || !Array.isArray(skills)) return;
    const fresh = skills.find((skill) => skill.label === selected.label);
    if (fresh) setSelected((current) => (current === fresh ? current : fresh));
  }, [skills]);

  /* The open skill always mirrors the shared catalogue. Mutation endpoints
     serialize a skill separately from the list, and a response that omits
     `capabilities` reads as a denial on hosted Cowork, so adopting one would
     lock the creator out of the skill they just saved. The effect above
     re-points `selected` at the reloaded entry; a save response only names
     the skill for the toast. */
  const onSkillSaved = (saved, { shared = false, stoppedSharing = false, sharedWithAudience = false } = {}) => {
    const label = saved?.label;
    if (sharedWithAudience) showToast(`Created and shared ${label}.`, 'success');
    else if (shared) showToast(`Saved and shared ${label} with everyone.`, 'success');
    else if (stoppedSharing) showToast(`Saved ${label} and stopped sharing it.`, 'success');
    else showToast(`Saved ${label}.`, 'success');
  };

  const onSkillUploaded = async (saved, options) => {
    const refreshed = await reload({ afterCurrent: true });
    // An upload bypasses the store, so re-point the open skill from the list
    // this reload verified rather than from the upload response.
    const fresh = refreshed?.ok && Array.isArray(refreshed.skills)
      ? refreshed.skills.find((skill) => skill.label === saved?.label)
      : null;
    if (fresh) {
      setSelected((current) => (current?.label === fresh.label ? fresh : current));
    }
    onSkillSaved(saved, options);
  };

  const remove = (skill) => {
    if (canUseSharedResource(skill, 'canDelete')) setRemoving(skill);
  };

  // Runs after the dialog closes, so the page stays usable while it settles.
  const confirmRemove = async (skill) => {
    try {
      await deleteSkillAndSync(skill.label);
      setSelected((current) => (
        current?.label === skill.label ? null : current
      ));
      showToast(`Removed ${skill.label}.`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not remove skill.');
    }
  };

  /* Applies on change, like the enabled switch: the control moves at once,
     and a refusal moves it back and shows the server's sentence. The reload
     inside the write re-points the open skill through the effect above. */
  const changeSharing = async (skill, value) => {
    const targetLabel = skill.label;
    const shared = sharedFromValue(value);
    if (sharingValue(skill) === value) return;
    const setShared = (next) => setSelected((current) => (
      current?.label === targetLabel ? { ...current, shared: next } : current
    ));
    setPendingSharing((current) => new Map(current).set(targetLabel, value));
    setShared(shared);
    try {
      await setSkillSharingAndSync(targetLabel, shared);
      showToast(shared ? `Shared ${targetLabel} with everyone.` : `Stopped sharing ${targetLabel}.`, 'success');
    } catch (err) {
      setShared(!shared);
      showToast(err.message || 'Could not change who can use this skill.');
    } finally {
      setPendingSharing((current) => {
        const next = new Map(current);
        next.delete(targetLabel);
        return next;
      });
    }
  };

  const saveAccess = async (skill, access) => {
    // Throws on a refusal, which the Share dropdown shows in place.
    await setSkillAccessAndSync(skill.slug || skill.label, access);
    showToast(`Updated who can use ${skill.label}.`, 'success');
  };

  /* Turns a skill on or off from its row or the detail header. The switch
     moves at once; a refusal moves it back and shows the server's sentence.
     The reload inside the save re-points the open skill through the effect
     above; adopting the response here would trade the catalogue entry for a
     serializer that need not carry capabilities. */
  const setSkillEnabled = async (skill, next) => {
    if (!canUseSharedResource(skill, 'canDisable')) return;
    const targetLabel = skill.label;
    const setOpen = (value) => setSelected((current) => (
      current?.label === targetLabel ? { ...current, enabled: value } : current
    ));
    setEnabledPending((current) => new Map(current).set(targetLabel, next));
    setOpen(next);
    try {
      await saveSkillAndSync({ label: targetLabel, enabled: next }, true);
    } catch (err) {
      setOpen(!next);
      showToast(err.message || 'Could not update skill.');
    } finally {
      setEnabledPending((current) => {
        const copy = new Map(current);
        copy.delete(targetLabel);
        return copy;
      });
    }
  };
  const isEnabled = (skill) => enabledPending.get(skill.label) ?? skill.enabled ?? true;

  /* Whether the open skill offers Share: the caller's own, on an org. */
  const canOpenShare = (skill) => orgSharingOn && !skill.isBuiltin && canEditSkill(skill);
  /* An org skill someone else owns keeps no Edit or Uninstall at all. */
  const hidesOwnerActions = (skill) => orgSharingOn && !canEditSkill(skill);
  /* Team and org-wide skills someone else owns offer no on/off switch. */
  const alwaysApplied = (skill) => orgSharingOn && !canEditSkill(skill)
    && (skillSection(skill) === 'team' || skillSection(skill) === 'org');
  /* Why such a skill has no switch. */
  const switchHiddenReason = (skill) => {
    if (!alwaysApplied(skill)) return null;
    const owner = skillOwnerEmail(skill);
    return isSkillAlwaysOn(skill)
      ? `Part of every task for everyone it's shared with. Only ${owner || 'its owner'} can change it.`
      : `Shared with your ${skillSection(skill) === 'team' ? 'team' : 'organization'}. Only ${owner || 'its owner'} can turn it off.`;
  };
  const enabledControl = (skill, size) => (
    <SkillEnabledControl
      size={size}
      skill={skill}
      checked={isEnabled(skill)}
      hiddenReason={switchHiddenReason(skill)}
      onChange={(next) => setSkillEnabled(skill, next)}
    />
  );
  /* The skill's menu: Try in chat, then Edit and Uninstall where they apply. */
  const skillMenuItems = (skill) => [
    { id: 'try', label: 'Try in chat', icon: Ico.chats(14), onClick: () => onTryInChat?.(`/${skill.label}`, skill.projects?.[0]) },
    ...(hidesOwnerActions(skill) ? [] : [{
      id: 'edit', label: 'Edit', icon: Ico.edit(14),
      disabled: !canUseSharedResource(skill, 'canEdit'),
      hint: !canUseSharedResource(skill, 'canEdit') ? lockedActionHint(skill) : undefined,
      title: !canUseSharedResource(skill, 'canEdit') ? 'You do not have permission to edit this skill.' : undefined,
      onClick: () => startEdit(skill),
    },
    { divider: true },
    {
      id: 'uninstall', label: 'Uninstall', icon: Ico.trash(14), danger: true,
      disabled: !canUseSharedResource(skill, 'canDelete'),
      hint: !canUseSharedResource(skill, 'canDelete') ? lockedActionHint(skill) : undefined,
      title: !canUseSharedResource(skill, 'canDelete') ? 'You do not have permission to uninstall this skill.' : undefined,
      onClick: () => remove(skill),
    }]),
  ];
  /* "Share" or "Shared", with who in the tooltip. */
  const shareState = (skill) => skillShareState(skill, { teams: teamsState.teams, orgName: sharingCapabilities.org_name });
  const shareMenu = (skill, trigger, tooltip = shareState(skill).hint) => (
    <SkillShareMenu
      skill={skill}
      capabilities={sharingCapabilities}
      onSave={(access) => saveAccess(skill, access)}
      trigger={trigger}
      tooltip={tooltip}
    />
  );
  const rowActions = (skill) => (
    <>
      {enabledControl(skill)}
      <div className={REVEAL_ACTIONS} data-testid="skill-row-actions">
        {canOpenShare(skill) && (() => {
          const state = shareState(skill);
          // Shared: the word says so; private: just the icon, like the menu.
          return shareMenu(skill, state.shared ? (
            <Button size="xxs" variant="subtle" aria-label={`Shared: ${skill.label}`}>
              <ShareStateLabel state={state} size={12} />
            </Button>
          ) : (
            <Button icon size="xxs" variant="subtle" aria-label={`Share ${skill.label}`}>
              {shareStateIcon(state.kind, 14)}
            </Button>
          ), state.shared ? state.hint : 'Share');
        })()}
        <OverflowMenu label={`More actions for ${skill.label}`} title="More actions" items={skillMenuItems(skill)} />
      </div>
    </>
  );

  const startNew  = () => setModalSkill(undefined);
  const startEdit = (skill) => {
    if (canUseSharedResource(skill, 'canEdit')) setModalSkill(skill);
  };
  const closeModal = () => setModalSkill(null);

  // ── List ──────────────────────────────────────────────────────────────────
  const filtered = (skills ?? []).filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      const project = (s.projects?.[0] || s.project || '').toLowerCase();
      if (!s.label?.toLowerCase().includes(q) && !s.description?.toLowerCase().includes(q) && !project.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return (a.label || '').localeCompare(b.label || '');
    if (sortBy === 'recent') {
      return (b.updatedAt ? Date.parse(b.updatedAt) : 0) - (a.updatedAt ? Date.parse(a.updatedAt) : 0);
    }
    return 0;
  });

  return (
    <div className="scroll-clean flex-1 overflow-y-auto pb-10">
      {selected ? (
        // ── Detail view ────────────────────────────────────────────────────
        <>
          <PageHeader
            crumbs={[{ label: 'Skills', onClick: () => setSelected(null) }]}
            current={selected.label}
          />
          <SkillDetail
            skill={selected}
            projects={projects}
            orgSharing={orgSharing}
            teamsState={orgSharingOn ? teamsState : null}
            enabled={isEnabled(selected)}
            canEdit={!hidesOwnerActions(selected) && canUseSharedResource(selected, 'canEdit')}
            onEdit={() => startEdit(selected)}
            actions={(
              <>
                {canOpenShare(selected) && shareMenu(selected, (
                  <Button variant="default">
                    <ShareStateLabel state={shareState(selected)} />
                  </Button>
                ))}
                {!hidesOwnerActions(selected) && canUseSharedResource(selected, 'canEdit') && (
                  <Button variant="default" onClick={() => startEdit(selected)} aria-label={`Edit ${selected.label}`} title="Edit">
                    {Ico.edit(14)}
                    Edit
                  </Button>
                )}
                {enabledControl(selected, 'md')}
                <OverflowMenu items={skillMenuItems(selected)} />
              </>
            )}
            notes={(
              <div className="flex flex-col gap-2 empty:hidden">
                {!orgSharingOn && <SharedResourceAttribution resource={selected} />}
                {orgSharingOn && !canEditSkill(selected) && !selected.isBuiltin && (
                  <p className="m-0 text-[12px] text-ink-3" role="note">
                    {skillOwnerEmail(selected) ? `Shared by ${skillOwnerEmail(selected)}. ` : ''}
                    {alwaysApplied(selected) && isSkillAlwaysOn(selected) ? ALWAYS_ON_DETAIL : "You can use it but can't change it."}
                  </p>
                )}
                {!orgSharingOn && !canUseSharedResource(selected, 'canEdit') && (
                  <p className="m-0 text-[12px] text-ink-3" role="note">
                    {readOnlyNote(selected)}
                  </p>
                )}
                {!orgSharingOn && isOwnSharedSkill(selected) && (
                  <p className="m-0 text-[12px] text-ink-3" role="note">
                    {OWN_SHARED_CHANGE_NOTE}
                  </p>
                )}
              </div>
            )}
            sharingControl={!orgSharingOn && canShareSkill(selected) ? (
              <Select
                ariaLabel={SKILL_SHARING_LABEL}
                options={SKILL_SHARING_OPTIONS}
                value={pendingSharing.get(selected.label) ?? sharingValue(selected)}
                onValueChange={(value) => changeSharing(selected, value)}
                disabled={pendingSharing.has(selected.label)}
                size="sm"
                width={260}
                menuMinWidth={300}
              />
            ) : null}
          />
        </>
      ) : (
        // ── List ───────────────────────────────────────────────────────────
        <>
          {/* Search and sort sit on the Create button's line. */}
          <PageHeader
            title="Skills"
            subtitle="Extend Cowork's capabilities with task-specific skills"
            actions={(
              <div className="flex max-w-full flex-wrap items-center justify-end gap-2" data-testid="skills-toolbar">
                <SearchInput inputRef={searchRef} value={search} onChange={setSearch} placeholder="Search skills" shortcut={null} />
                <SortPill value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />
                <CreateSkillDropdown onWrite={startNew} onUpload={() => setUploadOpen(true)} onCowork={onCreateWithCowork} />
              </div>
            )}
          />
          <CollectionState
            loading={skills === null}
            total={(skills ?? []).length}
            shown={sorted.length}
            query={search}
            onClear={() => setSearch('')}
            skeleton="group"
            skeletonClassName={LIST_CLASS}
            empty={{
              icon: <span className="inline-flex text-ink-4">{Ico.cube(32)}</span>,
              title: 'No saved skills yet',
              style: { flex: 1 },
            }}
          >
            {orgSharing ? (
              <div className={`${LIST_CLASS} flex flex-col gap-6`}>
                {/* Only the sections that hold a skill; an empty list keeps
                    CollectionState's one empty state. */}
                {groupSkillsBySection(sorted, { orgName: orgSharing.orgName }).map((group) => (
                  <ListGroup
                    key={group.id}
                    aria-label={group.title}
                    title={(
                      <h2 className="flex items-center gap-2">
                        <span className="inline-flex text-ink-4" aria-hidden="true">{SECTION_ICONS[group.id](14)}</span>
                        {group.title}
                      </h2>
                    )}
                    description={<span data-testid="section-count">{group.skills.length}</span>}
                  >
                    {group.skills.map((skill) => (
                      <SkillRow key={skill.label} skill={skill} onClick={setSelected} projects={projects} orgSharing={orgSharing} actions={rowActions(skill)} />
                    ))}
                  </ListGroup>
                ))}
              </div>
            ) : (
              <ListGroup className={LIST_CLASS}>
                {sorted.map((skill) => (
                  <SkillRow key={skill.label} skill={skill} onClick={setSelected} projects={projects} actions={rowActions(skill)} />
                ))}
              </ListGroup>
            )}
          </CollectionState>
        </>
      )}
      <UploadSkillModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSaved={onSkillUploaded}
        onError={showToast}
        canShare={canShare}
      />
      <ConfirmModal
        open={!!removing}
        title={removing ? `Remove skill "${removing.label}"?` : ''}
        message={removing && isOwnSharedSkill(removing) ? OWN_SHARED_REMOVE_NOTE : undefined}
        confirmLabel="Remove"
        destructive
        onClose={() => setRemoving(null)}
        onConfirm={() => { const skill = removing; setRemoving(null); if (skill) confirmRemove(skill); }}
      />
      <SkillModal
        open={modalSkill !== null}
        onClose={closeModal}
        onSaved={onSkillSaved}
        onError={showToast}
        onPartialSave={() => reload({ afterCurrent: true })}
        initial={modalSkill ?? null}
        projects={projects}
        canShare={canShare}
        orgSharing={orgSharingOn ? sharingCapabilities : null}
      />
    </div>
  );
}
