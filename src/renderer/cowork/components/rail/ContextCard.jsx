// Context card body — surfaces memories (Project + Global) AND
// the project's own context files (anton.md + anything the user
// dropped in via the new-project modal). Click any row to open
// the corresponding modal: memories use the existing read-only
// markdown viewer, project files use ContextFileModal which has
// view + edit modes.

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { fetchMemory, fetchProjectFiles, ANTON_PROJECT_INSTRUCTIONS_PATH } from '../../api';
import { MarkdownContent } from '../markdown/MarkdownContent';
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

function MemoryModal({ open, onClose, entry }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !entry) return null;
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      <div className="flex h-[80vh] w-[min(720px,92vw)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
        <div className="flex flex-none items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-baseline gap-3 min-w-0">
            <span className="font-display text-[13px] font-semibold uppercase tracking-wider text-ink">
              {entry.scope || 'Memory'}
            </span>
            <span className="text-[12px] text-ink-3 truncate" title={entry.relativePath}>
              {entry.relativePath || entry.name}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5" style={{ WebkitAppRegion: 'no-drag' }}>
          <MarkdownContent text={entry.content || '(empty)'} id={`mem-${entry.relativePath}`} complete />
        </div>
      </div>
    </div>
  );
}

// Row for a project context file (anton.md or any uploaded file).
// Same visual rhythm as MemoryRow but distinguishes the always-
// present anton.md with a subtle "Project instructions" label.
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

export function ContextCard({ project }) {
  const [sections, setSections] = useState([]);
  const [projectFiles, setProjectFiles] = useState([]);
  const [openEntry, setOpenEntry] = useState(null);
  // Project-file editor is a separate modal because the shape (view
  // + edit + save + delete) is different from the read-only memory
  // viewer.
  const [openFile, setOpenFile] = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMemory(project?.path)
      .then((data) => { if (!cancelled && data?.sections) setSections(data.sections); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project?.path]);

  // Project files listing (composer browse / attachments route) —
  // keyed by project filesystem path. Instructions file path for
  // read/write is ANTON_PROJECT_INSTRUCTIONS_PATH (handled separately
  // from how we list files here).
  const reloadFiles = () => {
    if (!project?.path) { setProjectFiles([]); return; }
    fetchProjectFiles(project.path)
      .then((data) => setProjectFiles(Array.isArray(data?.files) ? data.files : []))
      .catch(() => setProjectFiles([]));
  };
  useEffect(() => {
    let cancelled = false;
    if (!project?.path) { setProjectFiles([]); return undefined; }
    fetchProjectFiles(project.path)
      .then((data) => {
        if (cancelled) return;
        setProjectFiles(Array.isArray(data?.files) ? data.files : []);
      })
      .catch(() => { if (!cancelled) setProjectFiles([]); });
    return () => { cancelled = true; };
  }, [project?.path]);

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

  if (totalMemoryFiles === 0 && !hasProjectFiles) {
    return (
      <p className="text-[12.5px] text-ink-4 px-1 pt-2 pb-1">
        Anton learns as you work — memories will appear here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      {/* Project files section — anton.md (always) + uploaded docs.
          Rendered first when we have a project so the working
          instructions are the first thing the user sees. */}
      {project?.path && hasProjectFiles && (
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-[10.5px] font-semibold uppercase tracking-widest text-ink-4 px-1 mb-1">
            Project files
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

      <MemoryModal open={!!openEntry} entry={openEntry} onClose={() => setOpenEntry(null)} />
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
