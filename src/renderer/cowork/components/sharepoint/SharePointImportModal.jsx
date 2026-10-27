// Pick files and folders from a SharePoint library and import them into a
// project. Browsing goes through the connection's own sites; the import is one
// request, so the modal holds a busy state (and can't be closed) until it
// answers, then shows what landed and what was skipped. Picking a folder takes
// everything in it: the server walks it and refuses an import over its limits.

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Field, Select, Spinner } from '../ui';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../ui/Modal';
import Ico from '../Icons';
import { fetchSavedConnection, importSharePointFiles, listSharePointLibraries } from '../../api';
import { SHAREPOINT_ENGINE } from './SharePointSetupModal';
import { ROOT, useSharePointTree } from './useSharePointTree';

export const MAX_PICKS = 100;
export const PROJECT_FILES_CHANGED = 'anton:project-files-changed';

/** A file size for the tree, such as "2.0 KB"; empty for an unknown or zero size. */
function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The name a person sees for a connection: its label, else its saved name. */
function connectionLabel(connection) {
  return connection.user_label || connection.name;
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.projectName the project the files land in, at its root
 * @param {{name: string, user_label?: string|null}[]} props.connections SharePoint connections
 * @param {() => void} props.onClose
 * @param {(result: {imported: object[], skipped: object[]}) => void} [props.onImported]
 */
export default function SharePointImportModal({ open, projectName, connections, onClose, onImported }) {
  const [busy, setBusy] = useState(false);
  const close = busy ? undefined : onClose;
  return (
    <Modal
      open={open}
      onClose={close}
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
      size="md"
      labelledBy="sharepoint-import-title"
    >
      <ModalHeader
        id="sharepoint-import-title"
        title="Add files from SharePoint"
        subtitle={`Copies land at the top of ${projectName}.`}
        onClose={close}
      />
      {open && (
        <ImportBody
          projectName={projectName}
          connections={connections}
          busy={busy}
          setBusy={setBusy}
          onClose={onClose}
          onImported={onImported}
        />
      )}
    </Modal>
  );
}

/** Ids of everything loaded under a folder, at any depth. */
function loadedDescendants(tree, folderId) {
  const found = [];
  const pending = [folderId];
  while (pending.length) {
    for (const item of tree.node(pending.pop()).items) {
      found.push(item.id);
      if (item.kind === 'folder') pending.push(item.id);
    }
  }
  return found;
}

/** The picking view: connection, site and library choices, the tree, and the import itself. */
function ImportBody({ projectName, connections, busy, setBusy, onClose, onImported }) {
  const [connection, setConnection] = useState(connections[0]?.name || null);
  const [sites, setSites] = useState([]);
  const [site, setSite] = useState(null);
  const [libraries, setLibraries] = useState([]);
  const [driveId, setDriveId] = useState(null);
  const [selected, setSelected] = useState(() => new Map());
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  // Set once the connection, site or library choice can't go further, so the
  // tree shows why instead of loading forever.
  const [blocked, setBlocked] = useState(null);

  useEffect(() => {
    setSites([]);
    setSite(null);
    setError(null);
    setBlocked(null);
    if (!connection) return undefined;
    let active = true;
    fetchSavedConnection(SHAREPOINT_ENGINE, connection)
      .then((saved) => {
        if (!active) return;
        const urls = String(saved?.fields?.site_urls || '').split('\n').map((line) => line.trim()).filter(Boolean);
        setSites(urls);
        setSite(urls[0] || null);
        if (!urls.length) setBlocked('This connection names no sites. Edit it in Customize to add one.');
      })
      .catch((err) => { if (active) setBlocked(err?.message || 'This connection could not be loaded.'); });
    return () => { active = false; };
  }, [connection]);

  useEffect(() => {
    setLibraries([]);
    setDriveId(null);
    setError(null);
    if (!connection || !site) return undefined;
    setBlocked(null);
    let active = true;
    listSharePointLibraries(connection, site)
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data?.libraries) ? data.libraries : [];
        setLibraries(list);
        setDriveId(list[0]?.id || null);
        if (!list.length) setBlocked('This site has no document libraries.');
      })
      .catch((err) => { if (active) setBlocked(err?.message || "This site's libraries could not be listed."); });
    return () => { active = false; };
  }, [connection, site]);

  // Picks belong to one library: ids are only meaningful in the drive they came from.
  useEffect(() => {
    setSelected(new Map());
    setError(null);
  }, [connection, site, driveId]);

  const tree = useSharePointTree({ connection, site, driveId });
  const atCap = selected.size >= MAX_PICKS;

  const toggleSelected = (item) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
        return next;
      }
      if (next.size >= MAX_PICKS) return next;
      // A picked folder brings everything in it, so earlier picks inside it
      // would only count twice toward the cap.
      if (item.kind === 'folder') {
        for (const id of loadedDescendants(tree, item.id)) next.delete(id);
      }
      next.set(item.id, item);
      return next;
    });
  };

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const imported = await importSharePointFiles(projectName, {
        connection, site, driveId, itemIds: [...selected.keys()],
      });
      setResult(imported);
      window.dispatchEvent(new CustomEvent(PROJECT_FILES_CHANGED, { detail: { project: projectName } }));
      onImported?.(imported);
    } catch (err) {
      setError(err?.message || 'The import failed.');
    } finally {
      setBusy(false);
    }
  }

  const siteOptions = useMemo(() => sites.map((url) => ({ value: url, label: url })), [sites]);
  const libraryOptions = useMemo(() => libraries.map((lib) => ({ value: lib.id, label: lib.name })), [libraries]);
  const connectionOptions = useMemo(
    () => connections.map((c) => ({ value: c.name, label: connectionLabel(c) })),
    [connections],
  );

  if (result) {
    return <ImportResult result={result} onDone={onClose} />;
  }

  return (
    <>
      <ModalBody>
        <div className="flex flex-col gap-3">
          {error && <Alert variant="danger">{error}</Alert>}
          {connections.length > 1 && (
            <Field label="Connection">
              <Select value={connection || ''} onValueChange={setConnection} options={connectionOptions} disabled={busy} />
            </Field>
          )}
          {sites.length > 1 && (
            <Field label="Site">
              <Select value={site || ''} onValueChange={setSite} options={siteOptions} disabled={busy} />
            </Field>
          )}
          {libraries.length > 1 && (
            <Field label="Library">
              <Select value={driveId || ''} onValueChange={setDriveId} options={libraryOptions} disabled={busy} />
            </Field>
          )}
          <div
            role="region"
            aria-label="SharePoint files and folders"
            className="max-h-[360px] overflow-auto rounded-lg border border-solid border-line py-1.5"
          >
            {blocked ? (
              <div className="px-3 py-2 text-[12px] text-danger">{blocked}</div>
            ) : driveId ? (
              <TreeLevel
                tree={tree}
                folderId={ROOT}
                depth={0}
                covered={false}
                selected={selected}
                atCap={atCap}
                busy={busy}
                onToggleSelected={toggleSelected}
              />
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-ink-3">
                <Spinner /> Loading…
              </div>
            )}
          </div>
          <p className="m-0 text-[12px] text-ink-3" aria-live="polite">
            {selected.size} of {MAX_PICKS} picked. Files inside a picked folder count toward the {MAX_PICKS}-file limit too.
          </p>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="subtle" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="button" variant="primary" onClick={runImport} disabled={busy || selected.size === 0}>
          {busy ? 'Importing…' : `Import into ${projectName}`}
        </Button>
      </ModalFooter>
    </>
  );
}

/** One folder's loaded items, with its own loading, error, empty and "Load more" rows. */
function TreeLevel({ tree, folderId, depth, covered, selected, atCap, busy, onToggleSelected }) {
  const node = tree.node(folderId);
  const indent = { paddingLeft: 12 + depth * 18 };
  return (
    <div>
      <ul className="m-0 list-none p-0">
      {node.items.map((item) => {
        const picked = selected.has(item.id);
        const checked = covered || picked;
        const isFolder = item.kind === 'folder';
        const child = isFolder ? tree.node(item.id) : null;
        return (
          <li key={item.id}>
            <div className="flex items-center gap-2 py-1 pr-3 text-[13px]" style={indent}>
              {isFolder ? (
                <button
                  type="button"
                  className="inline-flex h-4 w-4 items-center justify-center text-ink-3"
                  aria-expanded={child.expanded}
                  aria-label={child.expanded ? `Collapse ${item.name}` : `Expand ${item.name}`}
                  onClick={() => tree.toggle(item.id)}
                  style={{ transform: child.expanded ? 'rotate(90deg)' : undefined }}
                >
                  {Ico.chevronRight(12)}
                </button>
              ) : (
                <span className="inline-block h-4 w-4" />
              )}
              <Checkbox
                size="sm"
                checked={checked}
                disabled={busy || covered || item.kind === 'other' || (!picked && atCap)}
                onCheckedChange={() => onToggleSelected(item)}
                aria-label={`Pick ${item.name}`}
              />
              <span className="inline-flex text-ink-3">{isFolder ? Ico.folder(14) : Ico.doc(14)}</span>
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {!isFolder && <span className="shrink-0 text-[12px] text-ink-4">{formatSize(item.size)}</span>}
            </div>
            {isFolder && child.expanded && (
              <TreeLevel
                tree={tree}
                folderId={item.id}
                depth={depth + 1}
                covered={checked}
                selected={selected}
                atCap={atCap}
                busy={busy}
                onToggleSelected={onToggleSelected}
              />
            )}
          </li>
        );
      })}
      </ul>
      {node.loading && (
        <div className="flex items-center gap-2 py-1 text-[12px] text-ink-3" style={indent}>
          <Spinner /> Loading…
        </div>
      )}
      {node.error && (
        <div className="flex items-center gap-2 py-1 text-[12px] text-danger" style={indent}>
          <span>{node.error}</span>
          <Button size="sm" variant="subtle" onClick={() => tree.retry(folderId)}>Try again</Button>
        </div>
      )}
      {node.loaded && !node.loading && !node.error && node.items.length === 0 && (
        <div className="py-1 text-[12px] italic text-ink-4" style={indent}>This folder is empty.</div>
      )}
      {node.cursor && !node.loading && (
        <div className="py-1" style={indent}>
          <Button size="sm" variant="subtle" onClick={() => tree.loadMore(folderId)}>Load more</Button>
        </div>
      )}
    </div>
  );
}

/** What the finished import brought in, and what it skipped and why. */
function ImportResult({ result, onDone }) {
  const imported = result?.imported || [];
  const skipped = result?.skipped || [];
  return (
    <>
      <ModalBody>
        <div className="flex flex-col gap-3">
          <Alert variant="success">
            Imported {imported.length} file{imported.length === 1 ? '' : 's'}.
          </Alert>
          {skipped.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[12px] text-ink-3">
                Skipped {skipped.length} item{skipped.length === 1 ? '' : 's'}:
              </div>
              <ul className="m-0 pl-[18px] text-[12px] text-ink-2">
                {skipped.map((item) => (
                  <li key={item.path}>{item.path}: {item.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="primary" onClick={onDone}>Done</Button>
      </ModalFooter>
    </>
  );
}
