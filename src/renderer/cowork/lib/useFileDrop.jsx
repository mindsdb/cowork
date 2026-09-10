/* useFileDrop — drag OS files onto a zone and get back real File objects.
   Mirrors the dashed-accent drag affordance used by NewProjectModal, but
   factored so ChatView (conversation attachments) and ProjectDetail
   (project files) can both wrap their main container with a dropzone.

   Usage:
     const { isDragging, dropHandlers } = useFileDrop({ onFiles, disabled });
     <div style={{ position: 'relative' }} {...dropHandlers}>
       …content…
       <FileDropOverlay active={isDragging} label="Drop to add" />
     </div>

   Notes:
   - A drag-counter ref (not a bare boolean) keeps `isDragging` stable while
     the cursor moves between child elements — dragenter/dragleave fire per
     element, so a naive boolean flickers. Counter>0 ⇒ dragging.
   - Only reacts when the drag actually carries files (`types` includes
     'Files'); ignores text/element drags.
   - Skips directories (webkitGetAsEntry().isDirectory) and dedupes by name
     within a single drop. */

import { memo, useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';

function dragHasFiles(e) {
  const types = e?.dataTransfer?.types;
  if (!types) return false;
  // `types` is a DOMStringList in some browsers — Array.from normalises.
  return Array.from(types).includes('Files');
}

// Pull real File objects out of a drop event, skipping directories and
// de-duplicating by name within this drop.
function extractFiles(e) {
  const dt = e.dataTransfer;
  if (!dt) return [];
  const out = [];
  const seen = new Set();
  const items = dt.items;
  if (items && items.length) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || item.kind !== 'file') continue;
      // Directories drop in as a file item too — filter them when the
      // entry API is available (Chromium/Electron always has it).
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry && entry.isDirectory) continue;
      const file = item.getAsFile();
      if (!file) continue;
      if (seen.has(file.name)) continue;
      seen.add(file.name);
      out.push(file);
    }
    return out;
  }
  // Fallback: no items API — take dataTransfer.files as-is.
  const files = dt.files ? Array.from(dt.files) : [];
  for (const file of files) {
    if (seen.has(file.name)) continue;
    seen.add(file.name);
    out.push(file);
  }
  return out;
}

// Pull real File objects out of a paste event's clipboard. Sibling of
// extractFiles (drops): reads ClipboardData rather than DataTransfer and
// drops the directory check — the clipboard never carries entries. Lets
// the composer treat a pasted image/gif the same as a drag-drop or a
// file-picker pick. Dedupe by name+size because pasted screenshots all
// share a generic name ("image.png"), so a name-only key would collapse
// two distinct images while still needing to fold an item that surfaces
// via both items[] and files[].
export function extractClipboardFiles(clipboardData) {
  if (!clipboardData) return [];
  const out = [];
  const seen = new Set();
  const push = (file) => {
    if (!file) return;
    const key = `${file.name}\t${file.size}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  const items = clipboardData.items;
  if (items && items.length) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || item.kind !== 'file') continue;
      push(item.getAsFile());
    }
    return out;
  }
  const files = clipboardData.files ? Array.from(clipboardData.files) : [];
  for (const file of files) push(file);
  return out;
}

export function useFileDrop({ onFiles, disabled = false } = {}) {
  const [isDragging, setIsDragging] = useState(false);
  // Counter, not boolean: dragenter/dragleave fire for every child the
  // cursor crosses; balancing them avoids flicker.
  const counter = useRef(0);

  const reset = useCallback(() => {
    counter.current = 0;
    setIsDragging(false);
  }, []);

  const onDragEnter = useCallback((e) => {
    if (disabled || !dragHasFiles(e)) return;
    e.preventDefault();
    counter.current += 1;
    if (counter.current > 0) setIsDragging(true);
  }, [disabled]);

  const onDragOver = useCallback((e) => {
    if (disabled || !dragHasFiles(e)) return;
    // Required so the element is recognised as a drop target and the
    // browser doesn't perform its default (navigate to file) on drop.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, [disabled]);

  const onDragLeave = useCallback((e) => {
    if (disabled || !dragHasFiles(e)) return;
    e.preventDefault();
    counter.current = Math.max(0, counter.current - 1);
    if (counter.current === 0) setIsDragging(false);
  }, [disabled]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    reset();
    if (disabled) return;
    const files = extractFiles(e);
    if (!files.length) return;
    onFiles?.(files);
  }, [disabled, onFiles, reset]);

  return {
    isDragging,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}

/* Animated overlay shown while a file drag is over the zone. Absolutely
   positioned to cover the (position:relative) zone root. Fade + slight
   scale-in via CSS transition; theme-aware via the same CSS vars the rest
   of the app uses. `label` is the call-to-action; pass `busy` to swap in an
   "Uploading…" state, and `error` for a transient failure message.
   memo: hosts render this inside frequently-updating JSX (Composer re-renders
   per keystroke), and all props are primitives — skip when nothing changed. */
export const FileDropOverlay = memo(function FileDropOverlay({ active, label, busy = false, error = '' }) {
  const visible = active || busy || !!error;
  const text = error || (busy ? 'Uploading…' : label);
  return (
    <div
      aria-hidden={!visible}
      className="absolute inset-0 z-[120] flex items-center justify-center pointer-events-none rounded-card [backdrop-filter:blur(1.5px)] [-webkit-backdrop-filter:blur(1.5px)] [transition:opacity_140ms_ease,transform_160ms_cubic-bezier(.2,.7,.3,1)]"
      style={{
        // Dynamic: dashed border colour + fill switch on the error state; the
        // whole overlay fades + scales on `visible`.
        border: `2px dashed ${error ? '#C2453B' : 'var(--accent)'}`,
        background: error
          ? 'color-mix(in srgb, #C2453B 8%, var(--bg))'
          : 'color-mix(in srgb, var(--accent) 7%, var(--bg))',
        opacity: visible ? 1 : 0,
        transform: visible ? 'scale(1)' : 'scale(0.985)',
      }}
    >
      <div
        className="inline-flex items-center gap-[10px] py-3 px-[18px] rounded-[10px] bg-surface border border-solid border-line shadow-[0_8px_28px_rgba(0,0,0,0.18)] font-[family-name:var(--font-body)] text-base font-semibold [transition:transform_160ms_cubic-bezier(.2,.7,.3,1)]"
        style={{
          color: error ? '#C2453B' : 'var(--ink)',
          transform: visible ? 'translateY(0)' : 'translateY(6px)',
        }}
      >
        {/* upload-into-tray glyph (inherits currentColor) */}
        <Upload size={18} strokeWidth={1.5} aria-hidden="true" className="flex-none" />
        <span>{text}</span>
      </div>
    </div>
  );
});
