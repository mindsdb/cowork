// Project mode: projectName/filePath use the project API; isAntonMd enables instruction-specific
// affordances.
// Generic mode: provide title, loader or initialContent, saver, and optional remover.
// Empty/missing anton.md opens in edit mode; other content opens in view mode. startInEditMode
// overrides this.

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { Alert, Button, Tooltip } from '../ui';
import { Modal } from '../ui/Modal';
import {
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
  mountProjectFilePreview,
  projectFileDownloadUrl,
  ANTON_PROJECT_INSTRUCTIONS_PATH,
  BASE,
} from '../../api';
import { MarkdownContent } from '../markdown/MarkdownContent';
import SharedResourceAttribution from '../SharedResourceAttribution';
import { host } from '../../../platform/host';
import {
  downloadAuthenticatedResource,
  fetchAuthenticatedBlob,
} from '../../lib/authenticatedResource';
import { downloadFilename } from '../../lib/browserDownload';

const FONT_BODY    = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_DISPLAY = "var(--font-display, 'Inter', system-ui, sans-serif)";
const FONT_MONO    = "var(--font-mono, 'JetBrains Mono', monospace)";


// Normalize embedded separators when joining a project root and relative path for host.openPath.
function joinAbs(root, rel) {
  if (!root || !rel) return '';
  const r = String(root).replace(/\/+$/, '');
  const p = String(rel).replace(/^\/+/, '');
  return `${r}/${p}`;
}


// Keep reveal/open/download available in the header even when the file cannot render inline.
function FileAccessButton({ projectPath, projectName, filePath, rawUrl }) {
  const isWeb = !!host.isWeb;
  const abs = joinAbs(projectPath, filePath);
  const dlUrl = projectName && filePath ? projectFileDownloadUrl(projectName, filePath) : '';
  // Attachments have a raw URL but no local project path, so hide Reveal and open their URL.
  const hasProjectFile = !!(projectName && filePath);

  if (isWeb) {
    const webUrl = dlUrl || rawUrl;
    if (!webUrl) return null;
    return (
      <button
        type="button"
        onClick={() => {
          downloadAuthenticatedResource(webUrl, downloadFilename(filePath)).catch(() => {});
        }}
        style={{
          textDecoration: 'none',
          cursor: 'pointer',
          background: 'transparent', border: '1px solid var(--line)',
          color: 'var(--ink-2)',
          padding: '6px 12px', borderRadius: 6,
          fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >{Ico.downloadCloud ? Ico.downloadCloud(13) : '↓'} Download</button>
    );
  }

  return (
    <div style={{ display: 'inline-flex', gap: 4 }}>
      {hasProjectFile && (
        <Tooltip content="Reveal in Finder">
          <Button
            onClick={() => abs && host.showItemInFolder(abs)}
          >{Ico.folder ? Ico.folder(13) : '📁'} Reveal</Button>
        </Tooltip>
      )}
      <Tooltip content="Open in default app">
        <Button
          onClick={() => {
            if (rawUrl) host.openExternal(rawUrl);
            else if (abs) host.openPath(abs);
          }}
        >{Ico.externalLink ? Ico.externalLink(13) : '↗'} Open</Button>
      </Tooltip>
    </div>
  );
}


function BinaryFilePanel({ fileName, detail, projectPath, projectName, filePath, rawUrl }) {
  return (
    <div style={{
      flex: 1, minHeight: 0,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 14, textAlign: 'center',
      padding: '32px 20px',
      borderRadius: 8,
      background: 'var(--surface-2)',
      border: '1px solid transparent',
    }}>
      <div style={{
        display: 'inline-grid', placeItems: 'center',
        width: 56, height: 56, borderRadius: 12,
        background: 'color-mix(in srgb, var(--ink-4) 14%, transparent)',
        color: 'var(--ink-3)',
      }}>{Ico.doc ? Ico.doc(26) : '📄'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{
          fontFamily: FONT_DISPLAY, fontSize: 14.5, fontWeight: 600,
          color: 'var(--ink)',
        }}>{fileName}</span>
        <span style={{
          fontFamily: FONT_BODY, fontSize: 12.5,
          color: 'var(--ink-3)', maxWidth: 380, lineHeight: 1.5,
        }}>
          This file can't be displayed inline (binary, too large, or not text). Use the
          actions below to view it.
        </span>
      </div>
      <FileAccessButton
        projectPath={projectPath}
        projectName={projectName}
        filePath={filePath}
        rawUrl={rawUrl}
      />
    </div>
  );
}

export default function ContextFileModal({
  open,
  projectName,
  projectPath,     // Absolute project root for desktop OS actions; web falls back to download.
  filePath,        // project-relative path (instructions: ANTON_PROJECT_INSTRUCTIONS_PATH)
  rawUrl,          // Raw attachment URL for preview/external opening without project-file IO.
  isAntonMd,       // optional override; otherwise derived from filePath
  title,           // overrides the header title (otherwise filePath / 'anton.md')
  subtitle,        // optional uppercase label after the title (e.g. "Project · acme")
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
  const [error, setError] = useState('');
  // Render text for editing, HTML in an iframe, images from raw URLs, and unsupported/oversized
  // files through external-access actions.
  const [mode, setMode] = useState('text');
  const [previewUrl, setPreviewUrl] = useState('');
  const [binaryDetail, setBinaryDetail] = useState('');
  const textareaRef = useRef(null);
  /*
   * Read capability/callback through refs so server capability updates do not refetch and erase a
   * draft,
   * and inline parent callbacks cannot create a fetch loop.
   */
  const editableRef = useRef(editable);
  const onResourceLoadedRef = useRef(onResourceLoaded);
  useEffect(() => { editableRef.current = editable; }, [editable]);
  useEffect(() => { onResourceLoadedRef.current = onResourceLoaded; }, [onResourceLoaded]);

  const isAnton = !!(isAntonMd ?? (filePath === ANTON_PROJECT_INSTRUCTIONS_PATH));
  // Custom loaders/savers bypass project-file defaults and the instructions empty state.
  const genericMode = typeof saver === 'function' || typeof loader === 'function';

  const headerTitle = title ?? (isAnton ? 'anton.md' : filePath);
  const headerSubtitle = subtitle ?? (isAnton ? 'Project instructions' : null);
  const editorPlaceholder = placeholder ?? (isAnton
    ? "Tell the agent how to work in this project — codebase conventions, output preferences, things to avoid…"
    : 'File contents');
  const emptyText = emptyMessage ?? (isAnton
    ? '(no instructions yet — click Edit to add some)'
    : '(empty file)');

  // Render markdown normally and other text verbatim; formatting JSON/YAML would obscure the
  // inspected file.
  // Memory entries without filePath use title, with the existing markdown fallback.
  const referencePath = filePath || title || '';
  // Detect images by reference-path extension for both project files and URL attachments.
  const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(referencePath);
  const isMarkdown = /\.md$/i.test(referencePath) || referencePath === ''
    || isAnton
    || genericMode;

  // Missing project instructions return empty text; HTML mounts separately and unsupported files
  // use external actions.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    setPreviewUrl('');
    setBinaryDetail('');
    setMode('text');

    // Check images before requiring project coordinates so raw-URL attachments can preview inline.
    if (isImage) {
      const url = rawUrl || (projectName && filePath ? projectFileDownloadUrl(projectName, filePath) : '');
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
          .catch(() => {
            if (cancelled) return;
            setMode('binary');
            setBinaryDetail('Could not load image.');
            setLoading(false);
          });
        return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
      }
    }

    // Without project coordinates, raw-URL attachments use binary mode’s Open action instead of an
    // empty text view.
    if (!genericMode && (!filePath || !projectName)) {
      if (rawUrl) {
        setMode('binary');
        setLoading(false);
      }
      return () => { cancelled = true; };
    }

    if (!genericMode && filePath && /\.html?$/i.test(filePath)) {
      setLoading(true);
      mountProjectFilePreview(projectName, filePath)
        .then((res) => {
          if (cancelled) return;
          // `relUrl` ships with `/v1/...`; the API helpers' BASE already
          // includes the `/v1` prefix so we splice it onto the origin.
          const origin = String(BASE || '').replace(/\/v1\/?$/, '');
          const url = `${origin}${res?.relUrl || ''}`;
          if (!url) throw new Error('Preview mount returned no URL');
          setPreviewUrl(url);
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
        // 413/415 are expected for large/binary files; offer external access instead of the raw
        // read error.
        if (!genericMode && /HTTP 413|HTTP 415|too large|not valid UTF-8/i.test(msg)) {
          setMode('binary');
          setBinaryDetail(msg);
        } else {
          setError(msg);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, filePath, projectName, initialContent, isAnton, loader, genericMode, startInEditMode, isImage, rawUrl]);


  useEffect(() => {
    if (!editing) return;
    const id = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [editing]);

  const save = async () => {
    if (!editable) return;
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

  // `null` explicitly disables delete. Project-file mode otherwise falls back
  // to deleteProjectFile, including the capability-gated instructions file.
  const deleteApplicable = remover !== null;
  /*
   * Project instructions are required each turn; allow deletion only with an explicit server
   * capability.
   */
  const deleteAllowed = isAnton ? deletable === true : (deletable ?? true);

  const handleDelete = async () => {
    if (!deleteApplicable || !deleteAllowed) return;
    const confirmTarget = title || filePath || 'this file';
    if (!window.confirm(`Delete ${confirmTarget}? This can't be undone.`)) return;
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      width="min(720px, 92vw)"
      // Keep height fixed across preview/edit swaps.
      height="min(720px, 88vh)"
      ariaLabel={headerTitle}
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px',
        }}>
          <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h2 className="s-h3" style={{
              margin: 0,
              color: 'var(--ink)',
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{headerTitle}</h2>
            {headerSubtitle && (
              <span style={{
                fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>{headerSubtitle}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {mode === 'text' && !editing && !loading && (
              <Button
                disabled={!editable}
                title={!editable ? 'You do not have permission to edit this shared resource.' : undefined}
                onClick={() => setEditing(true)}
              >Edit</Button>
            )}
            {(mode === 'html' || mode === 'image' || mode === 'binary') && !loading && (
              <FileAccessButton
                projectPath={projectPath}
                projectName={projectName}
                filePath={filePath}
                rawUrl={rawUrl}
              />
            )}
            <Tooltip content="Close">
              <button
                type="button"
                className="hover-tint hover-tint-text"
                onClick={() => !busy && onClose?.()}
                aria-label="Close"
                style={{
                  cursor: busy ? 'not-allowed' : 'pointer',
                  background: 'transparent', border: 0,
                  color: 'var(--ink-3)',
                  width: 28, height: 28, borderRadius: 6,
                  display: 'inline-grid', placeItems: 'center',
                  fontSize: 18, lineHeight: 1,
                }}
              >×</button>
            </Tooltip>
          </div>
        </div>

        {/* Let textarea/pre fill the same body space and own their scrolling. */}
        <div style={{
          flex: 1, minHeight: 0,
          padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {loading && (
            <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading…</div>
          )}
          {error && (
            <Alert variant="danger" className="shrink-0">{error}</Alert>
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
          {/* Use the mounted URL so relative HTML assets resolve. */}
          {!loading && mode === 'html' && previewUrl && (
            <div style={{
              flex: 1, minHeight: 0,
              borderRadius: 8, overflow: 'hidden',
              border: '1px solid var(--line)',
              background: 'var(--surface-2)',
            }}>
              <iframe
                title={headerTitle || 'Preview'}
                src={previewUrl}
                sandbox="allow-scripts allow-popups allow-forms allow-modals"
                style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
              />
            </div>
          )}
          {/* Fall back to binary controls when an image fails, retaining Open/Reveal. */}
          {!loading && mode === 'image' && previewUrl && (
            <div style={{
              flex: 1, minHeight: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 8, overflow: 'hidden',
              border: '1px solid var(--line)',
              background: 'var(--surface-2)',
              padding: 12,
            }}>
              <img
                src={previewUrl}
                alt={headerTitle}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                onError={() => { setMode('binary'); setBinaryDetail('Could not load image.'); }}
              />
            </div>
          )}
          {!loading && mode === 'binary' && (
            <BinaryFilePanel
              fileName={filePath || title || 'file'}
              detail={binaryDetail}
              projectPath={projectPath}
              projectName={projectName}
              filePath={filePath}
              rawUrl={rawUrl}
            />
          )}
          {!loading && mode === 'text' && (editing ? (
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={editorPlaceholder}
              spellCheck={false}
              disabled={busy}
              style={{
                flex: 1, minHeight: 0,
                width: '100%',
                padding: '12px 14px', borderRadius: 8,
                background: 'var(--surface-2)',
                // Keep the transparent border’s footprint so viewer/editor swaps do not shift
                // layout.
                border: '1px solid transparent',
                color: 'var(--ink)',
                fontFamily: FONT_MONO, fontSize: 13, lineHeight: 1.55,
                outline: 'none',
                resize: 'none',
                boxSizing: 'border-box',
              }}
            />
          ) : isMarkdown ? (
            <div style={{
              flex: 1, minHeight: 0,
              padding: '14px 18px',
              background: 'var(--surface-2)',
              border: '1px solid transparent',
              borderRadius: 8,
              overflowY: 'auto',
            }}>
              {content
                ? <MarkdownContent text={content} id={`ctx-${referencePath || 'doc'}`} complete dense={dense} />
                : <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>{emptyText}</span>}
            </div>
          ) : (
            <pre style={{
              flex: 1, minHeight: 0,
              margin: 0,
              padding: '14px 16px',
              background: 'var(--surface-2)',
              border: '1px solid transparent',
              borderRadius: 8,
              fontFamily: FONT_MONO, fontSize: 13, lineHeight: 1.55,
              color: 'var(--ink-2)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowY: 'auto',
            }}>{content || emptyText}</pre>
          ))}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8,
          padding: '12px 18px',
          background: 'var(--surface)',
        }}>
          <div>
            {deleteApplicable && !editing && !loading && (
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={busy || !deleteAllowed}
                title={!deleteAllowed ? 'You do not have permission to delete this shared resource.' : undefined}
              >{Ico.trash ? Ico.trash(13) : null}Delete</Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {editing && (
              <Button
                variant="subtle"
                onClick={() => {
                  setDraft(content);
                  setEditing(false);
                }}
                disabled={busy}
              >Cancel</Button>
            )}
            {editing && (
              <Button
                variant="primary"
                onClick={save}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Save'}
              </Button>
            )}
            {!editing && !loading && (
              <Button
                variant="subtle"
                onClick={() => onClose?.()}
              >Close</Button>
            )}
          </div>
        </div>
    </Modal>
  );
}
