// Context card body — surfaces memories (Project + Global) AND
// project instructions (`.anton/anton.md`) plus any legacy `.context/`
// files. Listed via GET /projects/{name}/files; Working folder hides
// `.anton/` and `.context/` trees except this rail shows instructions
// (and legacy context paths).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import {
  attachmentRawUrl,
  deleteAttachment,
  deleteMemory,
  deleteProjectFile,
  fetchAttachments,
  fetchMemory,
  findMemoryEntry,
  labelCategory,
  listProjectFiles,
  moveAttachmentToProject,
  saveMemory,
  uploadAttachments,
  uploadProjectFiles,
  ANTON_PROJECT_INSTRUCTIONS_PATH,
} from '../../api';
import ContextFileModal from '../project/ContextFileModal';
import { ConfirmModal } from '../ConfirmModal';
import { OverflowMenu } from '../OverflowMenu';
import * as host from '../../../platform/host';
import { useFileDrop, FileDropOverlay } from '../../lib/useFileDrop';

function relativeAge(ts) {
  if (!ts) return '';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

function MemoryRow({ entry, onOpen }) {
  // Single-line row — the previous version displayed
  // `previewFirstLine(entry.content)` underneath the filename, which
  // for the canonical files (lessons.md, rules.md, identity.md, …)
  // is just the H1 of the file and reads as a duplicate of the
  // filename itself. Hover/click opens the editor, which has the
  // full content; the rail row only needs the file identity + age.
  return (
    <button
      type="button"
      onClick={onOpen}
      title={entry.content || labelCategory(entry.category)}
      className={clsx(
        'group grid items-center gap-2 rounded-card-row px-1 py-1 text-left',
        'cursor-pointer transition-colors hover:bg-surface-2',
        'border-0 bg-transparent w-full'
      )}
      style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
    >
      <span className="text-ink-4 inline-flex flex-none">{Ico.code(13)}</span>
      <span className="block truncate text-[12.5px] text-ink min-w-0">
        {labelCategory(entry.category) || entry.name}
      </span>
      {entry.modifiedAt && (
        <span className="text-[10.5px] text-ink-4">{relativeAge(entry.modifiedAt)}</span>
      )}
    </button>
  );
}

// Row for a project context file (anton.md or any uploaded file).
// Same visual rhythm as MemoryRow but distinguishes the always-
// present anton.md with a subtle "Project instructions" label.
function attachmentSourceIcon(item) {
  const source = item.source || item.kind || 'file';
  if (source === 'connector') return Ico.link(13);
  if (item.mime && String(item.mime).startsWith('image/')) return Ico.image(13);
  return Ico.doc(13);
}

function SessionAttachmentRow({
  item, menuOpen, onMenuOpenChange, onOpen, menuItems = [],
}) {
  const label = item.name || item.id || 'Attachment';
  const when = item.updated_at || item.created_at || item.updatedAt || item.createdAt;
  // The mime/size used to be a second visible line — moved to the
  // hover tooltip so the row is one line like Project Files. Same
  // info, half the vertical weight in the rail.
  const titleSegments = [
    item.note || item.textPreview || null,
    item.mime || null,
    item.size ? `${Math.ceil(item.size / 1024)} KB` : null,
  ].filter(Boolean);
  const titleText = titleSegments.length ? `${label} — ${titleSegments.join(' · ')}` : label;
  const canOpen = !!onOpen;
  const hasMenuActions = menuItems.length > 0;
  return (
    <div
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? onOpen : undefined}
      onKeyDown={canOpen
        ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }
        : undefined}
      title={titleText}
      className={clsx(
        'group relative grid items-center gap-2 rounded-card-row px-1 py-1 text-left',
        canOpen && 'cursor-pointer transition-colors hover:bg-surface-2',
        'outline-none focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-accent'
      )}
      style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
    >
      <span className="text-ink-4 inline-flex flex-none">{attachmentSourceIcon(item)}</span>
      <span className="block truncate text-[12.5px] text-ink min-w-0">{label}</span>
      {/* Trailing slot: age normally, kebab on hover or while the
          row's menu is open. Same shared-slot trick as Project Files'
          trash so the row width doesn't jump. */}
      <span className="relative inline-flex items-center justify-end flex-none" style={{ minWidth: 16 }}>
        {when ? (
          <span className={clsx(
            'text-[10.5px] text-ink-4 transition-opacity',
            hasMenuActions && 'group-hover:opacity-0',
            menuOpen && 'opacity-0',
          )}>
            {relativeAge(when)}
          </span>
        ) : null}
        {hasMenuActions && (
          <OverflowMenu
            open={menuOpen}
            onOpenChange={onMenuOpenChange}
            ariaLabel="Task upload actions"
            width={180}
            items={menuItems}
            triggerClassName={clsx(
              'absolute inset-0 inline-flex items-center justify-end',
              menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
          />
        )}
      </span>
    </div>
  );
}

function ContextFileRow({ file, onOpen, onRequestDelete }) {
  const isAnton = file.path === ANTON_PROJECT_INSTRUCTIONS_PATH;
  // The instructions file is foundational (Anton reads it on every
  // turn). Surfacing a delete on hover would tempt a misclick; the
  // ContextFileModal opened by clicking the row also hides the
  // delete affordance for `.anton/anton.md` — same rule both places.
  const canDelete = !isAnton && !!onRequestDelete;
  // The row was a <button>, but nesting a <button> inside a
  // <button> is invalid HTML and breaks the trash icon's click in
  // some browsers. Switch the outer to a div with role="button" so
  // the trash can be a real interactive child.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
      title={`${file.path}${file.size ? ` · ${Math.ceil(file.size / 1024)} KB` : ''}`}
      className={clsx(
        'group grid items-center gap-2 rounded-card-row px-1 py-1 text-left',
        'cursor-pointer transition-colors hover:bg-surface-2',
        'outline-none focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-accent'
      )}
      style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
    >
      <span className="text-ink-4 inline-flex flex-none">{Ico.doc(13)}</span>
      <span className="block truncate text-[12.5px] text-ink min-w-0">
        {isAnton ? 'Instructions' : (file.path || file.name)}
      </span>
      {/* Trailing slot: age normally, trash on hover. Both share
          the same column with relative/absolute stacking so the
          row width doesn't change between hover states. The age
          drives the column's intrinsic width (the trash icon is
          ~14px wide, roughly the same as "1m"/"2h"/"3d"). */}
      <span className="relative inline-flex items-center justify-end flex-none" style={{ minWidth: 16 }}>
        {file.modified ? (
          <span className={clsx(
            'text-[10.5px] text-ink-4 transition-opacity',
            canDelete && 'group-hover:opacity-0 group-focus-within:opacity-0',
          )}>
            {relativeAge(file.modified * 1000)}
          </span>
        ) : null}
        {canDelete && (
          <button
            type="button"
            aria-label={`Delete ${file.path || file.name}`}
            title="Delete file"
            onClick={(e) => {
              // Don't let the click bubble up to the row — that
              // would open the file modal instead of confirming
              // a delete.
              e.stopPropagation();
              onRequestDelete(file);
            }}
            className={clsx(
              'absolute inset-0 inline-flex items-center justify-end',
              'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              'transition-opacity rounded',
              'text-ink-4 hover:text-danger',
              'bg-transparent border-0 cursor-pointer p-0',
            )}
          >
            {Ico.trash(13)}
          </button>
        )}
      </span>
    </div>
  );
}

// A Google-Drive-picked file, reference-only — no bytes ever land in
// the project folder. Clicking opens the file in Drive itself rather
// than the ContextFileModal preview, since there's no local content to
// show.
function DriveReferenceRow({ file, onRequestDelete }) {
  const openInDrive = () => { if (file.url) host.openExternal(file.url); };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openInDrive}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInDrive(); } }}
      title={`Open "${file.name}" in Google Drive`}
      className={clsx(
        'group grid items-center gap-2 rounded-card-row px-1 py-1 text-left',
        'cursor-pointer transition-colors hover:bg-surface-2',
        'outline-none focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-accent'
      )}
      style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
    >
      <span className="text-ink-4 inline-flex flex-none">{Ico.googleDrive(13)}</span>
      <span className="block truncate text-[12.5px] text-ink min-w-0">{file.name || 'untitled'}</span>
      {/* Both actions show together on hover — unlike ContextFileRow's
          single age/trash swap, there's no "normal" state content to
          protect here, so open + delete can just sit side by side. */}
      <span className={clsx(
        'inline-flex items-center gap-1 flex-none transition-opacity',
        'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
      )}>
        <span
          role="button"
          tabIndex={-1}
          aria-hidden
          title="Open in Google Drive"
          className="text-ink-4 inline-flex items-center justify-center"
        >
          {Ico.externalLink(11)}
        </span>
        {onRequestDelete && (
          <button
            type="button"
            aria-label={`Remove ${file.name || 'file'} from project files`}
            title="Remove from project files"
            onClick={(e) => {
              // Don't let the click bubble up to the row — that would
              // open the file in Drive instead of confirming a delete.
              e.stopPropagation();
              onRequestDelete(file);
            }}
            className={clsx(
              'inline-flex items-center justify-center rounded',
              'text-ink-4 hover:text-danger',
              'bg-transparent border-0 cursor-pointer p-0',
            )}
          >
            {Ico.trash(13)}
          </button>
        )}
      </span>
    </div>
  );
}

export function ContextCard({ project, conversationId, refreshKey = 0, onAddGoogleDriveFiles, onFetchGoogleDriveFiles, onRemoveGoogleDriveFile }) {
  const [sections, setSections] = useState([]);
  const [projectFiles, setProjectFiles] = useState([]);
  // Google Drive files the user picked via "Attach Google Drive files"
  // below — reference-only (name + link), never downloaded. They live
  // on the connection's _picked_files grant, not in the project folder,
  // so they're tracked separately from `projectFiles` and merged only
  // at render time.
  const [driveFiles, setDriveFiles] = useState([]);
  const [sessionAttachments, setSessionAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState(null);
  // `openEntry` is a memory file; `openFile` is a project context
  // file. Both feed into `ContextFileModal` (one component, two
  // wirings) so the UX feels identical regardless of which surface
  // the row was opened from.
  const [openEntry, setOpenEntry] = useState(null);
  const [openFile, setOpenFile] = useState(null);
  // A task upload opened in the file modal — same component/UX as
  // project files, but driven by the attachment's raw URL (no project
  // file path, so the modal renders images inline and opens others in
  // the OS shell rather than doing project-file IO).
  const [openAttachment, setOpenAttachment] = useState(null);
  const [showAll, setShowAll] = useState(false);
  // Row-level delete + header-level upload state.
  // `pendingDeleteFile` drives the ConfirmModal — set when the user
  // clicks the trash icon on a row, cleared on close/confirm. We
  // follow the established ConfirmModal pattern (lifted state +
  // payload) but keep it local to ContextCard rather than prop-
  // drilling up to App.jsx — the delete is internal to the rail
  // and doesn't need to participate in app-level routing.
  const [pendingDeleteFile, setPendingDeleteFile] = useState(null);
  const [pendingDeleteDriveFile, setPendingDeleteDriveFile] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  // Separate from uploadBusy: the Drive connect-then-pick flow can now take
  // minutes (waiting on OAuth + the picker), not the near-instant round trip
  // local uploads are. Gating the whole menu trigger on one shared flag
  // would disable the unrelated "Attach files" (local) item for that whole
  // wait — this only disables the "Attach Google Drive files" item itself.
  const [drivePickerBusy, setDrivePickerBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);
  // Mirror state for the Task Uploads section — separate from project
  // files because upload/delete hit different endpoints and a busy
  // state in one shouldn't grey out the other.
  const [taskUploadBusy, setTaskUploadBusy] = useState(false);
  const [taskUploadError, setTaskUploadError] = useState('');
  const taskUploadInputRef = useRef(null);
  // Which attachment's kebab menu is currently open. Single-open
  // policy — clicking one closes any other. The popup itself is rendered
  // by the shared Base UI-backed <OverflowMenu>, so it portals out of the
  // RailCard overflow container and keeps keyboard/focus behavior in one
  // place.
  const [openAttachmentMenuId, setOpenAttachmentMenuId] = useState(null);
  const [pendingDeleteAttachment, setPendingDeleteAttachment] = useState(null);
  // Bump to re-run the attachments effect after a mutation (upload /
  // delete / move) without needing to wire `onChanged` up to App.jsx.
  const [attachmentsTick, setAttachmentsTick] = useState(0);
  const bumpAttachments = useCallback(() => setAttachmentsTick((n) => n + 1), []);

  const applyMemorySections = useCallback((data) => {
    if (!data?.sections) return;
    setSections(data.sections);
    setOpenEntry((prev) => (
      prev?.path ? findMemoryEntry(data.sections, prev.path) || prev : prev
    ));
  }, []);

  const reloadMemory = useCallback(() => (
    fetchMemory(project)
      .then((data) => {
        applyMemorySections(data);
        return data;
      })
      .catch(() => null)
  ), [project?.id, project?.path, applyMemorySections]);

  const openMemoryEntry = useCallback((entry) => {
    reloadMemory().then((data) => {
      const fresh = data?.sections
        ? findMemoryEntry(data.sections, entry.path) || entry
        : entry;
      setOpenEntry(fresh);
    });
  }, [reloadMemory]);

  useEffect(() => {
    let cancelled = false;
    fetchMemory(project)
      .then((data) => {
        if (cancelled) return;
        applyMemorySections(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project?.id, project?.path, refreshKey, applyMemorySections]);

  // Ticket pattern: every instructions fetch (mount + reload-on-
  // edit) bumps `loadVersion`. The async response only applies its
  // result if its ticket is still the latest. Without this, saving a
  // context edit and immediately switching projects could let the
  // late response paint into the new project — the same shape of
  // bug WorkingFolderLive had.
  const loadVersion = useRef(0);

  // List every file in the working folder (the project root). Anton
  // creates files in here as the project evolves (the instructions
  // file, scratchpad outputs, generated artifacts, etc.). The card
  // surfaces all of them so the user has a single view of the
  // project's real state. Hidden dirs (`.anton/` body, `.git/`, etc.)
  // are filtered out, with the canonical `.anton/anton.md`
  // instructions row pinned to the top so it's always reachable.
  const reloadFiles = useCallback(() => {
    if (!project?.name) { setProjectFiles([]); return; }
    const ticket = ++loadVersion.current;
    listProjectFiles(project.name)
      .then((data) => {
        if (ticket !== loadVersion.current) return;
        const all = Array.isArray(data?.files) ? data.files : [];
        // Filter: keep the canonical instructions file from `.anton/`
        // but otherwise hide hidden trees (anything starting with `.`
        // at any path segment) so the rail isn't drowned in
        // metadata. Same heuristic as WorkingFolderLive's filter
        // before we switched it to the artifacts-only registry.
        const visible = all.filter((f) => {
          if (!f || f.is_dir) return false;
          const p = String(f.path || '');
          if (p === ANTON_PROJECT_INSTRUCTIONS_PATH) return true;
          // Hide hidden segments.
          if (p.split('/').some((seg) => seg.startsWith('.'))) return false;
          return true;
        });
        // Instructions first, then everything else by mtime desc.
        visible.sort((a, b) => {
          const ai = a.path === ANTON_PROJECT_INSTRUCTIONS_PATH ? 0 : 1;
          const bi = b.path === ANTON_PROJECT_INSTRUCTIONS_PATH ? 0 : 1;
          if (ai !== bi) return ai - bi;
          return (b.modified || 0) - (a.modified || 0);
        });
        setProjectFiles(visible);
      })
      .catch(() => { if (ticket === loadVersion.current) setProjectFiles([]); });
  }, [project?.name]);

  useEffect(() => {
    if (!project?.name) {
      setProjectFiles([]);
      // Bump the ticket so any in-flight load from a prior project
      // gets discarded when it finally lands.
      loadVersion.current += 1;
      return;
    }
    reloadFiles();
  }, [project?.name, reloadFiles]);

  // Google Drive reference files live on the connection's _picked_files
  // grant, but each entry is tagged with the project(s) it was added
  // to — App.jsx's fetchGoogleDriveReferenceFiles filters to just this
  // project, so this does depend on `project.name` the same way
  // reloadFiles does.
  const reloadDriveFiles = useCallback(() => {
    if (!onFetchGoogleDriveFiles || !project?.name) { setDriveFiles([]); return; }
    onFetchGoogleDriveFiles(project.name)
      .then((res) => setDriveFiles(Array.isArray(res?.files) ? res.files : []))
      .catch(() => setDriveFiles([]));
  }, [onFetchGoogleDriveFiles, project?.name]);

  useEffect(() => {
    reloadDriveFiles();
  }, [reloadDriveFiles, refreshKey]);

  const sessionRelevant = conversationId
    && !String(conversationId).startsWith('tmp-')
    && !!project?.name;

  // `useEffect` runs after paint — switching tasks would briefly show the
  // previous task's rows with "Loading attachments…". This runs first
  // and clears before paint. Loading is only set here on conversation
  // change (not on refreshKey), so same-task refetches stay quiet.
  useLayoutEffect(() => {
    if (!sessionRelevant) {
      setSessionAttachments([]);
      setAttachmentsError(null);
      setAttachmentsLoading(false);
      return;
    }
    setSessionAttachments([]);
    setAttachmentsError(null);
    setAttachmentsLoading(true);
  }, [conversationId, sessionRelevant]);

  useEffect(() => {
    if (!sessionRelevant) {
      return undefined;
    }
    let cancelled = false;
    setAttachmentsError(null);
    fetchAttachments(project.name, conversationId)
      .then((data) => {
        if (cancelled) return;
        const raw = Array.isArray(data?.attachments) ? data.attachments : [];
        const sorted = [...raw].sort((a, b) => {
          const ta = new Date(a.updated_at || a.created_at || a.updatedAt || a.createdAt || 0).getTime();
          const tb = new Date(b.updated_at || b.created_at || b.updatedAt || b.createdAt || 0).getTime();
          return tb - ta;
        });
        setSessionAttachments(sorted);
      })
      .catch((err) => {
        if (!cancelled) {
          setSessionAttachments([]);
          setAttachmentsError(err?.message || 'Could not load attachments');
        }
      })
      .finally(() => {
        if (!cancelled) setAttachmentsLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionRelevant, conversationId, refreshKey, project?.name, attachmentsTick]);

  // Order: Project section first, Global second.
  const ordered = useMemo(() => {
    const sorted = [...sections].sort((a, b) => {
      if (a.scope === 'Project' && b.scope !== 'Project') return -1;
      if (b.scope === 'Project' && a.scope !== 'Project') return 1;
      return 0;
    });
    return sorted.map((s) => ({
      ...s,
      files: (s.files || [])
        .filter((f) => String(f.content || '').trim())
        .map((f) => ({
          ...f,
          scope: s.scope,
        })),
    }));
  }, [sections]);

  const totalMemoryFiles = useMemo(() => ordered.reduce((n, s) => n + s.files.length, 0), [ordered]);
  const hasProjectFiles = projectFiles.length > 0;
  const hasDriveFiles = driveFiles.length > 0;
  const hasAnyProjectFiles = hasProjectFiles || hasDriveFiles;

  // Suppress the whole card only when there's truly nothing to act
  // on AND no project to upload into. Inside a project we always
  // render the Files section so the new "+ Add file" / empty-state
  // upload affordance is reachable on a fresh project too.
  const blockGlobalEmpty = !project?.name
    && totalMemoryFiles === 0
    && !hasAnyProjectFiles
    && !sessionRelevant;

  // Drag OS files onto the context card to add them as PROJECT files.
  // Reuses the same upload + reload the "+ Add file" affordance uses.
  const handleProjectFilesDrop = async (files) => {
    if (!files.length || !project?.name) return;
    setUploadError('');
    setUploadBusy(true);
    try {
      await uploadProjectFiles(project.name, files);
      reloadFiles();
    } catch (err) {
      setUploadError(err?.message || 'Upload failed.');
    } finally {
      setUploadBusy(false);
    }
  };
  const { isDragging: projectFilesDragging, dropHandlers: projectFileDropHandlers } = useFileDrop({
    onFiles: handleProjectFilesDrop,
    disabled: !project?.name || uploadBusy,
  });

  if (blockGlobalEmpty) {
    return (
      <p className="text-[12.5px] text-ink-4 px-1 pt-2 pb-1">
        The agent learns as you work — memories will appear here.
      </p>
    );
  }

  return (
    <div className="relative flex flex-col gap-3 pt-2" {...projectFileDropHandlers}>
      <FileDropOverlay active={projectFilesDragging} label="Drop files to add to project" />
      {/* All working-folder files. Instructions row is pinned first;
          the rest follow by most-recent-mtime. >10 files gets a
          fixed-height scroll container so the rail stays compact.
          Always render the section (even when empty) when the
          project is loaded, so the "+ Add file" affordance is
          reachable on fresh projects too. */}
      {project?.name && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="font-display text-[10.5px] font-semibold uppercase tracking-widest text-ink-4">
              Project files{(projectFiles.length + driveFiles.length) > 1 ? ` · ${projectFiles.length + driveFiles.length}` : ''}
            </span>
            <OverflowMenu
              icon={Ico.plus(13)}
              label="Add files to this project"
              title={uploadBusy ? 'Uploading…' : 'Add files to this project'}
              disabled={uploadBusy}
              width={220}
              triggerClassName="h-5 w-5 justify-center rounded hover:bg-surface-2"
              items={[
                {
                  id: 'attach-computer',
                  label: 'Attach files',
                  icon: Ico.upload(13),
                  onClick: () => fileInputRef.current?.click(),
                },
                onAddGoogleDriveFiles && {
                  id: 'attach-gdrive',
                  label: drivePickerBusy ? 'Connecting…' : 'Attach Google Drive files',
                  icon: Ico.googleDrive(13),
                  disabled: drivePickerBusy,
                  onClick: () => {
                    setDrivePickerBusy(true);
                    setUploadError('');
                    Promise.resolve(onAddGoogleDriveFiles(project?.name))
                      .then(() => reloadDriveFiles())
                      .catch((err) => setUploadError(err?.message || 'Could not add Google Drive files.'))
                      .finally(() => setDrivePickerBusy(false));
                  },
                },
              ].filter(Boolean)}
            />
          </div>
          {/* Hidden file input — driven by the visible "+" button so
              we get the OS file picker for free. `multiple` matches
              the upload API which accepts a list. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              // Reset the input so re-uploading the same filename
              // re-triggers `onChange` (browsers dedupe by value).
              e.target.value = '';
              if (!files.length || !project?.name) return;
              setUploadBusy(true);
              setUploadError('');
              try {
                await uploadProjectFiles(project.name, files);
                reloadFiles();
              } catch (err) {
                setUploadError(err?.message || 'Upload failed.');
              } finally {
                setUploadBusy(false);
              }
            }}
          />
          {uploadError && (
            <p className="text-[11px] px-1 pb-0.5" style={{ color: 'var(--danger)' }}>
              {uploadError}
            </p>
          )}
          {!hasAnyProjectFiles && !uploadBusy && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={clsx(
                'flex items-center gap-2 px-1 py-1 rounded-card-row',
                'text-[12px] text-ink-4 hover:text-ink hover:bg-surface-2',
                'cursor-pointer bg-transparent border-0 text-left',
              )}
            >
              <span className="text-ink-4 inline-flex flex-none">{Ico.upload(13)}</span>
              <span>Add files to give the agent context.</span>
            </button>
          )}
          {hasAnyProjectFiles && (
            <div
              className={clsx(
                'flex flex-col gap-0.5',
                (projectFiles.length + driveFiles.length) > 10 && 'overflow-y-auto pr-1 scroll-clean',
              )}
              style={(projectFiles.length + driveFiles.length) > 10 ? { maxHeight: 220 } : undefined}
            >
              {projectFiles.map((f) => (
                <ContextFileRow
                  key={f.path}
                  file={f}
                  onOpen={() => setOpenFile(f)}
                  onRequestDelete={(file) => setPendingDeleteFile(file)}
                />
              ))}
              {driveFiles.map((f) => (
                <DriveReferenceRow
                  key={`gdrive-${f.id}`}
                  file={f}
                  onRequestDelete={(file) => setPendingDeleteDriveFile(file)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {sessionRelevant && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between px-1 mb-1">
            <span className="font-display text-[10.5px] font-semibold uppercase tracking-widest text-ink-4">
              Task uploads{sessionAttachments.length > 1 ? ` · ${sessionAttachments.length}` : ''}
            </span>
            <button
              type="button"
              aria-label="Attach files to this task"
              title={taskUploadBusy ? 'Uploading…' : 'Attach files to this task'}
              disabled={taskUploadBusy}
              onClick={() => taskUploadInputRef.current?.click()}
              className={clsx(
                'inline-flex items-center justify-center',
                'h-5 w-5 rounded',
                'text-ink-4 hover:text-ink hover:bg-surface-2',
                'transition-colors bg-transparent border-0 cursor-pointer',
                'disabled:opacity-50 disabled:cursor-wait',
              )}
            >
              {Ico.plus(13)}
            </button>
          </div>
          <input
            ref={taskUploadInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              if (!files.length || !project?.name || !conversationId) return;
              setTaskUploadBusy(true);
              setTaskUploadError('');
              try {
                await uploadAttachments(files, { projectName: project.name, sessionId: conversationId });
                bumpAttachments();
              } catch (err) {
                setTaskUploadError(err?.message || 'Upload failed.');
              } finally {
                setTaskUploadBusy(false);
              }
            }}
          />
          {taskUploadError && (
            <p className="text-[11px] px-1 pb-0.5" style={{ color: 'var(--danger)' }}>
              {taskUploadError}
            </p>
          )}
          {attachmentsLoading && (
            <p className="text-[12px] text-ink-4 px-1 pb-0.5">Loading attachments…</p>
          )}
          {attachmentsError && (
            <p className="text-[12px] px-1 pb-0.5" style={{ color: 'var(--danger-600, #b3261e)' }}>
              {attachmentsError}
            </p>
          )}
          {!attachmentsLoading && !attachmentsError && sessionAttachments.length === 0 && !taskUploadBusy && (
            <button
              type="button"
              onClick={() => taskUploadInputRef.current?.click()}
              className={clsx(
                'flex items-center gap-2 px-1 py-1 rounded-card-row',
                'text-[12px] text-ink-4 hover:text-ink hover:bg-surface-2',
                'cursor-pointer bg-transparent border-0 text-left',
              )}
            >
              {/* Same attach-paperclip glyph the empty-state used,
                  but the row is now an active "click to upload"
                  affordance — the explicit "+" header button is the
                  primary surface, this is a fallback for when the
                  list is empty and the user might miss the header. */}
              <span className="text-ink-4 inline-flex flex-none">{Ico.attach(13)}</span>
              <span>No files attached yet — click to add.</span>
            </button>
          )}
          {!attachmentsLoading
            && sessionAttachments.map((item) => {
              const rawUrl = attachmentRawUrl(project?.name, conversationId, item.id);
              const closeAttachmentMenu = () => setOpenAttachmentMenuId(null);
              const menuItems = [
                rawUrl && {
                  id: 'open',
                  label: 'Open',
                  icon: Ico.upload(13),
                  onClick: () => {
                    closeAttachmentMenu();
                    host.openExternal(rawUrl);
                  },
                },
                {
                  id: 'move',
                  label: 'Move to project files',
                  icon: Ico.folder(13),
                  onClick: () => {
                    closeAttachmentMenu();
                    // Optimistic: drop from Task uploads right away
                    // so the row disappears the moment the user
                    // clicks. The server move is fast (rename(2) on
                    // local disk) but the followup fetchAttachments
                    // round-trip adds visible latency. We refetch
                    // project files after the server confirms so the
                    // moved row appears in PROJECT FILES, and on
                    // error we reattach the row to TASK UPLOADS.
                    const previous = item;
                    setSessionAttachments((prev) => prev.filter((a) => a.id !== item.id));
                    (async () => {
                      try {
                        await moveAttachmentToProject(project.name, conversationId, item.id);
                        reloadFiles();
                      } catch (err) {
                        setTaskUploadError(err?.message || 'Could not move file.');
                        // Restore the row so the user sees the
                        // file still belongs to the task.
                        setSessionAttachments((prev) => {
                          if (prev.find((a) => a.id === previous.id)) return prev;
                          return [previous, ...prev];
                        });
                      }
                    })();
                  },
                },
                { separator: true },
                {
                  id: 'delete',
                  label: 'Delete',
                  icon: Ico.trash(13),
                  danger: true,
                  onClick: () => {
                    closeAttachmentMenu();
                    setPendingDeleteAttachment(item);
                  },
                },
              ].filter(Boolean);
              return (
                <SessionAttachmentRow
                  key={item.id}
                  item={item}
                  menuOpen={openAttachmentMenuId === item.id}
                  menuItems={menuItems}
                  onMenuOpenChange={(next) => setOpenAttachmentMenuId(next ? item.id : null)}
                  onOpen={() => {
                    // Open the shared ContextFileModal — same UX as a
                    // project file. The modal renders images inline and
                    // gives non-images an "Open" (OS shell via rawUrl)
                    // escape hatch.
                    setOpenAttachmentMenuId(null);
                    setOpenAttachment(item);
                  }}
                />
              );
            })}
        </div>
      )}

      {ordered.map((section) => {
        const max = showAll ? section.files.length : 4;
        const visible = section.files.slice(0, max);
        const remaining = section.files.length - visible.length;
        if (visible.length === 0) return null;
        return (
          <div key={section.scope} className="flex flex-col gap-0.5">
            <span className="font-display text-[10.5px] font-semibold uppercase tracking-widest text-ink-4 px-1 mb-1">
              {/* Display label spelled out — "Project" / "Global" on
                  their own read as project metadata, not memory. The
                  vault scope (`section.scope`) is still the canonical
                  id used to save/edit; this is purely the heading
                  shown in the rail. */}
              {section.scope === 'Project' ? 'Project memory'
                : section.scope === 'Global' ? 'Global memory'
                : section.scope}
            </span>
            {visible.map((entry) => (
              <MemoryRow
                key={entry.path || entry.category}
                entry={entry}
                onOpen={() => openMemoryEntry(entry)}
              />
            ))}
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="ml-1 mt-1 self-start text-[11px] text-ink-3 hover:text-ink underline-offset-2 hover:underline cursor-pointer bg-transparent border-0 p-0"
              >
                + {remaining} more
              </button>
            )}
          </div>
        );
      })}

      <ContextFileModal
        open={!!openEntry}
        title={labelCategory(openEntry?.category) || openEntry?.name || ''}
        subtitle={
          openEntry?.scope === 'Project' && openEntry?.projectName
            ? `Project · ${openEntry.projectName}`
            : (openEntry?.scope || '')
        }
        initialContent={openEntry?.content || ''}
        saver={async (content) => {
          if (!openEntry) return;
          await saveMemory({
            scope: openEntry.scope,
            category: openEntry.category,
            content,
            projectId: openEntry.scope === 'Project' ? openEntry.projectId : null,
          });
        }}
        remover={async () => {
          if (!openEntry) return;
          await deleteMemory({
            scope: openEntry.scope,
            category: openEntry.category,
            projectId: openEntry.scope === 'Project' ? openEntry.projectId : null,
          });
        }}
        emptyMessage="(empty memory)"
        placeholder="Memory contents — what should the agent remember?"
        dense
        onClose={() => setOpenEntry(null)}
        onChanged={() => { reloadMemory(); }}
      />
      <ContextFileModal
        open={!!openFile}
        projectName={project?.name}
        projectPath={project?.path}
        filePath={openFile?.path}
        isAntonMd={openFile?.path === ANTON_PROJECT_INSTRUCTIONS_PATH}
        onClose={() => setOpenFile(null)}
        onChanged={() => reloadFiles()}
      />
      {/* Task upload modal — same component, driven by the attachment's
          raw URL. No `projectName`/`projectPath` is passed, so the modal
          does no project-file IO: images render inline from `rawUrl`,
          non-images land in 'binary' mode with an Open action that uses
          `rawUrl` via the OS shell. `filePath` is the name only (for the
          image-extension sniff + header title), NOT a real project path.
          `remover` reuses the same attachment delete the row's menu and
          ConfirmModal use, then closes the modal. */}
      <ContextFileModal
        open={!!openAttachment}
        title={openAttachment?.name}
        filePath={openAttachment?.name}
        rawUrl={openAttachment
          ? attachmentRawUrl(project?.name, conversationId, openAttachment.id)
          : ''}
        remover={async () => {
          const target = openAttachment;
          if (!target?.id) return;
          setSessionAttachments((prev) => prev.filter((a) => a.id !== target.id));
          try {
            await deleteAttachment(target.id, {
              projectName: project?.name,
              sessionId: conversationId,
            });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[context] delete attachment failed', err);
            setTaskUploadError(err?.message || 'Could not delete attachment.');
            bumpAttachments();
          }
        }}
        onClose={() => setOpenAttachment(null)}
        onChanged={() => setOpenAttachment(null)}
      />

      {/* Hover-trash confirm — same in-app pattern as App.jsx's
          delete-task / delete-project modals (ConfirmModal with
          `destructive` style). We don't surface server failures in
          a toast yet — if the DELETE fails the reloadFiles() call
          below will leave the row visible, which is the same self-
          correcting behavior the memory rail uses on edit. */}
      <ConfirmModal
        open={!!pendingDeleteFile}
        title={`Delete "${pendingDeleteFile?.path || pendingDeleteFile?.name || 'file'}"?`}
        message="The file will be removed from the project working folder. This can't be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingDeleteFile(null)}
        onConfirm={async () => {
          const target = pendingDeleteFile;
          setPendingDeleteFile(null);
          if (!target || !project?.name) return;
          // Optimistic remove: pull the row from local state the
          // instant the user confirms so the modal closing + row
          // disappearing happen in the same frame. The DELETE +
          // refetch happens in the background; on failure we
          // reloadFiles() to restore the canonical list and surface
          // the error.
          setProjectFiles((prev) => prev.filter((f) => f.path !== target.path));
          try {
            await deleteProjectFile(project.name, target.path);
            // Quiet success — reloadFiles would also re-bring back
            // the row if the server actually kept it. We skip the
            // automatic reload here; the periodic listings on view
            // remount will re-sync. (If you want belt + suspenders,
            // uncomment reloadFiles() below.)
            // reloadFiles();
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[context] delete file failed', err);
            setUploadError(err?.message || 'Could not delete file.');
            // Restore by refetching the canonical list from server.
            reloadFiles();
          }
        }}
      />

      {/* Same pattern as the real-file delete above — optimistic
          remove, reloadDriveFiles() to self-correct on failure. This
          only revokes our own _picked_files bookkeeping; the file
          itself is untouched in Drive. */}
      <ConfirmModal
        open={!!pendingDeleteDriveFile}
        title={`Remove "${pendingDeleteDriveFile?.name || 'file'}" from project files?`}
        message="Cowork will no longer have access to this file. The file itself is not affected in Google Drive."
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingDeleteDriveFile(null)}
        onConfirm={async () => {
          const target = pendingDeleteDriveFile;
          setPendingDeleteDriveFile(null);
          if (!target || !onRemoveGoogleDriveFile) return;
          setDriveFiles((prev) => prev.filter((f) => f.id !== target.id));
          try {
            const res = await onRemoveGoogleDriveFile(target.id, target._connectionName, project?.name);
            if (!res?.ok) throw new Error(res?.reason || 'Could not remove file.');
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[context] remove drive file failed', err);
            setUploadError(err?.message || 'Could not remove file.');
            reloadDriveFiles();
          }
        }}
      />

      <ConfirmModal
        open={!!pendingDeleteAttachment}
        title={`Delete "${pendingDeleteAttachment?.name || pendingDeleteAttachment?.id || 'attachment'}"?`}
        message="The file will be removed from this task's uploads. Future turns won't see it. This can't be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingDeleteAttachment(null)}
        onConfirm={async () => {
          const target = pendingDeleteAttachment;
          setPendingDeleteAttachment(null);
          if (!target?.id) return;
          // Optimistic remove — same rationale as project-file
          // delete above. The attachments fetch isn't instant, and
          // waiting for it before clearing the row leaves the modal-
          // close → row-still-there gap that felt like "nothing
          // happened".
          setSessionAttachments((prev) => prev.filter((a) => a.id !== target.id));
          try {
            await deleteAttachment(target.id, {
              projectName: project?.name,
              sessionId: conversationId,
            });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[context] delete attachment failed', err);
            setTaskUploadError(err?.message || 'Could not delete attachment.');
            bumpAttachments();
          }
        }}
      />
    </div>
  );
}
