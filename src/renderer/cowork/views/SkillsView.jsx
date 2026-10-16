import { useEffect, useRef, useState } from 'react';
import { projectLabel, projectLabelByName } from '../lib/projectLabel';
import Ico from '../components/Icons';
import {
  PageHeader, FilterRow, SearchInput, SortPill, CollectionState,
  ListGroup, ListItem,
} from '../components/collection';
import { Menu, Badge, Button, Field, Select, Input, Textarea } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { Switch } from '../components/ui/Switch';
import { useToastManager } from '../components/ui/Toast';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import OverflowMenu from '../components/OverflowMenu';
import { fetchProjects, uploadSkillFile } from '../api';
import {
  useSkills, saveSkillAndSync, deleteSkillAndSync, setSkillSharingAndSync,
} from '../lib/skillsStore';
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
  sharedFromValue,
  sharingValue,
} from '../lib/skillSharing';

// Sentinel for the "All projects" scope choice in the Scope <Select>. It must
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
  if (skill.shared === true) return 'Shared with you';
  return 'Admin or creator';
}

/* The caller's own skill that others use: `shared: true` with the edit
   capability granted, since cowork-server grants a shared skill's capabilities
   only to its creator (_skill_response in cowork/api/v1/endpoints/skills.py).
   Others read the creator's copy live, `enabled` included (shared_turn_skills
   in cowork/services/skills.py), so the creator's switch and Uninstall reach
   them too. */
function isOwnSharedSkill(skill) {
  return skill.shared === true && canUseSharedResource(skill, 'canEdit');
}

const OWN_SHARED_SWITCH_HINT = "Turning it on or off changes it for everyone it's shared with.";
const OWN_SHARED_REMOVE_NOTE = "It's shared, so everyone it's shared with loses it too.";
/* Shown in the detail view and the Edit modal, since an edit or the switch
   reaches every reader at their next answer. */
const OWN_SHARED_CHANGE_NOTE = "It's shared, so your changes reach everyone it's shared with at their next answer.";

// The detail view's note for a skill the caller can't edit.
function readOnlyNote(skill) {
  if (skill.isBuiltin) return 'Built-in skills are read only.';
  if (skill.shared === true) return SHARED_SKILL_NOTE;
  return 'Read only — only the creator or an organization admin can change this skill.';
}

// A kit row: name, description, and inline meta (project, stable creator,
// last update).
function SkillRow({ skill, onClick, projects = [] }) {
  const age = relativeAge(skill.updatedAt);
  // Project label, not slug (ENG-1676); unscoped skills apply everywhere.
  const project = projectLabelByName(projects, skill.projects?.[0] || skill.project);
  const author = sharedResourceAttribution(skill)?.createdBy;
  /* `shared: true` marks the creator's own shared skill and one someone else
     shares alike; the detail view's actions tell the two apart. */
  const shared = skill.shared === true;
  return (
    <ListItem
      as="article"
      aria-label={skill.label}
      leading={<span className="font-mono text-sm font-medium">/</span>}
      title={skill.label}
      badges={(skill.enabled === false || skill.isBuiltin || shared) && (
        <>
          {skill.enabled === false && <Badge variant="muted" size="sm">Disabled</Badge>}
          {skill.isBuiltin && <Badge variant="muted" size="sm">Built-in</Badge>}
          {shared && <Badge variant="muted" size="sm">Shared</Badge>}
        </>
      )}
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
    />
  );
}

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

function SkillModal({ open, onClose, onSaved, onError, initial = null, projects = [], canShare = false }) {
  const isEdit = initial !== null;
  const [draft, setDraft] = useState({ label: '', description: '', declarative: '', project: ALL_PROJECTS, sharing: SKILL_SHARING_PRIVATE });
  const [busy, setBusy] = useState(false);
  /* Only a create asks who can use the skill, and only where the server lets
     this person share. An edit never changes sharing; that has its own control
     and its own refusals on the skill's page. */
  const asksSharing = !isEdit && canShare;

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDraft({ label: initial.label || '', description: initial.description || '', declarative: initial.declarative || '', project: initial.projects?.[0] || ALL_PROJECTS, sharing: SKILL_SHARING_PRIVATE });
    } else {
      setDraft({ label: '', description: '', declarative: '', project: ALL_PROJECTS, sharing: SKILL_SHARING_PRIVATE });
    }
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
    setBusy(true);
    try {
      const scopedProject = draft.project && draft.project !== ALL_PROJECTS ? [draft.project] : [];
      const payload = { label, description: draft.description, declarative: draft.declarative, projects: scopedProject };
      if (asksSharing) payload.shared = sharedFromValue(draft.sharing);
      const saved = await saveSkillAndSync(payload, isEdit);
      handleClose();
      await onSaved(saved);
    } catch (err) {
      onError?.(`Error: ${err.message}.`);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = draft.label.trim() && draft.declarative.trim() && !busy;

  return (
    <Modal open={open} onClose={handleClose} width="549px" labelledBy="skill-modal-title">
      <ModalHeader
        id="skill-modal-title"
        title={isEdit ? 'Edit Skill' : 'Add a Skill'}
        subtitle="Write a name, description, and instructions for the skill."
        onClose={handleClose}
      />
      <ModalBody padding="20px">
        <div className="flex flex-col gap-3">
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
          <Field label="Scope">
            <Select
              ariaLabel="Scope"
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
          {asksSharing && (
            <Field label={SKILL_SHARING_LABEL} help={SKILL_SHARING_CREATE_HINT}>
              <Select
                ariaLabel={SKILL_SHARING_LABEL}
                value={draft.sharing}
                onValueChange={(v) => setField('sharing', v)}
                style={{ ...fieldStyle, height: 34 }}
                options={SKILL_SHARING_OPTIONS}
              />
            </Field>
          )}
          <Field label="Description">
            <Textarea
              aria-label="Description"
              value={draft.description}
              onChange={(v) => setField('description', v)}
              placeholder="Generate weekly status reports from recent work. Use when asked for updates or progress summaries."
              style={{ ...fieldStyle, height: 80 }}
            />
          </Field>
          <Field label="Instructions">
            <Textarea
              aria-label="Instructions"
              value={draft.declarative}
              onChange={(v) => setField('declarative', v)}
              placeholder="Summarize my recent work in three sections: wins, blockers, and next steps. Keep the tone professional but not stiff..."
              style={{ ...fieldStyle, height: 198, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
            />
          </Field>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={handleClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSubmit} onClick={submit}>
          {!isEdit && !busy && Ico.plus(14)}
          {busy ? 'Saving…' : isEdit ? 'Save' : 'Create'}
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
      await onSaved(saved);
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
    { id: 'cowork', label: 'Create With Cowork',      icon: Ico.sparkle(14), onClick: () => onCowork?.(COWORK_PREFILL) },
    { id: 'upload', label: 'Upload a skill',           icon: Ico.upload(14),  onClick: onUpload },
    { id: 'write',  label: 'Write Skill Instructions', icon: Ico.edit(14),    onClick: onWrite },
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
  const onSkillSaved = (saved) => {
    showToast(`Saved ${saved?.label}.`, 'success');
  };

  const onSkillUploaded = async (saved) => {
    const refreshed = await reload({ afterCurrent: true });
    // An upload bypasses the store, so re-point the open skill from the list
    // this reload verified rather than from the upload response.
    const fresh = refreshed?.ok && Array.isArray(refreshed.skills)
      ? refreshed.skills.find((skill) => skill.label === saved?.label)
      : null;
    if (fresh) {
      setSelected((current) => (current?.label === fresh.label ? fresh : current));
    }
    onSkillSaved(saved);
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
    if (shared === (skill.shared === true)) return;
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
            actions={
              <>
                <Switch
                  checked={selected.enabled ?? true}
                  aria-label="Skill enabled"
                  disabled={!canUseSharedResource(selected, 'canDisable')}
                  title={!canUseSharedResource(selected, 'canDisable')
                    ? 'You do not have permission to enable or disable this skill.'
                    : isOwnSharedSkill(selected) ? OWN_SHARED_SWITCH_HINT : undefined}
                  onCheckedChange={async (next) => {
                    if (!canUseSharedResource(selected, 'canDisable')) return;
                    const targetLabel = selected.label;
                    setSelected((current) => (
                      current?.label === targetLabel
                        ? { ...current, enabled: next }
                        : current
                    ));
                    try {
                      /* The reload inside the save re-points the open skill
                         through the effect above; adopting the response here
                         would trade the catalogue entry for a serializer that
                         need not carry capabilities. */
                      await saveSkillAndSync({ label: targetLabel, enabled: next }, true);
                    } catch (err) {
                      setSelected((current) => (
                        current?.label === targetLabel
                          ? { ...current, enabled: !next }
                          : current
                      ));
                      showToast(err.message || 'Could not update skill.');
                    }
                  }}
                />
                <OverflowMenu
                  items={[
                    { id: 'try',       label: 'Try in chat', icon: Ico.chats(14),  onClick: () => onTryInChat?.(`/${selected.label}`, selected.projects?.[0]) },
                    {
                      id: 'edit', label: 'Edit', icon: Ico.edit(14),
                      disabled: !canUseSharedResource(selected, 'canEdit'),
                      hint: !canUseSharedResource(selected, 'canEdit')
                        ? lockedActionHint(selected)
                        : undefined,
                      title: !canUseSharedResource(selected, 'canEdit') ? 'You do not have permission to edit this skill.' : undefined,
                      onClick: () => startEdit(selected),
                    },
                    { divider: true },
                    {
                      id: 'uninstall', label: 'Uninstall', icon: Ico.trash(14), danger: true,
                      disabled: !canUseSharedResource(selected, 'canDelete'),
                      hint: !canUseSharedResource(selected, 'canDelete')
                        ? lockedActionHint(selected)
                        : undefined,
                      title: !canUseSharedResource(selected, 'canDelete') ? 'You do not have permission to uninstall this skill.' : undefined,
                      onClick: () => remove(selected),
                    },
                  ]}
                />
              </>
            }
          />
          <div className="pt-6 px-8 pb-8">

          <SharedResourceAttribution
            resource={selected}
            className={canUseSharedResource(selected, 'canEdit') && !isOwnSharedSkill(selected) ? 'mb-4' : 'mb-2'}
          />
          {!canUseSharedResource(selected, 'canEdit') && (
            <p className="m-0 mb-4 text-[12px] text-ink-3" role="note">
              {readOnlyNote(selected)}
            </p>
          )}
          {isOwnSharedSkill(selected) && (
            <p className="m-0 mb-4 text-[12px] text-ink-3" role="note">
              {OWN_SHARED_CHANGE_NOTE}
            </p>
          )}

          {/* Scope */}
          <div className="mb-4">
            <h3 className="s-h3 mt-0 mb-1">Scope</h3>
            <p className="m-0 text-[13.5px] text-ink leading-[1.5] select-text">
              {projectLabelByName(projects, selected.projects?.[0]) || 'All projects'}
            </p>
          </div>

          {/* Who can use it: only on the caller's own skill, where the server
              lets them share it. */}
          {canShareSkill(selected) && (
            <div className="mb-4">
              <h3 className="s-h3 mt-0 mb-1">{SKILL_SHARING_LABEL}</h3>
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
            </div>
          )}

          {/* Description */}
          {selected.description && (
            <div className="mb-4">
              <h3 className="s-h3 mt-0 mb-1">Description</h3>
              <p className="m-0 text-[13.5px] text-ink leading-[1.5] select-text">
                {selected.description}
              </p>
            </div>
          )}

          {/* Content card */}
          <div className="rounded-[20px] border border-solid border-line p-6 flex flex-col gap-4 bg-surface select-text">
            <MarkdownContent
              text={selected.declarative || ''}
              id={`skill-${selected.label}`}
              complete
              dense
            />
          </div>
        </div>
        </>
      ) : (
        // ── List ───────────────────────────────────────────────────────────
        <>
          <PageHeader
            title="Skills"
            subtitle="Extend Cowork's capabilities with task-specific skills"
            actions={<CreateSkillDropdown onWrite={startNew} onUpload={() => setUploadOpen(true)} onCowork={onCreateWithCowork} />}
          />

          <FilterRow
            search={<SearchInput inputRef={searchRef} value={search} onChange={setSearch} placeholder="Search skills" shortcut={null} />}
            sort={<SortPill value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />}
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
            <ListGroup className={LIST_CLASS}>
              {sorted.map((skill) => (
                <SkillRow key={skill.label} skill={skill} onClick={setSelected} projects={projects} />
              ))}
            </ListGroup>
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
        initial={modalSkill ?? null}
        projects={projects}
        canShare={canShare}
      />
    </div>
  );
}
