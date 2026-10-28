// ContextFileModal — view + edit for any markdown file the user
// can open from the rail or the Memory page. Originally this only
// drove project instructions (`anton.md` under `.anton/`) + legacy
// `.context/` files; it has since been generalised so memory entries
// (rules, lessons, identity notes) can ride the same modal — the
// design language, keyboard handling, and edit↔view rhythm should
// feel identical regardless of where the file lives.
//
// Two ways to wire it up:
//
//   1. Project file mode (legacy): pass `projectName` + `filePath`,
//      the modal handles read/write/delete via the project files
//      API. `isAntonMd` (or the path matching
//      ANTON_PROJECT_INSTRUCTIONS_PATH) flips on the special anton.md
//      affordances (label and empty-state placeholder).
//
//   2. Generic mode: pass `title` + `loader` (or `initialContent`)
//      + `saver` + optional `remover`. Used by the memory rail to
//      view + edit a memory file without dragging the project-file
//      API into a place that doesn't need it.
//
// Mode rules:
//   • If the file exists with content → opens in VIEW mode. User
//     clicks "Edit" to switch to a textarea.
//   • If the file is `anton.md` AND empty / missing → opens directly
//     in EDIT mode. There's nothing to read; the modal IS the
//     authoring surface. (`startInEditMode` overrides this.)
//   • Save commits and switches back to view mode.

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { Alert, Button, Tooltip } from '../ui';
import { Modal } from '../ui/Modal';
import { ConfirmModal } from '../ConfirmModal';
import {
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
  mountProjectFilePreview,
  projectFileDownloadUrl,
  ANTON_PROJECT_INSTRUCTIONS_PATH,
} from '../../api';
import { MarkdownContent } from '../markdown/MarkdownContent';
import SharedResourceAttribution from '../SharedResourceAttribution';
import { host } from '../../../platform/host';
import {
  downloadAuthenticatedResource,
  fetchAuthenticatedBlob,
  fetchAuthenticatedResponse,
} from '../../lib/authenticatedResource';
import { downloadFilename } from '../../lib/browserDownload';
import { inlineHtmlFromApi } from '../../lib/inlineHtmlAssets';
import { limitArtifactFrames } from '../artifact/artifactPreviewUtils';
import { NO_PREVIEW_DOWNLOADED_NOTE } from '../../lib/artifactActions';
import { DOWNLOAD_FAILED_NOTE, DocumentPreview, PREVIEW_FAILED_DOWNLOADED_NOTE } from '../../preview/DocumentPreview';
import { documentPreviewType } from '../../preview/kinds';

/* Where the file's bytes are read from: an attachment's raw URL, else the
   project file's download URL. */
function fileUrl({ projectName, filePath, rawUrl }) {
  return rawUrl || (projectName && filePath ? projectFileDownloadUrl(projectName, filePath) : '');
}

// Join a project root + relative path into a forward-slash absolute
// path so `host.openPath(...)` resolves correctly even
// when the relative side carries embedded slashes.
function joinAbs(root, rel) {
  if (!root || !rel) return '';
  const r = String(root).replace(/\/+$/, '');
  const p = String(rel).replace(/^\/+/, '');
  return `${r}/${p}`;
}

/* Whether the file saves rather than opens: always on web, and on desktop
   for an attachment. An attachment has no local path, and the OS browser
   that Open would hand its raw URL to carries no server token, so it gets a
   401. The renderer's own fetch carries the token on desktop too. */
function savesFile({ projectName, filePath, rawUrl }) {
  return host.isWeb || (!!rawUrl && !(projectName && filePath));
}

// Open the local project file in its default app. An attachment never
// comes here: it saves instead (savesFile).
function openInDefaultApp({ projectPath, filePath }) {
  const abs = joinAbs(projectPath, filePath);
  if (abs) host.openPath(abs);
}


/* The project files API reads text inline up to 2 MiB; an attachment read
   through its raw URL keeps the same cap. */
const INLINE_TEXT_MAX_BYTES = 2 * 1024 * 1024;

// The HTML preview renders in an iframe, not the text view, so it reads more.
const HTML_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

/* Why a file shows in the binary panel rather than as text: it is past the
   inline cap, or its bytes are not UTF-8 text. */
const TOO_LARGE = 'too-large';
const NOT_TEXT = 'not-text';

/** @typedef {{ text: string } | { refused: typeof TOO_LARGE | typeof NOT_TEXT }} InlineTextRead */

/* The file at `url` as `{ text }`, or `{ refused }` with TOO_LARGE or
   NOT_TEXT. A Content-Length past the cap refuses the file before its body
   downloads; without one, the size is checked once it has.
   @returns {Promise<InlineTextRead>} */
async function readInlineText(url, maxBytes = INLINE_TEXT_MAX_BYTES) {
  const response = await fetchAuthenticatedResponse(url);
  if (Number(response.headers.get('Content-Length')) > maxBytes) {
    response.body?.cancel().catch(() => {});
    return { refused: TOO_LARGE };
  }
  const blob = await response.blob();
  if (blob.size > maxBytes) return { refused: TOO_LARGE };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer()) };
  } catch {
    return { refused: NOT_TEXT };
  }
}

/* Whether FileAccessButton has anything to offer: Download where the file
   saves (savesFile), Reveal or Open on desktop. */
function hasFileAccess({ projectName, filePath, rawUrl, showOpenAction }) {
  const hasProjectFile = !!(projectName && filePath);
  return savesFile({ projectName, filePath, rawUrl })
    ? hasProjectFile || !!rawUrl
    : hasProjectFile || showOpenAction;
}

// Header chip that handles "reveal in Finder" / "open in default app"
// on desktop and falls back to a download link where the file saves:
// on the web, and for an attachment on desktop (savesFile). Used by
// both the HTML and binary branches — they live in the modal header
// so the user always has an escape hatch regardless of what's
// rendered inline.
function FileAccessButton({ projectPath, projectName, filePath, rawUrl, showOpenAction = true }) {
  const abs = joinAbs(projectPath, filePath);
  const dlUrl = projectName && filePath ? projectFileDownloadUrl(projectName, filePath) : '';
  // Attachments have a `rawUrl` but no project filePath — Reveal-in-
  // Finder has nothing to point at (the file isn't on a local project
  // path), so an attachment saves through its raw URL instead.
  const hasProjectFile = !!(projectName && filePath);

  if (savesFile({ projectName, filePath, rawUrl })) {
    const saveUrl = dlUrl || rawUrl;
    if (!saveUrl) return null;
    return (
      <button
        type="button"
        onClick={() => {
          downloadAuthenticatedResource(saveUrl, downloadFilename(filePath)).catch(() => {});
        }}
        className="no-underline cursor-pointer bg-transparent border border-solid border-line text-ink-2 py-[6px] px-3 rounded-[6px] font-[family-name:var(--font-body)] text-sm font-medium inline-flex items-center gap-[6px]"
      >{Ico.downloadCloud ? Ico.downloadCloud(14) : '↓'} Download</button>
    );
  }

  return (
    <div className="inline-flex gap-1">
      {hasProjectFile && (
        <Tooltip content="Reveal in Finder">
          <Button
            onClick={() => abs && host.showItemInFolder(abs)}
          >{Ico.folder ? Ico.folder(14) : '📁'} Reveal</Button>
        </Tooltip>
      )}
      {showOpenAction && (
        <Tooltip content="Open in default app">
          <Button
            onClick={() => openInDefaultApp({ projectPath, filePath })}
          >{Ico.externalLink ? Ico.externalLink(14) : '↗'} Open</Button>
        </Tooltip>
      )}
    </div>
  );
}


// Empty-state panel for binary / oversized / non-UTF-8 files.
// Renders a centered icon + the filename + one-line explanation
// + the same reveal/download affordances as the header chip, so the
// modal stays useful even when nothing can be displayed inline.
//
// `downloadOnOpen` (web, a file this viewer has no preview for) saves the
// file once when the panel mounts, as a click on an artifact with no preview
// does, and says `downloadedNote` only after the download succeeded. Any
// later download is the user's click on Download.
function BinaryFilePanel({
  fileName, detail, projectPath, projectName, filePath, rawUrl, showOpenAction,
  downloadOnOpen = false, downloadedNote = NO_PREVIEW_DOWNLOADED_NOTE,
}) {
  const offersActions = hasFileAccess({ projectName, filePath, rawUrl, showOpenAction });
  const [downloaded, setDownloaded] = useState(null);
  const started = useRef(false);
  useEffect(() => {
    if (!downloadOnOpen || started.current) return;
    started.current = true;
    downloadAuthenticatedResource(fileUrl({ projectName, filePath, rawUrl }), downloadFilename(filePath))
      .then(setDownloaded, () => setDownloaded(false));
  }, [downloadOnOpen, projectName, filePath, rawUrl]);
  let message = (
    <>
      This file can't be displayed inline (binary, too large, or not text).
      {offersActions && ' Use the actions below to view it.'}
    </>
  );
  if (downloadOnOpen) {
    if (downloaded === null) message = 'Downloading…';
    else message = downloaded ? downloadedNote : DOWNLOAD_FAILED_NOTE;
  }
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-[14px] text-center py-8 px-5 rounded-card-row bg-surface-2 border border-solid border-transparent">
      <div className="inline-grid place-items-center w-[56px] h-[56px] rounded-card bg-[color-mix(in_srgb,var(--ink-4)_14%,transparent)] text-ink-3">{Ico.doc ? Ico.doc(32) : '📄'}</div>
      <div className="flex flex-col gap-1">
        <span className="font-[family-name:var(--font-display)] text-[14.5px] font-semibold text-ink">{fileName}</span>
        <span className="font-[family-name:var(--font-body)] text-sm text-ink-3 max-w-[380px] leading-[1.5]" role="status">
          {message}
        </span>
      </div>
      <FileAccessButton
        projectPath={projectPath}
        projectName={projectName}
        filePath={filePath}
        rawUrl={rawUrl}
        showOpenAction={showOpenAction}
      />
    </div>
  );
}

export default function ContextFileModal({
  open,
  // ── Project file mode ─────────────────────────────────────────
  projectName,
  projectPath,     // absolute project root path (optional) — enables
                   //   reveal-in-finder / open-in-default-app via the
                   //   Electron IPC. Falls back to the download URL on
                   //   the web.
  filePath,        // project-relative path (instructions: ANTON_PROJECT_INSTRUCTIONS_PATH)
  rawUrl,          // optional absolute URL for inline media (images) and the
                   //   Download action. Lets attachments — which have no
                   //   project file path — render images inline and save
                   //   without project-file IO, on desktop too (savesFile).
  isAntonMd,       // optional override; otherwise derived from filePath
  /* False drops the desktop "Open" action, which hands the file to the OS
     default app (host.openPath): for a path the agent named, not the user. */
  showOpenAction = true,
  /* False drops Edit, for a viewer that only shows the file, such as a
     figure's source, which is that figure's evidence. */
  showEditAction = true,
  /* True reads a non-image `rawUrl` (an attachment, which has no project
     path) and shows its bytes as text when they are UTF-8 text under the
     inline cap; anything else lands in the binary panel, as it does without
     this. */
  showRawText = false,
  /* An optional one-line note under the header, e.g. what the shown file is. */
  note = null,
  // ── Generic / shared ─────────────────────────────────────────
  title,           // overrides the header title (otherwise filePath / 'anton.md')
  subtitle,        // optional label after the title (e.g. "Project · acme")
  initialContent,  // optional preview from the listing — saves a fetch on open
  loader,          // optional async () => string. Falls back to readProjectFile.
  saver,           // optional async (content) => void. Falls back to writeProjectFile.
  remover,         // optional async () => void. `null` disables delete; otherwise
                   //   falls back to deleteProjectFile.
  startInEditMode, // optional bool — overrides the "open in edit if empty" default.
  placeholder,     // optional textarea placeholder
  emptyMessage,    // optional message shown when content is empty + not editing
  dense,           // pass-through to MarkdownContent — smaller type for memory previews
  editable = true, // server-derived shared-resource edit capability
  deletable,       // server-derived shared-resource delete capability. Left
                   //   undefined it means "no decision", which widens to true
                   //   for ordinary files and stays closed for anton.md.
  attributionResource,
  onResourceLoaded,// receives fresh file attribution/capabilities from read/write responses
  onClose,
  onChanged,       // called after a successful save / delete so callers can refresh
}) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // A failed save or delete; the file stays on screen.
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // A failed read; the body shows nothing but this.
  const [loadError, setLoadError] = useState('');
  // Which render branch the modal is in:
  //   'text'   — Markdown / plain text, the original editable view.
  //   'html'   — load as an iframe via projects preview-mount (parity
  //              with how artifacts surface HTML dashboards).
  //   'image'  — render the file inline as an <img> from its raw URL
  //              (project download URL or an attachment's raw URL).
  //   'document' — an .xlsx, .docx, .pptx or .pdf in the read-only
  //              document preview, the frame agent-made files use.
  //   'binary' — can't render inline (too large, not UTF-8, image,
  //              archive…). Show "Open in Finder" / "Download"
  //              affordances instead of dumping bytes into the modal.
  const [mode, setMode] = useState('text');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [binaryDetail, setBinaryDetail] = useState('');
  // The file the binary panel shows because this viewer has no preview for
  // it, not because its image or HTML failed to load; on web the panel
  // downloads it. `{ url, refused }`: held with that file's URL, so a render
  // that still carries the previous file's state never downloads the next
  // one, and with why it shows no text (TOO_LARGE or NOT_TEXT).
  const [noPreview, setNoPreview] = useState(null);
  const textareaRef = useRef(null);
  /*
    The load effect must not re-fire when a capability changes. Reading the
    file back can itself flip `editable` (the listing row carried no decision,
    the GET did), which would otherwise mean a second read on every open, and
    a revoked `canEdit` arriving mid-typing would reset the draft. The
    callback rides a ref for the same reason: an inline arrow from a caller
    would turn the effect into an unbounded fetch loop.
  */
  const canEdit = editable && showEditAction;
  const editableRef = useRef(canEdit);
  const onResourceLoadedRef = useRef(onResourceLoaded);
  useEffect(() => { editableRef.current = canEdit; }, [canEdit]);
  useEffect(() => { onResourceLoadedRef.current = onResourceLoaded; }, [onResourceLoaded]);

  const isAnton = !!(isAntonMd ?? (filePath === ANTON_PROJECT_INSTRUCTIONS_PATH));
  // Generic mode = caller wired up its own loader/saver and didn't
  // pass a project file context. Used to gate the anton-specific
  // empty-state default and the project-file fallback IO.
  const genericMode = typeof saver === 'function' || typeof loader === 'function';

  const headerTitle = title ?? (isAnton ? 'anton.md' : filePath);
  const headerSubtitle = subtitle ?? (isAnton ? 'Project instructions' : null);
  const editorPlaceholder = placeholder ?? (isAnton
    ? "Tell the agent how to work in this project — codebase conventions, output preferences, things to avoid…"
    : 'File contents');
  const emptyText = emptyMessage ?? (isAnton
    ? '(no instructions yet — click Edit to add some)'
    : '(empty file)');

  // Markdown files render with our chat MarkdownContent component so
  // headings, lists, code fences, tables, and links look the way they
  // do anywhere else in the app. Anything else (txt, json, yaml…)
  // falls back to a monospace `<pre>` with the raw bytes — beautifying
  // those would obscure the actual contents the user came to inspect.
  // The fallback ID for the modal-edit case (no filePath, e.g. memory
  // entries identified by relativePath through `title`) is "anton.md"
  // so memory rows still render markdown.
  const referencePath = filePath || title || '';
  // Image files render inline as an <img>. Detected purely by
  // extension on the reference path so it works for both project
  // files (download URL) and attachments (raw URL, no project path).
  const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(referencePath);
  const isMarkdown = /\.md$/i.test(referencePath) || referencePath === ''
    || isAnton
    || genericMode;
  const bytesUrl = genericMode ? '' : fileUrl({ projectName, filePath, rawUrl });
  /*
    An .xlsx, .docx, .pptx or .pdf previews read-only in the document frame,
    as an agent-made file does, when the build has its renderer
    (documentPreviewType) and this shell may mount that frame
    (host.supportsDocumentPreview). A preview that fails offers Download
    where the file saves and Open elsewhere, so on desktop a viewer without
    the open action keeps the panel for a project file.
  */
  const fileSaves = savesFile({ projectName, filePath, rawUrl });
  const documentType = bytesUrl && host.supportsDocumentPreview && (fileSaves || showOpenAction)
    ? documentPreviewType({ path: filePath })
    : null;
  /* What a read that finds no file says: an attachment is read by its raw
     URL, a project file by its path. */
  const missing = rawUrl
    ? `${headerTitle || 'This file'} is no longer attached to this chat.`
    : `${filePath} is no longer in this project.`;

  // Load on open. Anton.md is special-cased server-side: the read
  // endpoint returns an empty body when the file doesn't exist yet,
  // so we always get a clean string here. HTML project files take a
  // separate path (preview-mount → iframe); binary or oversized
  // files fall through to a "Reveal / Download" affordance.
  useEffect(() => {
    if (!open) {
      // Reopened on the same file, the first render still holds this
      // file's state; the panel it mounts must not download before the
      // read below decides again.
      setNoPreview(null);
      return;
    }
    let cancelled = false;
    setError('');
    setLoadError('');
    /* A reused viewer must never show the previous file under this one's
       name, nor keep editing into it: Save would write the empty draft over
       a file this viewer has not read. */
    setContent('');
    setDraft('');
    setEditing(false);
    setPreviewUrl('');
    setPreviewHtml('');
    setBinaryDetail('');
    setNoPreview(null);
    setMode('text');
    /* The binary panel for a file this viewer has no preview for, because
       it is TOO_LARGE or NOT_TEXT. */
    const showNoPreview = (refused) => {
      setMode('binary');
      setNoPreview({ url: fileUrl({ projectName, filePath, rawUrl }), refused });
    };

    // Image branch (before the project-IO guard): render inline as an
    // <img>. Works for project files (download URL from name+path) and
    // attachments (a `rawUrl` with no projectName). Runs first so an
    // attachment image never falls into the guard below.
    if (isImage) {
      const url = fileUrl({ projectName, filePath, rawUrl });
      if (url) {
        setMode('image');
        setLoading(true);
        // The CSP blocks a direct <img src="http://127.0.0.1/…"> (img-src is
        // 'self' data: blob:), but connect-src allows the loopback origin —
        // so fetch the bytes and render them as a blob: URL.
        let objectUrl = '';
        fetchAuthenticatedBlob(url)
          .then((blob) => {
            if (cancelled) return;
            objectUrl = URL.createObjectURL(blob);
            setPreviewUrl(objectUrl);
            setLoading(false);
          })
          .catch((e) => {
            if (cancelled) return;
            if (e?.status === 404) {
              setLoadError(missing);
            } else {
              setMode('binary');
              setBinaryDetail('Could not load image.');
            }
            setLoading(false);
          });
        return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
      }
    }

    // Document branch (before the project-IO guard, like the image
    // branch): DocumentPreview reads the bytes itself, so nothing loads
    // here, and a read it can't make comes back through onLoadError.
    if (documentType) {
      setMode('document');
      setLoading(false);
      return () => { cancelled = true; };
    }

    // No project file IO is possible (e.g. an attachment: `rawUrl` set,
    // no projectName). A non-image attachment can still be saved via the
    // binary panel's Download action, so land in 'binary' mode rather than
    // a stuck empty 'text' view.
    if (!genericMode && (!filePath || !projectName)) {
      if (rawUrl && showRawText) {
        setLoading(true);
        readInlineText(rawUrl)
          .then((read) => {
            if (cancelled) return;
            if (read.refused) {
              showNoPreview(read.refused);
            } else {
              setContent(read.text);
              setDraft(read.text);
            }
          })
          .catch((e) => {
            if (cancelled) return;
            setLoadError(e?.status === 404 ? missing : (e?.message || 'Could not read file'));
          })
          .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
      }
      if (rawUrl) {
        showNoPreview(NOT_TEXT);
        setLoading(false);
      }
      return () => { cancelled = true; };
    }

    // HTML branch: project-file preview-mount, iframe srcs the mount's `url`.
    if (!genericMode && filePath && /\.html?$/i.test(filePath)) {
      setLoading(true);
      // Web: an iframe `src` can't carry the Bearer token, so read the file
      // with it, inline its relative assets and hand the markup over as
      // `srcdoc`. See inlineHtmlAssets for what still can't load. Anything
      // left un-inlined resolves against the file's folder on the API rather
      // than the app's pages, and `#` links scroll in place.
      if (host.isWeb) {
        const reading = new AbortController();
        readInlineText(projectFileDownloadUrl(projectName, filePath), HTML_PREVIEW_MAX_BYTES)
          .then(async (read) => {
            if (cancelled) return;
            if (read.refused) {
              showNoPreview(read.refused);
              return;
            }
            const html = await inlineHtmlFromApi(read.text, {
              rootUrl: projectFileDownloadUrl(projectName, ''),
              filePath,
              signal: reading.signal,
            });
            if (cancelled) return;
            setPreviewHtml(html);
            setMode('html');
          })
          .catch((e) => {
            if (cancelled) return;
            if (e?.status === 404) {
              setLoadError(missing);
            } else {
              setMode('binary');
              setBinaryDetail(e?.message || 'Could not load preview');
            }
          })
          .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; reading.abort(); };
      }
      mountProjectFilePreview(projectName, filePath)
        .then((res) => {
          if (cancelled) return;
          if (!res?.url) throw new Error('Preview mount returned no URL');
          setPreviewUrl(res.url);
          setMode('html');
        })
        .catch((e) => {
          if (cancelled) return;
          setMode('binary');
          setBinaryDetail(e?.message || 'Could not load preview');
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }

    if (initialContent != null) {
      // Hot path — caller had the content already (from a recent
      // fetch / a draft). Skip the round trip.
      setContent(initialContent);
      setDraft(initialContent);
      setEditing(editableRef.current && (startInEditMode ?? (isAnton && !initialContent.trim())));
      return undefined;
    }
    setLoading(true);
    const read = typeof loader === 'function'
      ? loader()
      : readProjectFile(projectName, filePath);
    Promise.resolve(read)
      .then((body) => {
        if (cancelled) return;
        const text = typeof body === 'string' ? body : (body?.content || '');
        if (body && typeof body === 'object') onResourceLoadedRef.current?.(body);
        setContent(text);
        setDraft(text);
        setEditing(editableRef.current && (startInEditMode ?? (isAnton && !text.trim())));
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e?.message || 'Could not read file';
        // 413 (too large) and 415 (not UTF-8 / not a text file) are
        // expected for binary or oversized files. Surface a graceful
        // "Reveal in Finder / Download" affordance instead of the
        // raw error.
        if (!genericMode && /HTTP 413|HTTP 415|too large|not valid UTF-8/i.test(msg)) {
          // The server checks the size first, so a 413 may hold any bytes.
          showNoPreview(/HTTP 413|too large/i.test(msg) ? TOO_LARGE : NOT_TEXT);
          setBinaryDetail(msg);
        } else if (!genericMode && e?.status === 404) {
          setLoadError(missing);
        } else {
          setLoadError(msg);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, filePath, projectName, initialContent, isAnton, loader, genericMode, startInEditMode, isImage, documentType, rawUrl, showRawText, missing]);

  // Esc + backdrop dismissal are handled by <Modal> (suppressed while busy).

  // Focus the textarea when entering edit mode.
  useEffect(() => {
    if (!editing) return;
    const id = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [editing]);

  const save = async () => {
    if (!canEdit) return;
    setBusy(true);
    setError('');
    try {
      let savedResource;
      if (typeof saver === 'function') {
        savedResource = await saver(draft);
      } else {
        savedResource = await writeProjectFile(projectName, filePath, draft);
      }
      if (savedResource && typeof savedResource === 'object') {
        onResourceLoaded?.(savedResource);
      }
      setContent(draft);
      setEditing(false);
      onChanged?.({ path: filePath, content: draft });
    } catch (e) {
      setError(e?.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  /* The footer's Cancel and Save stand only under the editor, which only a
     text file this viewer read shows. */
  const editingText = editing && mode === 'text' && !loadError;

  // `null` explicitly disables delete. Project-file mode otherwise falls back
  // to deleteProjectFile, including the capability-gated instructions file.
  const deleteApplicable = remover !== null;
  /*
    The agent reads the project instructions file every turn, so it stays
    undeletable unless a caller hands down an explicit server capability. Any
    surface that opens this modal on that path without one gets the protection
    for free instead of having to remember two props.
  */
  const deleteAllowed = isAnton ? deletable === true : (deletable ?? true);

  const askToDelete = () => {
    if (!deleteApplicable || !deleteAllowed) return;
    setConfirmingDelete(true);
  };

  const handleDelete = async () => {
    if (!deleteApplicable || !deleteAllowed) return;
    setConfirmingDelete(false);
    setBusy(true);
    setError('');
    try {
      if (typeof remover === 'function') {
        await remover();
      } else {
        await deleteProjectFile(projectName, filePath);
      }
      onChanged?.({ path: filePath, deleted: true });
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Could not delete');
    } finally {
      setBusy(false);
    }
  };

  // A document preview gets the artifact viewer's room: a sheet, page or
  // slide needs it more than a text file does.
  const documentMode = mode === 'document';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={documentMode ? 'lg' : 'md'}
      width={documentMode ? 'min(1080px, 94vw)' : 'min(720px, 92vw)'}
      // FIXED height — toggling view↔edit must feel like the same modal
      // (textarea + preview both flex:1 to fill it, no jump-on-cancel).
      height={documentMode ? 'min(820px, 88vh)' : 'min(720px, 88vh)'}
      ariaLabel={headerTitle}
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
        <div className="flex items-center justify-between py-[14px] px-[18px]">
          <div className="min-w-0 flex-1 flex items-baseline gap-[10px]">
            <h2 className="s-h3 m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{headerTitle}</h2>
            {headerSubtitle && (
              <span className="section-label">{headerSubtitle}</span>
            )}
          </div>
          <div className="flex items-center gap-[6px]">
            {showEditAction && mode === 'text' && !editing && !loading && !loadError && (
              <Button
                disabled={!editable}
                title={!editable ? 'You do not have permission to edit this shared resource.' : undefined}
                onClick={() => setEditing(true)}
              >Edit</Button>
            )}
            {/* HTML / image / document / binary modes all expose a
                "Reveal" / "Open" / "Download" affordance in the header so
                the user can always get at the file even when the modal
                renders something else inline. */}
            {(mode === 'html' || mode === 'image' || documentMode || mode === 'binary') && !loading && !loadError && (
              <FileAccessButton
                projectPath={projectPath}
                projectName={projectName}
                filePath={filePath}
                rawUrl={rawUrl}
                showOpenAction={showOpenAction}
              />
            )}
            <Tooltip content="Close">
              <button
                type="button"
                className="hover-tint hover-tint-text bg-transparent border-0 text-ink-3 w-[28px] h-[28px] rounded-[6px] inline-grid place-items-center text-[18px] leading-none"
                onClick={() => !busy && onClose?.()}
                aria-label="Close"
                style={{ cursor: busy ? 'not-allowed' : 'pointer' }}
              >×</button>
            </Tooltip>
          </div>
        </div>

        {/* Body is a flex column so the textarea / pre below can both
            `flex: 1` and fill the same vertical space identically.
            The body itself doesn't scroll — content scrolls inside
            the textarea or the pre. */}
        <div className="flex-1 min-h-0 py-4 px-[18px] flex flex-col gap-[10px]">
          {loading && (
            <div className="text-ink-3 text-[13px]">Loading…</div>
          )}
          {loadError && (
            <Alert variant="danger" className="shrink-0">{loadError}</Alert>
          )}
          {error && (
            <Alert variant="danger" className="shrink-0">{error}</Alert>
          )}
          {note && !loadError && (
            <div className="shrink-0 text-[12px] text-ink-3" role="note">{note}</div>
          )}
          <SharedResourceAttribution
            resource={attributionResource}
            className="shrink-0"
          />
          {!editable && (
            <div className="shrink-0 text-[12px] text-ink-3" role="note">
              Read only. You do not have permission to edit this shared resource.
            </div>
          )}
          {/* HTML branch — render inside a sandboxed iframe with the
              preview-mount URL so relative assets resolve. */}
          {!loading && mode === 'html' && (previewUrl || previewHtml) && (
            <div className="flex-1 min-h-0 rounded-card-row overflow-hidden border border-solid border-line bg-surface-2">
              <iframe
                title={headerTitle || 'Preview'}
                src={previewHtml ? undefined : previewUrl}
                srcDoc={limitArtifactFrames(previewHtml) || undefined}
                sandbox="allow-scripts allow-popups allow-forms allow-modals"
                className="w-full h-full border-0 bg-white"
              />
            </div>
          )}
          {/* Image branch — render inline, centered in the same preview
              area the html/binary modes use. On load failure, fall back
              to the binary panel so the user keeps a Reveal/Open escape. */}
          {!loading && mode === 'image' && previewUrl && (
            <div className="flex-1 min-h-0 flex items-center justify-center rounded-card-row overflow-hidden border border-solid border-line bg-surface-2 p-3">
              <img
                src={previewUrl}
                alt={headerTitle}
                className="max-w-full max-h-full object-contain"
                onError={() => { setMode('binary'); setBinaryDetail('Could not load image.'); }}
              />
            </div>
          )}
          {/* Document branch — the same read-only preview, frame and
              failure notes as an agent-made file of this type. */}
          {!loading && !loadError && documentMode && documentType && (
            <div className="relative flex-1 min-h-0 rounded-card-row overflow-hidden border border-solid border-line">
              <DocumentPreview
                source={{ url: bytesUrl, previewType: documentType, filename: headerTitle || 'file' }}
                fetchFile={(url, signal) => fetchAuthenticatedResponse(url, { signal })}
                download={() => downloadAuthenticatedResource(bytesUrl, downloadFilename(filePath))}
                openInDefaultApp={() => openInDefaultApp({ projectPath, filePath })}
                onLoadError={(e) => setLoadError(e?.status === 404 ? missing : (e?.message || 'Could not read file'))}
                fileAction={fileSaves ? 'download' : 'open'}
              />
            </div>
          )}
          {/* Binary / oversized branch — graceful escape hatch. Keyed by
              the file so the next one gets its own download on open. */}
          {!loading && mode === 'binary' && (
            <BinaryFilePanel
              key={bytesUrl || filePath}
              fileName={filePath || title || 'file'}
              detail={binaryDetail}
              projectPath={projectPath}
              projectName={projectName}
              filePath={filePath}
              rawUrl={rawUrl}
              showOpenAction={showOpenAction}
              downloadOnOpen={host.isWeb && !!bytesUrl && noPreview?.url === bytesUrl}
              /* Past the inline cap, a file the viewer would show as text
                 still has a preview; it was too large to show here. */
              downloadedNote={noPreview?.refused === TOO_LARGE ? PREVIEW_FAILED_DOWNLOADED_NOTE : NO_PREVIEW_DOWNLOADED_NOTE}
            />
          )}
          {!loading && !loadError && mode === 'text' && (editing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={editorPlaceholder}
              spellCheck={false}
              disabled={busy}
              // Transparent border — content panel blends into the modal body
              // instead of nesting a hard rectangle. The border is kept (rather
              // than removed) so the panel keeps its layout footprint identical
              // to the markdown viewer below; both must size identically for the
              // view↔edit swap to feel seamless.
              className="flex-1 min-h-0 w-full py-3 px-[14px] rounded-card-row bg-surface-2 border border-solid border-transparent text-ink font-[family-name:var(--font-mono)] text-[13px] leading-[1.55] [outline:none] resize-none box-border"
            />
          ) : isMarkdown ? (
            // Beautiful markdown render for `.md` files (anton.md,
            // memory entries, anything else markdown-shaped). The
            // outer container handles the panel chrome + scroll; the
            // MarkdownContent component just lays out the body.
            <div className="flex-1 min-h-0 py-[14px] px-[18px] bg-surface-2 border border-solid border-transparent rounded-card-row overflow-y-auto">
              {content
                ? <MarkdownContent text={content} id={`ctx-${referencePath || 'doc'}`} complete dense={dense} />
                : <span className="text-ink-3 text-[13px]">{emptyText}</span>}
            </div>
          ) : (
            <pre className="flex-1 min-h-0 m-0 py-[14px] px-4 bg-surface-2 border border-solid border-transparent rounded-card-row font-[family-name:var(--font-mono)] text-[13px] leading-[1.55] text-ink-2 whitespace-pre-wrap break-words overflow-y-auto">{content || emptyText}</pre>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 py-3 px-[18px] bg-surface">
          <div>
            {deleteApplicable && !editingText && !loading && (
              <Button
                variant="danger"
                onClick={askToDelete}
                disabled={busy || !deleteAllowed}
                title={!deleteAllowed ? 'You do not have permission to delete this shared resource.' : undefined}
              >{Ico.trash ? Ico.trash(14) : null}Delete</Button>
            )}
          </div>
          <div className="flex gap-2">
            {editingText && (
              <Button
                variant="subtle"
                onClick={() => {
                  // Cancel edit — restore the persisted content. If
                  // anton.md is still empty after cancel, kick the
                  // modal back to its no-content view.
                  setDraft(content);
                  setEditing(false);
                }}
                disabled={busy}
              >Cancel</Button>
            )}
            {editingText && (
              <Button
                variant="primary"
                onClick={save}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Save'}
              </Button>
            )}
            {!editingText && !loading && (
              <Button
                variant="subtle"
                onClick={() => onClose?.()}
              >Close</Button>
            )}
          </div>
        </div>
      <ConfirmModal
        open={confirmingDelete}
        title={`Delete ${title || filePath || 'this file'}?`}
        message="This cannot be undone."
        confirmLabel="Delete"
        destructive
        // Opened from inside this modal, so it needs the layer above it.
        layer="system"
        onConfirm={handleDelete}
        onClose={() => setConfirmingDelete(false)}
      />
    </Modal>
  );
}
