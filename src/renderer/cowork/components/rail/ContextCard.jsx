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
  listProjectFiles,
  moveAttachmentToProject,
  saveMemory,
  uploadAttachments,
  uploadProjectFiles,
  ANTON_PROJECT_INSTRUCTIONS_PATH,
} from '../../api';
import ContextFileModal from '../project/ContextFileModal';
import { ConfirmModal } from '../ConfirmModal';
import * as host from '../../../platform/host';

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
      title={entry.content || entry.relativePath}
      className={clsx(
        'group grid items-center gap-2 rounded-md px-1 py-1 text-left',
        'cursor-pointer transition-colors hover:bg-surface-2',
        'border-0 bg-transparent w-full'
      )}
      style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
    >
      <span className="text-ink-4 inline-flex flex-none">{Ico.code(13)}</span>
      <span className="block truncate text-[12.5px] text-ink min-w-0">
        {entry.relativePath || entry.name}
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
  item, menuOpen, onMenuToggle, onOpen, onMove, onDelete, menuRef,
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
        'group relative grid items-center gap-2 rounded-md px-1 py-1 text-left',
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
            (onMenuToggle) && 'group-hover:opacity-0',
            menuOpen && 'opacity-0',
          )}>
            {relativeAge(when)}
          </span>
        ) : null}
        {onMenuToggle && (
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="More actions"
            onClick={(e) => {
              // Don't let the kebab click open the file — the menu
              // takes over here.
              e.stopPropagation();
              onMenuToggle();
            }}
            className={clsx(
              'absolute inset-0 inline-flex items-center justify-center',
              menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              'transition-opacity rounded',
              'text-ink-4 hover:text-ink',
              'bg-transparent border-0 cursor-pointer p-0',
            )}
          >
            {Ico.moreVert(13)}
          </button>
        )}
      </span>

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="menu absolute z-50"
          style={{
            // Anchor the menu under the kebab (trailing-right slot)
            // so it doesn't cover the row's filename. minWidth is
            // sized for the longest label ("Move to project files").
            right: 4, top: 'calc(100% + 2px)',
            minWidth: 180,
          }}
        >
          {canOpen && (
            <button
              type="button"
              className="menu-item"
              onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
            >
              <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>{Ico.upload(13)}</span>
              <span>Open</span>
            </button>
          )}
          {onMove && (
            <button
              type="button"
              className="menu-item"
              onClick={(e) => { e.stopPropagation(); onMove(); }}
            >
              <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>{Ico.folder(13)}</span>
              <span>Move to project files</span>
            </button>
          )}
          {onDelete && (
            <>
              {(canOpen || onMove) && (
                <div style={{ height: 1, background: 'var(--border-0)', margin: '4px 0' }} />
              )}
              <button
                type="button"
                className="menu-item"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                style={{ color: 'var(--danger)' }}
              >
                <span style={{ display: 'inline-flex', color: 'var(--danger)' }}>{Ico.trash(13)}</span>
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      )}
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
        'group grid items-center gap-2 rounded-md px-1 py-1 text-left',
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
              'absolute inset-0 inline-flex items-center justify-center',
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

export function ContextCard({ project, conversationId, refreshKey = 0 }) {
  const [sections, setSections] = useState([]);
  const [projectFiles, setProjectFiles] = useState([]);
  const [sessionAttachments, setSessionAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState(null);
  // `openEntry` is a memory file; `openFile` is a project context
  // file. Both feed into `ContextFileModal` (one component, two
  // wirings) so the UX feels identical regardless of which surface
  // the row was opened from.
  const [openEntry, setOpenEntry] = useState(null);
  const [openFile, setOpenFile] = useState(null);
  const [showAll, setShowAll] = useState(false);
  // Row-level delete + header-level upload state.
  // `pendingDeleteFile` drives the ConfirmModal — set when the user
  // clicks the trash icon on a row, cleared on close/confirm. We
  // follow the established ConfirmModal pattern (lifted state +
  // payload) but keep it local to ContextCard rather than prop-
  // drilling up to App.jsx — the delete is internal to the rail
  // and doesn't need to participate in app-level routing.
  const [pendingDeleteFile, setPendingDeleteFile] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);
  // Mirror state for the Task Uploads section — separate from project
  // files because upload/delete hit different endpoints and a busy
  // state in one shouldn't grey out the other.
  const [taskUploadBusy, setTaskUploadBusy] = useState(false);
  const [taskUploadError, setTaskUploadError] = useState('');
  const taskUploadInputRef = useRef(null);
  // Which attachment's kebab menu is currently open. Single-open
  // policy — clicking one closes any other. `attachmentMenuRef` is
  // attached to the open menu's outer div so the document
  // outside-click listener can ignore clicks inside it (without it,
  // mousedown would null `openAttachmentMenuId` before the menu
  // item's own click handler ran, so Move/Delete never fired).
  const [openAttachmentMenuId, setOpenAttachmentMenuId] = useState(null);
  const [pendingDeleteAttachment, setPendingDeleteAttachment] = useState(null);
  const attachmentMenuRef = useRef(null);
  // Bump to re-run the attachments effect after a mutation (upload /
  // delete / move) without needing to wire `onChanged` up to App.jsx.
  const [attachmentsTick, setAttachmentsTick] = useState(0);
  const bumpAttachments = useCallback(() => setAttachmentsTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetchMemory(project?.path)
      .then((data) => { if (!cancelled && data?.sections) setSections(data.sections); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project?.path]);

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

  // Click anywhere outside an open attachment kebab menu closes it.
  // Three subtleties:
  //   1. Listen for `click`, not `mousedown` — `mousedown` fires
  //      BEFORE the menu item's own click handler, and would null
  //      `openAttachmentMenuId` before the menu item's onClick ever
  //      ran (so Move-to-project / Delete never fired).
  //   2. Attach on the next tick so the click that OPENED the menu
  //      doesn't immediately propagate up and close it.
  //   3. Check the ref so clicks INSIDE the menu (which stopPropagate
  //      on React's synthetic event but still bubble at the native
  //      document level) don't fall through to "close".
  useEffect(() => {
    if (openAttachmentMenuId == null) return undefined;
    const onClick = (e) => {
      if (attachmentMenuRef.current && attachmentMenuRef.current.contains(e.target)) return;
      setOpenAttachmentMenuId(null);
    };
    const id = setTimeout(() => document.addEventListener('click', onClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', onClick);
    };
  }, [openAttachmentMenuId]);

  // Order: Project section first, Global second.
  const ordered = useMemo(() => {
    const sorted = [...sections].sort((a, b) => {
      if (a.scope === 'Project' && b.scope !== 'Project') return -1;
      if (b.scope === 'Project' && a.scope !== 'Project') return 1;
      return 0;
    });
    return sorted.map((s) => ({
      ...s,
      files: (s.files || []).map((f) => ({
        ...f,
        scope: s.scope,
      })),
    }));
  }, [sections]);

  const totalMemoryFiles = useMemo(() => ordered.reduce((n, s) => n + s.files.length, 0), [ordered]);
  const hasProjectFiles = projectFiles.length > 0;

  // Suppress the whole card only when there's truly nothing to act
  // on AND no project to upload into. Inside a project we always
  // render the Files section so the new "+ Add file" / empty-state
  // upload affordance is reachable on a fresh project too.
  const blockGlobalEmpty = !project?.name
    && totalMemoryFiles === 0
    && !hasProjectFiles
    && !sessionRelevant;

  if (blockGlobalEmpty) {
    return (
      <p className="text-[12.5px] text-ink-4 px-1 pt-2 pb-1">
        The agent learns as you work — memories will appear here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
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
              Project files{projectFiles.length > 1 ? ` · ${projectFiles.length}` : ''}
            </span>
            <button
              type="button"
              aria-label="Add files to this project"
              title={uploadBusy ? 'Uploading…' : 'Add files to this project'}
              disabled={uploadBusy}
              onClick={() => fileInputRef.current?.click()}
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
          {!hasProjectFiles && !uploadBusy && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={clsx(
                'flex items-center gap-2 px-1 py-1 rounded-md',
                'text-[12px] text-ink-4 hover:text-ink hover:bg-surface-2',
                'cursor-pointer bg-transparent border-0 text-left',
              )}
            >
              <span className="text-ink-4 inline-flex flex-none">{Ico.upload(13)}</span>
              <span>Add files to give the agent context.</span>
            </button>
          )}
          {hasProjectFiles && (
            <div
              className={clsx(
                'flex flex-col gap-0.5',
                projectFiles.length > 10 && 'overflow-y-auto pr-1 scroll-clean',
              )}
              style={projectFiles.length > 10 ? { maxHeight: 220 } : undefined}
            >
              {projectFiles.map((f) => (
                <ContextFileRow
                  key={f.path}
                  file={f}
                  onOpen={() => setOpenFile(f)}
                  onRequestDelete={(file) => setPendingDeleteFile(file)}
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
                'flex items-center gap-2 px-1 py-1 rounded-md',
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
              return (
                <SessionAttachmentRow
                  key={item.id}
                  item={item}
                  menuOpen={openAttachmentMenuId === item.id}
                  menuRef={openAttachmentMenuId === item.id ? attachmentMenuRef : null}
                  onMenuToggle={() => setOpenAttachmentMenuId(
                    openAttachmentMenuId === item.id ? null : item.id,
                  )}
                  onOpen={rawUrl
                    ? () => {
                        // Browser shell + Electron shell both supported
                        // through host.openExternal — Electron forwards
                        // to shell.openExternal (OS default app); web
                        // does window.open in a new tab where the
                        // server's `inline` Content-Disposition lets
                        // the browser render images/PDFs natively.
                        setOpenAttachmentMenuId(null);
                        host.openExternal(rawUrl);
                      }
                    : null}
                  onMove={() => {
                    setOpenAttachmentMenuId(null);
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
                  }}
                  onDelete={() => {
                    setOpenAttachmentMenuId(null);
                    setPendingDeleteAttachment(item);
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
                key={entry.relativePath || entry.name}
                entry={entry}
                onOpen={() => setOpenEntry(entry)}
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
        title={openEntry?.relativePath || openEntry?.name || ''}
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
            relativePath: openEntry.relativePath,
            content,
            projectPath: openEntry.scope === 'Project' ? openEntry.projectPath : null,
          });
        }}
        remover={async () => {
          if (!openEntry) return;
          await deleteMemory({
            scope: openEntry.scope,
            relativePath: openEntry.relativePath,
            projectPath: openEntry.scope === 'Project' ? openEntry.projectPath : null,
          });
        }}
        emptyMessage="(empty memory file)"
        placeholder="Memory contents — what should the agent remember?"
        dense
        onClose={() => setOpenEntry(null)}
        onChanged={() => {
          // Refresh the rail's memory listing so adds/edits/deletes
          // surface immediately. Same project_path the rail uses on
          // initial load — keeps the displayed sections coherent.
          fetchMemory(project?.path)
            .then((data) => { if (data?.sections) setSections(data.sections); })
            .catch(() => {});
        }}
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
