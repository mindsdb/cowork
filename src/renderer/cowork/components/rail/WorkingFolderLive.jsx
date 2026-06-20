// Artifacts rail card body.
//
// Strictly an "artifacts" surface: data source is `GET /v1/artifacts`
// (the canonical artifact registry the global Artifacts page uses),
// filtered to the active project. Loose project-tree files don't
// appear here — they're outside the artifact model and trying to
// preview one would 404 on `/v1/artifacts/preview-mount`.
//
// - Orphans resolve the active project name → { name, path } via the
//   projects list, so the path-prefix filter works.
// - Polls every 3s while streaming, plus once when streaming ends.
// - Click → HTML opens in-app viewer; other types → OS openPath.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import Ico from '../Icons';
import {
  fetchActiveProject,
  fetchArtifacts,
  fetchProjects,
  publishArtifact,
  unpublishArtifact,
  publishTargetPath,
  deleteArtifact,
} from '../../api';
import { ArtifactWorkspace } from '../artifact';
import { ConfirmModal } from '../ConfirmModal';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import { host } from '../../../platform/host';
import { isPublishableArtifact } from '../../lib/artifactKinds';

// Map a file extension to a glyph from `Icons.jsx`. Buckets group
// extensions that read the same at glance — code files all get the
// brackets icon, tabular data files all get the database icon, etc.
// Unknown / unmapped extensions fall through to a generic doc.
const EXT_ICON = {
  // Web / published
  html: 'globe', htm: 'globe',
  // Images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
  svg: 'image', webp: 'image', bmp: 'image', ico: 'image',
  // Code
  py: 'code', js: 'code', mjs: 'code', cjs: 'code',
  ts: 'code', tsx: 'code', jsx: 'code',
  css: 'code', scss: 'code', less: 'code',
  sh: 'code', bash: 'code', zsh: 'code',
  rb: 'code', go: 'code', rs: 'code', java: 'code',
  c: 'code', h: 'code', cpp: 'code', hpp: 'code',
  yaml: 'code', yml: 'code', toml: 'code',
  // Tabular / data
  csv: 'database', tsv: 'database', parquet: 'database',
  xlsx: 'database', xls: 'database', xlsm: 'database',
  db: 'database', sqlite: 'database',
  json: 'database', jsonl: 'database', ndjson: 'database',
  sql: 'database',
  // Documents — md/pdf/txt fall through to doc, listed for clarity
  md: 'doc', mdx: 'doc', txt: 'doc', pdf: 'doc',
  rtf: 'doc', log: 'doc',
};

function iconForRow(row) {
  const ext = String(row?.ext || '').replace(/^\./, '').toLowerCase();
  return EXT_ICON[ext] || 'doc';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmailList(raw) {
  const parts = (raw || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    (EMAIL_RE.test(part) ? valid : invalid).push(part);
  }
  return { valid, invalid };
}

function RailPublishDialog({ artifact, busy, error, onCancel, onConfirm }) {
  const [mode, setMode] = useState(artifact?.accessMode || (artifact?.accessProtected ? 'password' : 'public'));
  const [password, setPassword] = useState(artifact?.accessPassword || '');
  const [emailsText, setEmailsText] = useState((artifact?.accessEmails || []).join(', '));
  const [orgAllowed, setOrgAllowed] = useState(!!artifact?.orgAllowed);
  const [reveal, setReveal] = useState(false);
  const selectedPublishVersion = artifact?.publishVersionLabel
    || (artifact?.publishVersionId ? `Version ${String(artifact.publishVersionId).slice(0, 8)}` : '');
  useEffect(() => {
    if (!artifact) return;
    setMode(artifact?.accessMode || (artifact?.accessProtected ? 'password' : 'public'));
    setPassword(artifact?.accessPassword || '');
    setEmailsText((artifact?.accessEmails || []).join(', '));
    setOrgAllowed(!!artifact?.orgAllowed);
    setReveal(false);
  }, [artifact?.path, artifact?.accessMode, artifact?.accessProtected, artifact?.accessPassword, artifact?.orgAllowed]);
  if (!artifact) return null;

  const { valid: parsedEmails, invalid: invalidEmails } = parseEmailList(emailsText);
  const canConfirm = mode === 'public'
    || (mode === 'password' && password.trim().length > 0)
    || (mode === 'restricted' && (parsedEmails.length > 0 || orgAllowed));
  const submit = () => {
    if (!canConfirm || busy) return;
    if (mode === 'password') onConfirm({ mode: 'password', password: password.trim() });
    else if (mode === 'restricted') onConfirm({ mode: 'restricted', emails: parsedEmails, org_allowed: orgAllowed });
    else onConfirm({ mode: 'public' });
  };
  const Option = ({ value, icon, title, detail }) => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => setMode(value)}
        className="w-full text-left"
        style={{
          display: 'grid',
          gridTemplateColumns: '16px minmax(0, 1fr)',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 8,
          border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
          background: active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface-2)',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'inline-flex', color: active ? 'var(--accent)' : 'var(--ink-3)', marginTop: 2 }}>
          {icon}
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: 'var(--ink)' }}>{title}</span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{detail}</span>
        </span>
      </button>
    );
  };

  return (
    <Modal open onClose={onCancel} size="sm" width="min(440px, 94vw)" labelledBy="rail-publish-title">
      <ModalHeader
        id="rail-publish-title"
        title={artifact?.publishedUrl ? 'Update published copy' : 'Publish artifact'}
        subtitle={[artifact?.title || artifact?.path?.split('/').pop(), selectedPublishVersion].filter(Boolean).join(' · ')}
        onClose={onCancel}
      />
      <ModalBody>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '10px minmax(0, 1fr)',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: 'var(--surface-2)',
          marginBottom: 12,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--success)', marginTop: 5 }} />
          <span>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 650, color: 'var(--ink)' }}>
              {selectedPublishVersion ? 'Publishing selected version' : 'Publishing a saved snapshot'}
            </span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {selectedPublishVersion
                ? `${selectedPublishVersion} will be pinned to the public link.`
                : 'Cowork will publish a versioned copy, not a moving local folder.'}
            </span>
          </span>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <Option
            value="public"
            icon={Ico.globe ? Ico.globe(14) : Ico.upload(14)}
            title="Public"
            detail="Anyone with the link can view it."
          />
          <Option
            value="password"
            icon={(Ico.lock || Ico.doc)(14)}
            title="Password"
            detail="Viewers need the password you set here."
          />
          <Option
            value="restricted"
            icon={(Ico.people || Ico.doc)(14)}
            title="Selected people"
            detail="Only invited emails, or your organization, can open it."
          />
        </div>
        {mode === 'password' && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <input
              type={reveal ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              style={{
                flex: 1,
                minWidth: 0,
                border: '1px solid var(--line)',
                background: 'var(--surface)',
                color: 'var(--ink)',
                borderRadius: 8,
                padding: '9px 10px',
                fontSize: 13,
              }}
            />
            <button type="button" className="btn" onClick={() => setReveal((v) => !v)}>
              {reveal ? 'Hide' : 'Show'}
            </button>
          </div>
        )}
        {mode === 'restricted' && (
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            <textarea
              value={emailsText}
              onChange={(e) => setEmailsText(e.target.value)}
              placeholder="teammate@example.com, client@example.com"
              rows={3}
              style={{
                resize: 'vertical',
                border: '1px solid var(--line)',
                background: 'var(--surface)',
                color: 'var(--ink)',
                borderRadius: 8,
                padding: '9px 10px',
                fontSize: 13,
              }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-2)' }}>
              <input type="checkbox" checked={orgAllowed} onChange={(e) => setOrgAllowed(e.target.checked)} />
              Allow everyone in my organization
            </label>
            {invalidEmails.length > 0 && (
              <div style={{ color: 'var(--danger)', fontSize: 12 }}>
                Check: {invalidEmails.join(', ')}
              </div>
            )}
          </div>
        )}
        {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>{error}</div>}
      </ModalBody>
      <ModalFooter>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn primary" onClick={submit} disabled={!canConfirm || busy}>
          {busy ? 'Publishing...' : 'Publish'}
        </button>
      </ModalFooter>
    </Modal>
  );
}


export function WorkingFolderLive({ project, isStreaming, onHandoffArtifact }) {
  const [resolvedProject, setResolvedProject] = useState(null);
  useEffect(() => {
    if (project) return;
    let cancelled = false;
    (async () => {
      try {
        const name = await fetchActiveProject();
        if (cancelled || !name) {
          if (!cancelled) setResolvedProject(null);
          return;
        }
        const projects = await fetchProjects();
        if (cancelled) return;
        setResolvedProject(projects.find((p) => p.name === name) || null);
      } catch {
        if (!cancelled) setResolvedProject(null);
      }
    })();
    return () => { cancelled = true; };
  }, [project]);

  const effectiveProject = project || resolvedProject;
  const projectHints = useMemo(() => (effectiveProject ? [effectiveProject] : []), [effectiveProject]);

  const [rows, setRows] = useState([]);
  // Bumped on every project switch / streaming-tick load. The async
  // load checks the version against the latest before applying its
  // result, so a request that finishes after a project switch can't
  // overwrite the new project's rows. (Earlier the component used a
  // single `inFlight` ref, which dropped the new project's request
  // and let the prior project's response paint into the wrong view.)
  const loadVersion = useRef(0);

  // Apply a fetched artifacts list. We now scope the request
  // server-side via `?project_path=...`, so the response is already
  // narrowed to this project — no client-side prefix filter needed.
  // Still slice to the top 12 newest for the rail.
  const applyArtifacts = (proj, list, ticket) => {
    if (ticket !== loadVersion.current) return;
    const all = Array.isArray(list) ? list : [];
    setRows(all.slice(0, 12));
  };

  // Project switch — clear immediately, then load. The clear is
  // important: without it, the rail keeps painting the previous
  // project's artifacts until the new request returns, which reads
  // as "the wrong artifacts until I refresh."
  useEffect(() => {
    const proj = effectiveProject;
    const ticket = ++loadVersion.current;
    if (!proj?.name || !proj?.path) {
      setRows([]);
      return;
    }
    setRows([]);
    fetchArtifacts({ projectPath: proj.path })
      .then((list) => applyArtifacts(proj, list, ticket))
      .catch(() => { if (ticket === loadVersion.current) setRows([]); });
  }, [effectiveProject?.name, effectiveProject?.path]);

  // Streaming poll — every 3s while live, plus once shortly after
  // streaming ends (catches artifacts written near the very end of
  // the turn). Each tick allocates a fresh ticket so its response
  // is discarded if a project switch lands between request and
  // resolution.
  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    const tick = () => {
      const proj = effectiveProject;
      if (!proj?.name || !proj?.path) return;
      const ticket = ++loadVersion.current;
      fetchArtifacts({ projectPath: proj.path })
        .then((list) => applyArtifacts(proj, list, ticket))
        .catch(() => { /* swallow — keep current rows */ });
    };
    if (isStreaming) {
      const id = setInterval(tick, 3000);
      wasStreaming.current = true;
      return () => clearInterval(id);
    }
    if (wasStreaming.current) {
      const id = setTimeout(tick, 1000);
      wasStreaming.current = false;
      return () => clearTimeout(id);
    }
  }, [isStreaming, effectiveProject?.name, effectiveProject?.path]);

  const [previewArt, setPreviewArt] = useState(null);
  // Keep the open viewer in sync with the 3s poll: when the artifact being
  // previewed is rebuilt, its row's `mtime` changes — propagate that into
  // `previewArt` so ArtifactWorkspace re-mounts and reloads the iframe instead
  // of showing the stale first load (ENG-375). No-op (same reference) when
  // nothing changed, so it doesn't churn renders.
  useEffect(() => {
    setPreviewArt((cur) => {
      if (!cur) return cur;
      const fresh = rows.find((r) => r.path === cur.path);
      return fresh && fresh.mtime !== cur.mtime ? { ...cur, ...fresh } : cur;
    });
  }, [rows]);
  // Per-row kebab menu state (single-open) + portal coords.
  //
  // Why a portal: the rail-card body wraps this component with
  // `overflow-y: auto` (RailCard.jsx). A `position: absolute`
  // dropdown child of an artifact row gets visually clipped by that
  // ancestor's overflow — so the menu appeared to "hide behind" the
  // card. createPortal escapes to document.body, where no ancestor
  // overflow can touch it. We compute viewport-fixed coords from the
  // clicked kebab's getBoundingClientRect() and close on scroll +
  // resize since the kebab might move under a stale menu.
  const [openMenuPath, setOpenMenuPath] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const [busyPath, setBusyPath] = useState(null);
  const [rowError, setRowError] = useState('');
  const [pendingPublishArtifact, setPendingPublishArtifact] = useState(null);
  const [publishDialogError, setPublishDialogError] = useState('');
  // Pending artifact-delete payload — drives the ConfirmModal, same
  // lifted-state pattern as the project-files / task-uploads deletes
  // in ContextCard and the task / project deletes in App.jsx.
  const [pendingDeleteArtifact, setPendingDeleteArtifact] = useState(null);
  const menuRef = useRef(null);
  // Map of artifact.path → kebab button DOM node. Stored in a ref
  // so renders don't replace the map; cleaned up implicitly when
  // rows unmount via the ref callback's null branch.
  const kebabRefs = useRef(new Map());
  const setKebabRef = (path) => (el) => {
    if (el) kebabRefs.current.set(path, el);
    else kebabRefs.current.delete(path);
  };

  const openMenuFor = (path) => {
    const btn = kebabRefs.current.get(path);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    // Menu opens just below the kebab, right-anchored so it can't
    // extend past the right edge of the viewport. `position: fixed`
    // applies these directly to viewport coordinates.
    setMenuPos({
      top: r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
    });
    setOpenMenuPath(path);
  };

  useEffect(() => {
    if (openMenuPath == null) return undefined;
    const onClick = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpenMenuPath(null);
    };
    // The kebab that's anchoring the menu might scroll out from
    // under it (rail-card body has overflow-y:auto) or the window
    // may resize — close in either case so the menu doesn't dangle.
    const onClose = () => setOpenMenuPath(null);
    // Defer one tick so the click that OPENED the menu doesn't
    // propagate up and immediately close it.
    const id = setTimeout(() => document.addEventListener('click', onClick), 0);
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', onClose, true); // capture catches all scrollers
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', onClick);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [openMenuPath]);

  const onOpen = async (path) => {
    try { await host.openPath(path); } catch {}
  };
  // Used by the kebab menu's "Open" action. The deciding factor is
  // whether the artifact file is on THIS machine:
  //   - Electron + local (loopback) server → host.openPath, the file
  //     is on disk here so the OS default app can open it.
  //   - Electron pointed at a REMOTE server, or web → the path is on
  //     the server box, not here. Open the stateless `serveUrl` over
  //     HTTP (origin-relative → hits whatever server we're talking to).
  //     Falls back to publishedUrl, then a clear error.
  const canOpenLocalFile = host.isElectron && host.isLocalApiOrigin();
  const openArtifactExternal = async (a) => {
    if (!canOpenLocalFile) {
      // `serveUrl` is origin-relative (`/v1/...`). In a web tab a
      // relative URL resolves against the page origin (the server) —
      // fine. But an Electron renderer is loaded from file://app://,
      // so a relative URL would resolve there, not at the remote
      // server. Make it absolute via the configured API origin.
      const rel = a?.serveUrl || '';
      const url = rel
        ? (rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`)
        : (a?.publishedUrl || '');
      if (url) {
        try { await host.openExternal(url); } catch {}
        return;
      }
      setRowError('This artifact has no servable file yet.');
      return;
    }
    try {
      const result = await host.openPath(a.path);
      if (result && result.ok === false) {
        setRowError(result.reason || 'Could not open file.');
      }
    } catch (e) {
      setRowError(e?.message || 'Could not open file.');
    }
  };

  const applyPublishResult = (artifact, result) => {
    const url = result?.url || result?.publishedUrl || '';
    const update = (row) => row.path === artifact.path ? {
      ...row,
      publishedUrl: url,
      publishedVersionId: result?.publishedVersionId || result?.published_version_id || row.publishedVersionId || '',
      publishedFilesHash: result?.publishedFilesHash || result?.published_files_hash || row.publishedFilesHash || '',
      publishedManifestHash: result?.publishedManifestHash || result?.published_manifest_hash || row.publishedManifestHash || '',
      publishedVersionNumber: result?.publishedVersionNumber || result?.published_version_number || row.publishedVersionNumber || null,
      accessMode: result?.access?.mode || row.accessMode || 'public',
      accessProtected: !!result?.access?.protected || row.accessProtected || false,
      accessEmails: result?.access?.emails || row.accessEmails || [],
      orgAllowed: result?.access?.org_allowed ?? row.orgAllowed ?? false,
    } : row;
    setRows((prev) => prev.map(update));
    setPreviewArt((current) => current && current.path === artifact.path ? update(current) : current);
  };

  const applyForkResult = (result) => {
    const artifact = result?.artifact || {};
    const path = artifact.path || result?.preview?.path || result?.artifactPath || '';
    const folder = artifact.folder || result?.artifactPath || path;
    const title = artifact.title || artifact.name || String(path || folder).split(/[\\/]/).filter(Boolean).pop() || 'Remix';
    const next = {
      ...artifact,
      id: result?.artifactId || artifact.id || folder || path,
      path,
      folder,
      title,
      updated: 'just now',
      mtime: Date.now(),
    };
    if (!next.path && !next.folder) return;
    setRows((prev) => {
      const withoutDuplicate = prev.filter((row) => (
        row.id !== next.id
        && row.path !== next.path
        && row.folder !== next.folder
      ));
      return [next, ...withoutDuplicate];
    });
    setPreviewArt(next);
  };

  const onTogglePublish = async (a) => {
    if (!a?.path) return;
    setRowError('');
    if (!a.publishedUrl) {
      setPublishDialogError('');
      setPendingPublishArtifact(a);
      return;
    }
    setBusyPath(a.path);
    try {
      await unpublishArtifact(publishTargetPath(a));
      const clearPublished = (row) => row.path === a.path ? {
        ...row,
        publishedUrl: '',
        publishedVersionId: '',
        publishedFilesHash: '',
        publishedManifestHash: '',
        publishedVersionNumber: null,
      } : row;
      setRows((prev) => prev.map(clearPublished));
      setPreviewArt((current) => current && current.path === a.path ? clearPublished(current) : current);
    } catch (e) {
      setRowError(e?.message || 'Publish toggle failed.');
    } finally {
      setBusyPath(null);
    }
  };

  const onRequestPublish = (a, options = {}) => {
    if (!a?.path) return;
    setRowError('');
    setPublishDialogError('');
    setPendingPublishArtifact({
      ...a,
      publishVersionId: options.versionId || options.version_id || '',
      publishVersionLabel: options.versionLabel || options.label || '',
    });
  };

  const onConfirmPublish = async (access) => {
    const artifact = pendingPublishArtifact;
    if (!artifact?.path) return;
    setBusyPath(artifact.path);
    setPublishDialogError('');
    setRowError('');
    try {
      const publishOptions = artifact.publishVersionId ? { versionId: artifact.publishVersionId } : {};
      const result = await publishArtifact(publishTargetPath(artifact), access || { mode: 'public' }, publishOptions);
      applyPublishResult(artifact, result);
      setPendingPublishArtifact(null);
    } catch (e) {
      const message = e?.message || 'Publish failed.';
      setPublishDialogError(message);
      setRowError(message);
    } finally {
      setBusyPath(null);
    }
  };

  const onDeleteArtifact = async (a) => {
    if (!a?.path) return;
    setBusyPath(a.path);
    setRowError('');
    // Optimistic remove — mirrors the Project Files / Task Uploads
    // deletes so the row vanishes the same frame the user confirms.
    // Reached only after the ConfirmModal is accepted (see the
    // menu's Delete item, which sets `pendingDeleteArtifact`).
    const previous = a;
    setRows((prev) => prev.filter((r) => r.path !== a.path));
    try {
      // Unpublish first so deletion never leaves an orphaned public copy.
      // The server enforces the same rule as a backstop.
      if (a.publishedUrl) {
        await unpublishArtifact(publishTargetPath(a));
      }
      // Deletion is centralized through cowork-server (not shell.trashItem),
      // so it works in every shell and the server's unpublish-before-delete
      // guard always runs.
      await deleteArtifact(a.folder || a.path);
    } catch (e) {
      setRowError(e?.message || 'Delete failed.');
      // Restore the row on failure.
      setRows((prev) => prev.find((r) => r.path === previous.path) ? prev : [previous, ...prev]);
    } finally {
      setBusyPath(null);
    }
  };
  // Inline-previewable artifacts open the ArtifactWorkspace modal; the
  // viewer handles HTML via sandboxed iframe and .md/.txt/.csv via
  // the inline text path. Anything else falls through to the OS
  // handler so the user's default app picks it up.
  const _INLINE_PREVIEW_EXTS = ['.html', '.md', '.txt', '.csv'];
  const onOpenArtifact = (artifact) => {
    const ext = (artifact.ext || '').toLowerCase();
    const path = (artifact.path || '').toLowerCase();
    const canPreview = _INLINE_PREVIEW_EXTS.includes(ext)
      || _INLINE_PREVIEW_EXTS.some((e) => path.endsWith(e));
    if (canPreview) {
      setPreviewArt(artifact);
    } else {
      onOpen(artifact.path);
    }
  };

  // The card header used to print the project name + path here, but
  // both are already obvious from the page chrome (the project breadcrumb
  // / project-detail header). Keeping them in the rail double-printed
  // information and crowded the file list. The empty-state text below
  // covers the "no active workspace" case implicitly.

  return (
    <div className="pt-2">
      {rowError && (
        <p className="text-[11px] px-1 pb-0.5" style={{ color: 'var(--danger)' }}>
          {rowError}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-ink-4 px-1 pb-1">
          No artifacts yet — the agent will save dashboards, reports, and
          datasets here as it produces them.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map((a) => {
            const isPublished = !!a.publishedUrl;
            const menuOpen = openMenuPath === a.path;
            return (
              <div
                key={a.path}
                role="button"
                tabIndex={0}
                onClick={() => onOpenArtifact(a)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenArtifact(a);
                  }
                }}
                title={`${a.path}${isPublished ? ` · published` : ''}`}
                className={clsx(
                  'group relative grid items-center gap-2 rounded-md px-1 py-1 text-left',
                  'cursor-pointer transition-colors hover:bg-surface-2',
                  'outline-none focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-accent'
                )}
                style={{ gridTemplateColumns: '14px minmax(0,1fr) auto', font: 'inherit' }}
              >
                {/* Icon — picks up the accent color when the artifact
                    has a publishedUrl so the user can spot what's
                    published at a glance without opening each row. */}
                <span
                  className="inline-flex"
                  style={{ color: isPublished ? 'var(--accent)' : 'var(--ink-4)' }}
                >
                  {(Ico[iconForRow(a)] || Ico.doc)(13)}
                </span>
                <span className="text-[12.5px] text-ink truncate">
                  {a.title || (a.path?.split('/').pop() || '')}
                </span>
                {/* Trailing slot: timestamp normally, kebab on hover
                    or while THIS row's menu is open. Shared-slot
                    trick keeps row width stable. */}
                <span className="relative inline-flex items-center justify-end flex-none" style={{ minWidth: 22 }}>
                  <span className={clsx(
                    'text-[10.5px] text-ink-4 transition-opacity',
                    'group-hover:opacity-0',
                    menuOpen && 'opacity-0',
                  )}>
                    {/* Server pre-formats `updated` as a phrase like
                        "updated 3h ago" — strip the redundant leading
                        "updated " so the column reads as a timestamp
                        rather than a sentence. */}
                    {String(a.updated || '').replace(/^updated\s+/i, '')}
                  </span>
                  <button
                    ref={setKebabRef(a.path)}
                    type="button"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    title="More actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (menuOpen) setOpenMenuPath(null);
                      else openMenuFor(a.path);
                    }}
                    className={clsx(
                      // `justify-end` (not center) pins the kebab to
                      // the right edge of the trailing slot so it sits
                      // flush against the row's right margin — matching
                      // where the project-files trash icon lands. The
                      // artifact timestamp ("3h ago") is wider than the
                      // project-file one ("3h"), so a centered kebab
                      // floated noticeably left of the edge.
                      'absolute inset-0 inline-flex items-center justify-end',
                      menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                      'transition-opacity rounded',
                      'text-ink-4 hover:text-ink',
                      'bg-transparent border-0 cursor-pointer p-0',
                    )}
                  >
                    {Ico.moreVert(13)}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Portaled menu for the currently-open kebab. Lives at
          document.body so the rail-card body's overflow:auto can't
          clip it. `position: fixed` uses viewport coords computed
          from the kebab's getBoundingClientRect() in openMenuFor. */}
      {openMenuPath != null && menuPos != null && createPortal(
        (() => {
          const a = rows.find((r) => r.path === openMenuPath);
          if (!a) return null;
          const isPublished = !!a.publishedUrl;
          const canTogglePublish = isPublished || isPublishableArtifact(a);
          const openLabel = canOpenLocalFile ? 'Open in OS' : 'Open in new tab';
          return (
            <div
              ref={menuRef}
              role="menu"
              onClick={(e) => e.stopPropagation()}
              className="menu"
              style={{
                position: 'fixed',
                top: menuPos.top,
                right: menuPos.right,
                minWidth: 180,
                zIndex: 100,
              }}
            >
              <button
                type="button"
                className="menu-item"
                disabled={busyPath === a.path}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuPath(null);
                  openArtifactExternal(a);
                }}
              >
                <span style={{ display: 'inline-flex', color: 'var(--frost-700)' }}>
                  {(Ico.externalLink || Ico.upload)(13)}
                </span>
                <span>{openLabel}</span>
              </button>
              {canTogglePublish && (
                <button
                  type="button"
                  className="menu-item"
                  disabled={busyPath === a.path}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuPath(null);
                    onTogglePublish(a);
                  }}
                >
                  <span style={{
                    display: 'inline-flex',
                    color: isPublished ? 'var(--accent)' : 'var(--frost-700)',
                  }}>
                    {Ico.globe ? Ico.globe(13) : Ico.upload(13)}
                  </span>
                  <span>{isPublished ? 'Unpublish' : 'Publish'}</span>
                </button>
              )}
              <div style={{ height: 1, background: 'var(--border-0)', margin: '4px 0' }} />
              <button
                type="button"
                className="menu-item"
                disabled={busyPath === a.path}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuPath(null);
                  // Open the confirm modal rather than deleting
                  // immediately — matches the project files / task
                  // uploads / task / project delete flows.
                  setPendingDeleteArtifact(a);
                }}
                style={{ color: 'var(--danger)' }}
              >
                <span style={{ display: 'inline-flex', color: 'var(--danger)' }}>{Ico.trash(13)}</span>
                <span>Move to Deleted</span>
              </button>
            </div>
          );
        })(),
        document.body,
      )}

      <ConfirmModal
        open={!!pendingDeleteArtifact}
        title={`Move "${pendingDeleteArtifact?.title || pendingDeleteArtifact?.path?.split('/').pop() || 'artifact'}" to Deleted?`}
        message="Cowork will remove this artifact from Live Artifacts and move it to Deleted when recovery is available. If it is published, the live link will be unpublished first."
        confirmLabel="Move to Deleted"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingDeleteArtifact(null)}
        onConfirm={() => {
          const target = pendingDeleteArtifact;
          setPendingDeleteArtifact(null);
          if (target) onDeleteArtifact(target);
        }}
      />

      <RailPublishDialog
        artifact={pendingPublishArtifact}
        busy={!!pendingPublishArtifact && busyPath === pendingPublishArtifact.path}
        error={publishDialogError}
        onCancel={() => {
          if (busyPath === pendingPublishArtifact?.path) return;
          setPendingPublishArtifact(null);
          setPublishDialogError('');
        }}
        onConfirm={onConfirmPublish}
      />

      <ArtifactWorkspace
        open={!!previewArt}
        artifact={previewArt}
        projects={projectHints}
        onClose={() => setPreviewArt(null)}
        onPublish={onRequestPublish}
        onUnpublish={onTogglePublish}
        onForked={applyForkResult}
        onHandoff={onHandoffArtifact}
        onChange={(updated) => {
          setPreviewArt(updated);
          setRows((prev) => prev.map((a) => (
            a.path === updated.path ? { ...a, ...updated } : a
          )));
        }}
      />
    </div>
  );
}
