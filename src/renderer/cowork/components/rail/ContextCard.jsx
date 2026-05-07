// Context card body — surfaces memories (Project + Global) AND
// files under `.context/` (anton.md + uploads). Listed via the same
// GET /projects/{name}/files as Working folder, but only `.context/`
// rows appear here; everything else lives in Working folder only.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import {
  deleteMemory,
  fetchAttachments,
  fetchMemory,
  isUnderContextDir,
  listProjectFiles,
  saveMemory,
  ANTON_PROJECT_INSTRUCTIONS_PATH,
} from '../../api';
import ContextFileModal from '../project/ContextFileModal';
import { ArtifactViewer } from '../artifact';
import { host } from '../../../platform/host';

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

function previewFirstLine(text, max = 80) {
  if (!text) return '';
  const line = String(text).replace(/^#+\s*/, '').split('\n').find((l) => l.trim()) || '';
  const trimmed = line.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + '…';
}

function MemoryRow({ entry, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={entry.content || entry.relativePath}
      className={clsx(
        'group grid items-start gap-2 rounded-md px-1 py-1 text-left',
        'cursor-pointer transition-colors hover:bg-surface-2',
        'border-0 bg-transparent w-full'
      )}
      style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
    >
      <span className="mt-0.5 text-ink-4 inline-flex flex-none">{Ico.code(13)}</span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] text-ink">
          {entry.relativePath || entry.name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-4">
          {previewFirstLine(entry.content)}
        </span>
      </span>
      {entry.modifiedAt && (
        <span className="text-[10.5px] text-ink-4 mt-0.5">{relativeAge(entry.modifiedAt)}</span>
      )}
    </button>
  );
}

// Row for a project context file (anton.md or any uploaded file).
// Same visual rhythm as MemoryRow but distinguishes the always-
// present anton.md with a subtle "Project instructions" label.
function attachmentKindIcon(kind) {
  if (kind === 'url') return Ico.globe(13);
  if (kind === 'snippet') return Ico.code(13);
  if (kind === 'connector') return Ico.link(13);
  return Ico.doc(13);
}

/** Shape expected by `ArtifactViewer` / working-folder open — matches WorkingFolderLive.fileEntryToRow. */
function attachmentToPreviewArtifact(item) {
  const path = item.path && String(item.path);
  if (!path) return null;
  const base = path.split(/[/\\]/).pop() || '';
  const lower = base.toLowerCase();
  const ext = lower.includes('.') ? `.${lower.split('.').pop()}` : '';
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const title = stem
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    path,
    title: title || base || item.name || 'Attachment',
    ext,
    updated: 0,
    size: Number.isFinite(item.size) ? item.size : 0,
    publishedUrl: '',
  };
}

function sessionAttachmentIsOpenable(item) {
  const path = item.path && String(item.path).trim();
  if (item.kind === 'file' && path) return true;
  const text = (item.text && String(item.text).trim()) || (item.textPreview && String(item.textPreview).trim());
  return !!text;
}

function SessionAttachmentRow({ item, onOpen, openable }) {
  const label = item.name || item.id || 'Attachment';
  const sub = item.textPreview
    || (item.mime ? String(item.mime).split('/').pop() : '')
    || (item.size ? `${Math.ceil(item.size / 1024)} KB` : '');
  const when = item.updatedAt || item.createdAt;
  const title = item.note || item.textPreview || label;
  const rowClass = clsx(
    'group grid items-start gap-2 rounded-md px-1 py-1 text-left w-full border-0 bg-transparent',
    openable && 'cursor-pointer transition-colors hover:bg-surface-2',
    !openable && 'cursor-default',
  );
  const grid = { gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' };
  const inner = (
    <>
      <span className="mt-0.5 text-ink-4 inline-flex flex-none">{attachmentKindIcon(item.kind)}</span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] text-ink">{label}</span>
        {sub ? (
          <span className="mt-0.5 block truncate text-[11px] text-ink-4">{sub}</span>
        ) : null}
      </span>
      {when ? (
        <span className="text-[10.5px] text-ink-4 mt-0.5">{relativeAge(when)}</span>
      ) : null}
    </>
  );
  if (openable) {
    return (
      <button type="button" className={rowClass} style={grid} title={title} onClick={onOpen}>
        {inner}
      </button>
    );
  }
  return (
    <div className={rowClass} style={grid} title={title}>
      {inner}
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
          {isAnton ? 'anton.md' : file.path}
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
  const [previewUploadArtifact, setPreviewUploadArtifact] = useState(null);
  const [readOnlySnippet, setReadOnlySnippet] = useState(null);

  const handleOpenSessionAttachment = useCallback((item) => {
    const path = item.path && String(item.path).trim();
    if (item.kind === 'file' && path) {
      const art = attachmentToPreviewArtifact(item);
      if (!art) return;
      const lower = path.toLowerCase();
      const isHtml = (art.ext || '').toLowerCase() === '.html' || lower.endsWith('.htm');
      if (isHtml) setPreviewUploadArtifact(art);
      else void host.openPath(path);
      return;
    }
    const text = (item.text && String(item.text)) || (item.textPreview && String(item.textPreview)) || '';
    if (text.trim()) {
      setReadOnlySnippet({ title: item.name || item.id || 'Attachment', text });
    }
  }, []);

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
        setProjectFiles(raw.filter((f) => isUnderContextDir(f.path)));
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

  const sessionRelevant = conversationId && !String(conversationId).startsWith('tmp-');

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
    fetchAttachments(conversationId)
      .then((data) => {
        if (cancelled) return;
        const raw = Array.isArray(data?.attachments) ? data.attachments : [];
        const sorted = [...raw].sort((a, b) => {
          const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
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
  }, [sessionRelevant, conversationId, refreshKey]);

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
      {/* `.context/` only — Working folder lists the rest of the project tree. */}
      {project?.name && hasProjectFiles && (
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-[10.5px] font-semibold uppercase tracking-widest text-ink-4 px-1 mb-1">
            Context files
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
            <p className="text-[12px] text-ink-4 px-1 pb-0.5">
              No files attached to this task yet.
            </p>
          )}
          {!attachmentsLoading
            && sessionAttachments.map((item) => (
              <SessionAttachmentRow
                key={item.id}
                item={item}
                openable={sessionAttachmentIsOpenable(item)}
                onOpen={() => handleOpenSessionAttachment(item)}
              />
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
              {section.scope}
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

      <ArtifactViewer
        open={!!previewUploadArtifact}
        artifact={previewUploadArtifact}
        onClose={() => setPreviewUploadArtifact(null)}
        onChange={(updated) => setPreviewUploadArtifact(updated)}
      />

      <ContextFileModal
        open={!!readOnlySnippet}
        title={readOnlySnippet?.title}
        subtitle="Upload"
        initialContent={readOnlySnippet?.text ?? ''}
        readOnly
        dense
        emptyMessage="(empty)"
        onClose={() => setReadOnlySnippet(null)}
      />
    </div>
  );
}
