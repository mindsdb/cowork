// Context card body — surfaces memories (Project + Global) AND
// project instructions (`.anton/anton.md`) plus any legacy `.context/`
// files. Listed via GET /projects/{name}/files; Working folder hides
// `.anton/` and `.context/` trees except this rail shows instructions
// (and legacy context paths).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import {
  deleteMemory,
  fetchAttachments,
  fetchMemory,
  isProjectInstructionsPath,
  isUnderContextDir,
  listProjectFiles,
  saveMemory,
  ANTON_PROJECT_INSTRUCTIONS_PATH,
} from '../../api';
import ContextFileModal from '../project/ContextFileModal';

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

function SessionAttachmentRow({ item }) {
  const label = item.name || item.id || 'Attachment';
  const sub = item.textPreview
    || (item.mime ? String(item.mime).split('/').pop() : '')
    || (item.size ? `${Math.ceil(item.size / 1024)} KB` : '');
  const when = item.updated_at || item.created_at || item.updatedAt || item.createdAt;
  return (
    <div
      className={clsx(
        'group grid items-start gap-2 rounded-md px-1 py-1 text-left',
        'border-0 bg-transparent w-full'
      )}
      style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
      title={item.note || item.textPreview || label}
    >
      <span className="mt-0.5 text-ink-4 inline-flex flex-none">{attachmentSourceIcon(item)}</span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] text-ink">{label}</span>
        {sub ? (
          <span className="mt-0.5 block truncate text-[11px] text-ink-4">{sub}</span>
        ) : null}
      </span>
      {when ? (
        <span className="text-[10.5px] text-ink-4 mt-0.5">{relativeAge(when)}</span>
      ) : null}
    </div>
  );
}

function ContextFileRow({ file, onOpen }) {
  const isAnton = file.path === ANTON_PROJECT_INSTRUCTIONS_PATH;
  const isEmpty = !file.size || file.synthetic === true;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={file.path}
      className={clsx(
        'group grid items-start gap-2 rounded-md px-1 py-1 text-left',
        'cursor-pointer transition-colors hover:bg-surface-2',
        'border-0 bg-transparent w-full'
      )}
      style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
    >
      <span className="mt-0.5 text-ink-4 inline-flex flex-none">{Ico.doc(13)}</span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] text-ink">
          {/* Display name for the canonical instructions file. The
              raw filename (`anton.md`) is jargon — most users don't
              know what it does. "Instructions" reads as a noun and
              matches the project-level mental model. The on-disk
              path is unchanged; the modal still writes to anton.md. */}
          {isAnton ? 'Instructions' : file.path}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-4">
          {isAnton
            ? (isEmpty ? 'Empty — click to add instructions' : 'Project instructions')
            : (isEmpty ? 'Empty file' : `${Math.ceil((file.size || 0) / 1024)} KB`)}
        </span>
      </span>
    </button>
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

  useEffect(() => {
    let cancelled = false;
    fetchMemory(project?.path)
      .then((data) => { if (!cancelled && data?.sections) setSections(data.sections); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project?.path]);

  // Ticket pattern: every listProjectFiles call (mount + reload-on-
  // edit) bumps `loadVersion`. The async response only applies its
  // result if its ticket is still the latest. Without this, saving a
  // context edit and immediately switching projects could let the
  // late response paint into the new project — the same shape of
  // bug WorkingFolderLive had.
  const loadVersion = useRef(0);

  const reloadFiles = useCallback(() => {
    if (!project?.name) { setProjectFiles([]); return; }
    const ticket = ++loadVersion.current;
    listProjectFiles(project.name)
      .then((data) => {
        if (ticket !== loadVersion.current) return;
        const raw = Array.isArray(data?.files) ? data.files : [];
        setProjectFiles(raw.filter((f) => isProjectInstructionsPath(f.path) || isUnderContextDir(f.path)));
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
  }, [sessionRelevant, conversationId, refreshKey, project?.name]);

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

  const blockGlobalEmpty = totalMemoryFiles === 0 && !hasProjectFiles && !sessionRelevant;

  if (blockGlobalEmpty) {
    return (
      <p className="text-[12.5px] text-ink-4 px-1 pt-2 pb-1">
        Anton learns as you work — memories will appear here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      {/* Instructions (`.anton/anton.md`) + legacy `.context/` only. */}
      {project?.name && hasProjectFiles && (
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-[10.5px] font-semibold uppercase tracking-widest text-ink-4 px-1 mb-1">
            Files
          </span>
          {projectFiles.map((f) => (
            <ContextFileRow
              key={f.path}
              file={f}
              onOpen={() => setOpenFile(f)}
            />
          ))}
        </div>
      )}

      {sessionRelevant && (
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-[10.5px] font-semibold uppercase tracking-widest text-ink-4 px-1 mb-1">
            Uploads
          </span>
          {attachmentsLoading && (
            <p className="text-[12px] text-ink-4 px-1 pb-0.5">Loading attachments…</p>
          )}
          {attachmentsError && (
            <p className="text-[12px] px-1 pb-0.5" style={{ color: 'var(--danger-600, #b3261e)' }}>
              {attachmentsError}
            </p>
          )}
          {!attachmentsLoading && !attachmentsError && sessionAttachments.length === 0 && (
            <div className="flex items-center gap-2 px-1 pb-0.5 text-[12px] text-ink-4">
              {/* Empty-state glyph mirrors the row icon style above
                  (paperclip ~ "attachment") so the row reads as a
                  placeholder for what would otherwise live there. */}
              <span className="text-ink-4 inline-flex flex-none">{Ico.attach(13)}</span>
              <span>No files attached yet.</span>
            </div>
          )}
          {!attachmentsLoading
            && sessionAttachments.map((item) => (
              <SessionAttachmentRow key={item.id} item={item} />
            ))}
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
        placeholder="Memory contents — what should Anton remember?"
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
        filePath={openFile?.path}
        isAntonMd={openFile?.path === ANTON_PROJECT_INSTRUCTIONS_PATH}
        onClose={() => setOpenFile(null)}
        onChanged={() => reloadFiles()}
      />
    </div>
  );
}
