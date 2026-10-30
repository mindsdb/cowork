import { useEffect, useRef, useState } from 'react';
import { projectLabelByName } from '../lib/projectLabel';
import Ico from '../components/Icons';
import {
  PageHeader, FilterRow, SearchInput, SortPill, CollectionState,
  ListGroup, ListItem, useCollectionShortcut,
} from '../components/collection';
import { Menu, Badge, Button, Field, Select, Tooltip } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { Switch } from '../components/ui/Switch';
import { useToastManager } from '../components/ui/Toast';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import OverflowMenu from '../components/OverflowMenu';
import { fetchProjects, uploadSkillFile } from '../api';
import {
  useSkills, saveSkillAndSync, deleteSkillAndSync, setSkillSharingAndSync, setSkillAccessAndSync,
  setSkillEnabledForMeAndSync,
} from '../lib/skillsStore';
import { useHubTeams, useSharingCapabilities } from '../hooks/useOrgSharing';
import SkillShareMenu from '../components/SkillShareMenu';
import SkillDetail from '../components/SkillDetail';
import SkillModal, { OWN_SHARED_CHANGE_NOTE, skillFieldStyle } from '../components/SkillModal';
import { ShareStateLabel, shareStateIcon } from '../components/ShareStateLabel';
import {
  ALWAYS_ON_BADGE,
  ALWAYS_ON_BADGE_HINT,
  canChangeSkillAudience,
  canEditSkill,
  groupSkillsBySection,
  isSkillAlwaysOn,
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
  isOwnSharedSkill,
  isSharedSkill,
  sharedFromValue,
  sharingValue,
} from '../lib/skillSharing';

/* The same sentence cowork-server answers when it refuses a change to a skill
   someone else shares with the caller. */
const SHARED_SKILL_NOTE = "This skill is shared with you and can't be changed here.";

/* Why Edit or Uninstall is disabled, shown beside the menu item. Only an
   explicit `shared: true` names sharing. A built-in offers neither. */
function lockedActionHint(skill) {
  if (isSharedSkill(skill)) return 'Shared with you';
  return 'Admin or creator';
}

/* The detail note on an always-on team or org-wide skill someone else shares. */
const ALWAYS_ON_DETAIL = "It's part of every task, and only its owner can change it.";

const OWN_SHARED_SWITCH_HINT = "Turning it on or off changes it for everyone it's shared with.";
const OWN_SHARED_REMOVE_NOTE = "It's shared, so everyone it's shared with loses it too.";

// The detail view's note for a skill the caller can't edit.
function readOnlyNote(skill) {
  if (skill.isBuiltin) return 'Built-in skills are read only.';
  if (isSharedSkill(skill)) return SHARED_SKILL_NOTE;
  return 'Read only — only the creator or an organization admin can change this skill.';
}

/* The on/off switch, on a row and in the detail header. Its label and
   tooltip say what flipping it does; where it is locked, the tooltip says
   why. */
export const TURN_ON_LABEL = 'Turn on: Anton can use this skill';
export const TURN_OFF_LABEL = "Turn off: Anton won't use this skill";
const NO_PERMISSION_SWITCH_HINT = 'You do not have permission to enable or disable this skill.';

/* ENG-3787: a skill anyone else sees, and every built-in, has a switch "just
   for me": it turns the skill on or off in the caller's own tasks and leaves
   everyone else's alone. Only an editor turns it off for everyone, from the
   menu, and then the personal switch rests off and locked. */
export const TURN_ON_FOR_ME_LABEL = 'Turn on for me: Anton can use this skill in your tasks';
export const TURN_OFF_FOR_ME_LABEL = "Turn off for me: Anton won't use this skill in your tasks";
export const DISABLED_FOR_EVERYONE_HINT = 'Disabled for everyone by an editor';
export const DISABLED_FOR_EVERYONE_BADGE = 'Disabled for everyone';

/* Whether the skill's switch is the caller's own. The caller's own private
   skill keeps the one global switch, since nobody else uses it; so does a
   skill from a server that doesn't say who sees it. */
export function usesPersonalSwitch(skill) {
  return skill?.isBuiltin === true || skill?.visibleToOthers === true;
}

/* Whether the ⋯ menu offers "Disable/Enable for everyone": an editor's skill
   that someone else sees. Never a built-in. */
function offersEveryoneToggle(skill) {
  return !skill?.isBuiltin && skill?.visibleToOthers === true && skill?.canDisableForEveryone === true;
}

function SkillEnabledControl({ skill, checked, personal = false, disabledForEveryone = false, onChange, size = 'sm' }) {
  if (personal) {
    if (disabledForEveryone) {
      return (
        <Switch
          size={size}
          checked={false}
          aria-label={TURN_ON_FOR_ME_LABEL}
          title={DISABLED_FOR_EVERYONE_HINT}
          disabled
          onCheckedChange={() => {}}
        />
      );
    }
    const label = checked ? TURN_OFF_FOR_ME_LABEL : TURN_ON_FOR_ME_LABEL;
    return (
      <Switch
        size={size}
        checked={checked}
        aria-label={label}
        title={label}
        onCheckedChange={onChange}
      />
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
function SkillRow({ skill, onClick, projects = [], orgSharing = null, actions = null, disabled = false, disabledForEveryone = false }) {
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
  const hasBadges = disabled || disabledForEveryone || skill.isBuiltin || shared || audience || alwaysOn || sharedBy;
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
          {disabledForEveryone
            ? <Badge variant="muted" size="sm">{DISABLED_FOR_EVERYONE_BADGE}</Badge>
            : disabled && <Badge variant="muted" size="sm">Disabled</Badge>}
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

/* Whether the Built-in section is open. It starts folded; storage may be
   missing or refuse (a private window), and then it simply stays folded. */
const BUILTIN_OPEN_KEY = 'anton:skills-builtin-open';
function readBuiltinOpen() {
  try {
    return localStorage.getItem(BUILTIN_OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}
function writeBuiltinOpen(open) {
  try {
    localStorage.setItem(BUILTIN_OPEN_KEY, open ? 'true' : 'false');
  } catch {
    // Not remembered; the section still opens.
  }
}

/* The built-in skills, last on the page and folded by default: a header
   "Built-in · N" that opens and closes the rows. */
function BuiltinSection({ count, open, onToggle, children }) {
  const listId = 'skills-builtin-list';
  return (
    <section aria-label="Built-in" className="grid min-w-0 grid-cols-1 gap-2">
      <h2 className="m-0 flex min-h-8 items-center px-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={onToggle}
          className="inline-flex min-w-0 cursor-pointer items-center gap-2 rounded-[6px] border-0 bg-transparent p-0 font-body text-base font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          <span className="inline-flex text-ink-4" aria-hidden="true">{SECTION_ICONS.builtin(14)}</span>
          <span>Built-in</span>
          <span className="text-sm font-normal text-ink-4">
            · <span data-testid="section-count">{count}</span>
          </span>
          <span
            aria-hidden="true"
            className={`inline-flex text-ink-4 transition-transform duration-hover ${open ? 'rotate-180' : ''}`}
          >{Ico.chevDown(12)}</span>
        </button>
      </h2>
      {open && <ListGroup id={listId}>{children}</ListGroup>}
    </section>
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
                style={{ ...skillFieldStyle, height: 34 }}
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
  useCollectionShortcut(searchRef);
  /* Org sharing (ENG-3787) groups the list by who each skill reaches and
     replaces the "Who can use it" select with the Share dialog. Off on every
     other build, where the page is as it was. */
  const sharingCapabilities = useSharingCapabilities();
  const orgSharingOn = sharingCapabilities.enabled;
  const teamsState = useHubTeams(orgSharingOn);
  const orgSharing = orgSharingOn
    ? { teams: teamsState.teams, orgName: sharingCapabilities.org_name }
    : null;
  /* On/off changes in flight: skill label → the value asked for, so a
     switch moves at once and moves back on a refusal. `enabledPending` holds
     the skill's own `enabled` (everyone's), `forMePending` the caller's own
     setting. */
  const [enabledPending, setEnabledPending] = useState(() => new Map());
  const [forMePending, setForMePending] = useState(() => new Map());
  // Skill awaiting the "Disable for everyone" confirmation.
  const [disablingForEveryone, setDisablingForEveryone] = useState(null);
  // The Built-in section starts folded; opening it is remembered.
  const [builtinOpen, setBuiltinOpen] = useState(readBuiltinOpen);
  const toggleBuiltin = () => setBuiltinOpen((open) => {
    writeBuiltinOpen(!open);
    return !open;
  });

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
  const onSkillSaved = (saved, {
    shared = false, stoppedSharing = false, sharedWithAudience = false, updatedSharing = false,
  } = {}) => {
    const label = saved?.label;
    if (sharedWithAudience) showToast(`Created and shared ${label}.`, 'success');
    else if (updatedSharing) showToast(`Saved ${label} and updated who can use it.`, 'success');
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

  const patchOpen = (label, patch) => setSelected((current) => (
    current?.label === label ? { ...current, ...patch } : current
  ));
  const settle = (setPending, label) => setPending((current) => {
    const copy = new Map(current);
    copy.delete(label);
    return copy;
  });
  /* On/off requests can overlap when a switch is flipped quickly. Each one
     gets a number, and per skill and setting only the latest settles the
     switch, moves it back or says it failed; an earlier one's answer is
     ignored. `base` is what a failure of the latest moves back to: the value
     the last request to succeed set, else the one before the first. */
  const toggleRequests = useRef({ enabled: new Map(), forMe: new Map() });
  const toggleSeq = useRef(0);
  const beginToggle = (kind, label, current) => {
    const requests = toggleRequests.current[kind];
    const seq = ++toggleSeq.current;
    const inFlight = requests.get(label);
    requests.set(label, { seq, base: inFlight ? inFlight.base : current });
    const isLatest = () => requests.get(label)?.seq === seq;
    return {
      isLatest,
      succeeded: (value) => {
        const latest = requests.get(label);
        if (latest) latest.base = value;
      },
      base: () => requests.get(label)?.base ?? current,
      finish: () => { if (isLatest()) requests.delete(label); },
    };
  };

  /* Turns a skill on or off for everyone: its own `enabled`. The switch
     moves at once; a refusal moves it back and shows the server's sentence.
     The reload inside the save re-points the open skill through the effect
     above; adopting the response here would trade the catalogue entry for a
     serializer that need not carry capabilities. True once it is saved, and
     only for the latest request on the skill. */
  const writeEnabled = async (skill, next) => {
    const targetLabel = skill.label;
    const request = beginToggle('enabled', targetLabel, isEnabledForEveryone(skill));
    setEnabledPending((current) => new Map(current).set(targetLabel, next));
    patchOpen(targetLabel, { enabled: next });
    try {
      await saveSkillAndSync({ label: targetLabel, enabled: next }, true);
      request.succeeded(next);
      return request.isLatest();
    } catch (err) {
      if (!request.isLatest()) return false;
      patchOpen(targetLabel, { enabled: request.base() });
      showToast(err.message || 'Could not update skill.');
      return false;
    } finally {
      if (request.isLatest()) {
        request.finish();
        settle(setEnabledPending, targetLabel);
      }
    }
  };
  /* The switch on the caller's own private skill, which nobody else uses. */
  const setSkillEnabled = async (skill, next) => {
    if (!canUseSharedResource(skill, 'canDisable')) return;
    await writeEnabled(skill, next);
  };
  /* "Disable/Enable for everyone" from the menu of a skill others see. */
  const setEnabledForEveryone = async (skill, next) => {
    if (!offersEveryoneToggle(skill)) return;
    if (await writeEnabled(skill, next)) {
      showToast(next ? `Turned ${skill.label} on for everyone.` : `Turned ${skill.label} off for everyone.`, 'success');
    }
  };
  /* The switch "just for me" on a skill others see, or a built-in: the
     same optimistic move and rollback, through the caller's own setting. */
  const setSkillEnabledForMe = async (skill, next) => {
    const targetLabel = skill.label;
    const request = beginToggle('forMe', targetLabel, isEnabledForMe(skill));
    setForMePending((current) => new Map(current).set(targetLabel, next));
    patchOpen(targetLabel, { enabledForMe: next });
    try {
      await setSkillEnabledForMeAndSync(skill.slug || targetLabel, next);
      request.succeeded(next);
    } catch (err) {
      if (!request.isLatest()) return;
      patchOpen(targetLabel, { enabledForMe: request.base() });
      showToast(err.message || 'Could not update skill.');
    } finally {
      if (request.isLatest()) {
        request.finish();
        settle(setForMePending, targetLabel);
      }
    }
  };
  const isEnabledForEveryone = (skill) => enabledPending.get(skill.label) ?? skill.enabled ?? true;
  const isEnabledForMe = (skill) => forMePending.get(skill.label) ?? skill.enabledForMe ?? true;
  /* Whether Anton uses the skill in the caller's tasks: on for everyone and
     on for them. A change in flight to a private skill's switch shows as
     asked, since turning it on clears the caller's own off too. */
  const isEnabled = (skill) => {
    if (!usesPersonalSwitch(skill) && enabledPending.has(skill.label)) return enabledPending.get(skill.label);
    return isEnabledForEveryone(skill) && isEnabledForMe(skill);
  };
  /* An editor turned it off for everyone; every viewer is told. */
  const isDisabledForEveryone = (skill) => usesPersonalSwitch(skill) && !isEnabledForEveryone(skill);

  /* Whether the open skill offers Share: the caller's own, on an org. */
  const canOpenShare = (skill) => orgSharingOn && canChangeSkillAudience(skill);
  /* An org skill someone else owns keeps no Edit or Uninstall at all, and a
     built-in never does. */
  const hidesOwnerActions = (skill) => !!skill.isBuiltin || (orgSharingOn && !canEditSkill(skill));
  /* A team or org-wide skill someone else owns. */
  const alwaysApplied = (skill) => orgSharingOn && !canEditSkill(skill)
    && (skillSection(skill) === 'team' || skillSection(skill) === 'org');
  const enabledControl = (skill, size) => {
    const personal = usesPersonalSwitch(skill);
    return (
      <SkillEnabledControl
        size={size}
        skill={skill}
        personal={personal}
        checked={personal ? isEnabledForMe(skill) : isEnabled(skill)}
        disabledForEveryone={isDisabledForEveryone(skill)}
        onChange={(next) => (personal ? setSkillEnabledForMe(skill, next) : setSkillEnabled(skill, next))}
      />
    );
  };
  /* "Disable for everyone" asks first; "Enable for everyone" just does it. */
  const everyoneMenuItems = (skill) => {
    if (!offersEveryoneToggle(skill)) return [];
    return isEnabledForEveryone(skill)
      ? [{ id: 'disable-everyone', label: 'Disable for everyone', icon: Ico.powerOff(14), onClick: () => setDisablingForEveryone(skill) }]
      : [{ id: 'enable-everyone', label: 'Enable for everyone', icon: Ico.power(14), onClick: () => setEnabledForEveryone(skill, true) }];
  };
  /* The skill's menu: Try in chat, on or off for everyone where the caller
     edits a skill others see, then Edit and Uninstall where they apply. */
  const skillMenuItems = (skill) => [
    { id: 'try', label: 'Try in chat', icon: Ico.chats(14), onClick: () => onTryInChat?.(`/${skill.label}`, skill.projects?.[0]) },
    ...everyoneMenuItems(skill),
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

  // Without org sharing the list is flat, built-ins folded away at the end.
  const ownSkills = sorted.filter((skill) => !skill.isBuiltin);
  const builtinSkills = sorted.filter((skill) => skill.isBuiltin);
  const skillRow = (skill) => (
    <SkillRow
      key={skill.label}
      skill={skill}
      onClick={setSelected}
      projects={projects}
      orgSharing={orgSharing}
      actions={rowActions(skill)}
      disabled={!usesPersonalSwitch(skill) && skill.enabled === false}
      disabledForEveryone={isDisabledForEveryone(skill)}
    />
  );

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
            disabledForEveryone={isDisabledForEveryone(selected)}
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
          {/* Same header as Projects, Tasks and Artifacts: title, subtitle
              and the primary action, then the search/sort toolbar. */}
          <PageHeader
            title="Skills"
            subtitle="Extend Cowork's capabilities with task-specific skills"
            actions={<CreateSkillDropdown onWrite={startNew} onUpload={() => setUploadOpen(true)} onCowork={onCreateWithCowork} />}
          />
          <FilterRow
            search={<SearchInput inputRef={searchRef} value={search} onChange={setSearch} placeholder="Search skills" />}
            sort={<SortPill value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />}
            counts={skills === null || skills.length === 0 ? null : (
              search.trim()
                ? `${sorted.length} of ${skills.length} skills`
                : `${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`
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
                {groupSkillsBySection(sorted, { orgName: orgSharing.orgName }).map((group) => (group.id === 'builtin' ? (
                  <BuiltinSection key={group.id} count={group.skills.length} open={builtinOpen} onToggle={toggleBuiltin}>
                    {group.skills.map(skillRow)}
                  </BuiltinSection>
                ) : (
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
                    {group.skills.map(skillRow)}
                  </ListGroup>
                )))}
              </div>
            ) : (
              <div className={`${LIST_CLASS} flex flex-col gap-6`}>
                {ownSkills.length > 0 && <ListGroup>{ownSkills.map(skillRow)}</ListGroup>}
                {builtinSkills.length > 0 && (
                  <BuiltinSection count={builtinSkills.length} open={builtinOpen} onToggle={toggleBuiltin}>
                    {builtinSkills.map(skillRow)}
                  </BuiltinSection>
                )}
              </div>
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
      <ConfirmModal
        open={!!disablingForEveryone}
        title={disablingForEveryone ? `Turn off ${disablingForEveryone.label} for everyone it's shared with?` : ''}
        message="Anton won't use it in anyone's tasks until an editor turns it back on."
        confirmLabel="Disable for everyone"
        destructive
        onClose={() => setDisablingForEveryone(null)}
        onConfirm={() => {
          const skill = disablingForEveryone;
          setDisablingForEveryone(null);
          if (skill) setEnabledForEveryone(skill, false);
        }}
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
