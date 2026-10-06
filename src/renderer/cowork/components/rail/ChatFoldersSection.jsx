// "Working folders" section of the chat's Context card. Local folders the
// user added to this chat; the agent may read and write in them. Desktop
// only: the caller renders it for a saved chat outside org mode, keyed by the
// chat id so a switch starts a fresh instance. File rows are display-only,
// because no route serves a working-folder file's content.

import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import Ico from '../Icons';
import { Tooltip } from '../ui';
import {
  addConversationFolder,
  listConversationFolderFiles,
  listConversationFolders,
  removeConversationFolder,
} from '../../api';
import { ConfirmModal } from '../ConfirmModal';
import { host } from '../../../platform/host';

/** Files worth showing: no directories and nothing under a hidden segment. */
function visibleFiles(files) {
  return (Array.isArray(files) ? files : []).filter((f) => {
    if (!f || f.is_dir) return false;
    return !String(f.path || '').split('/').some((seg) => seg.startsWith('.'));
  });
}

function FolderFiles({ state }) {
  if (!state || state.loading) {
    return <p className="text-[12px] text-ink-4 px-1 pb-0.5">Loading files…</p>;
  }
  if (state.error) {
    return <p className="text-xs px-1 pb-0.5 text-danger">{state.error}</p>;
  }
  if (state.files.length === 0) {
    return <p className="text-[12px] text-ink-4 px-1 pb-0.5">No files in this folder.</p>;
  }
  return (
    <div
      className={clsx('flex flex-col gap-0.5', state.files.length > 10 && 'overflow-y-auto pr-1 scroll-clean')}
      style={state.files.length > 10 ? { maxHeight: 220 } : undefined}
    >
      {state.files.map((file) => (
        <div
          key={file.path}
          data-testid="folder-file-row"
          title={file.path}
          className="grid items-center gap-2 rounded-card-row px-1 py-1 grid-cols-[14px_minmax(0,1fr)]"
        >
          <span className="text-ink-4 inline-flex flex-none">{Ico.doc(13)}</span>
          <span className="block truncate text-sm text-ink min-w-0">{file.path}</span>
        </div>
      ))}
      {state.truncated && (
        <p className="text-[11.5px] text-ink-4 px-1 py-1">
          This folder holds more files than the list can show, so some are missing here.
        </p>
      )}
    </div>
  );
}

function FolderCard({ folder, expanded, onToggle, onRequestRemove, filesState }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-card-row">
      <div className="group grid items-center gap-1 px-1 py-1 grid-cols-[14px_14px_minmax(0,1fr)_auto]">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} files in ${folder.name}`}
          disabled={!folder.available}
          onClick={onToggle}
          className="inline-flex items-center justify-center bg-transparent border-0 p-0 text-ink-4 cursor-pointer disabled:cursor-default disabled:opacity-40"
        >
          <span className={clsx('inline-flex transition-transform', expanded && 'rotate-90')}>
            {Ico.chevronRight(12)}
          </span>
        </button>
        <span className="text-ink-4 inline-flex flex-none">{Ico.folder(13)}</span>
        <span className="min-w-0" title={folder.path}>
          <span className="block truncate text-sm text-ink">{folder.name || folder.path}</span>
          {!folder.available && (
            <span className="block text-[11px] text-ink-4">Folder not available</span>
          )}
        </span>
        <Tooltip content="Remove from this chat">
          <button
            type="button"
            aria-label={`Remove ${folder.name || folder.path} from this chat`}
            onClick={() => onRequestRemove(folder)}
            className={clsx(
              'inline-flex items-center justify-center rounded bg-transparent border-0 p-0 cursor-pointer',
              'text-ink-4 hover:text-danger opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity',
            )}
          >
            {Ico.trash(13)}
          </button>
        </Tooltip>
      </div>
      {expanded && folder.available && (
        <div className="pl-6">
          <FolderFiles state={filesState} />
        </div>
      )}
    </div>
  );
}

export function ChatFoldersSection({ conversationId, refreshKey = 0 }) {
  const [folders, setFolders] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [filesByFolder, setFilesByFolder] = useState({});
  const [pendingRemove, setPendingRemove] = useState(null);
  // Every load claims a ticket; a response applies only while its ticket is
  // the latest, so a slow read never paints over a newer one.
  const listTicket = useRef(0);
  const fileTickets = useRef({});
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const reload = useCallback(() => {
    const ticket = ++listTicket.current;
    return listConversationFolders(conversationId)
      .then((data) => {
        if (ticket !== listTicket.current) return;
        setFolders(Array.isArray(data?.folders) ? data.folders : []);
        setLoadError('');
      })
      .catch((err) => {
        if (ticket !== listTicket.current) return;
        setFolders([]);
        setLoadError(err?.message || 'Could not load working folders.');
      });
  }, [conversationId]);

  /*
    `loadFiles` with `quiet` keeps the rows on screen while it refreshes, for
    the turn-driven refreshes below; a first expand shows the loading line.
  */
  const loadFiles = useCallback((folderId, { quiet = false } = {}) => {
    const ticket = (fileTickets.current[folderId] || 0) + 1;
    fileTickets.current[folderId] = ticket;
    if (!quiet) {
      setFilesByFolder((prev) => ({ ...prev, [folderId]: { loading: true, files: [] } }));
    }
    listConversationFolderFiles(conversationId, folderId)
      .then((data) => {
        if (fileTickets.current[folderId] !== ticket) return;
        setFilesByFolder((prev) => ({
          ...prev,
          [folderId]: { loading: false, files: visibleFiles(data?.files), truncated: data?.truncated === true },
        }));
      })
      .catch((err) => {
        if (fileTickets.current[folderId] !== ticket) return;
        setFilesByFolder((prev) => ({
          ...prev,
          [folderId]: { loading: false, files: [], error: err?.message || 'Could not list this folder.' },
        }));
      });
  }, [conversationId]);

  // `refreshKey` moves as each turn starts and ends, while the agent may be
  // writing into these folders: re-list in place, never collapse or clear.
  useEffect(() => {
    reload();
    Object.keys(expandedRef.current)
      .filter((id) => expandedRef.current[id])
      .forEach((id) => loadFiles(id, { quiet: true }));
    return () => { listTicket.current += 1; };
  }, [reload, loadFiles, refreshKey]);

  const toggle = (folder) => {
    const next = !expanded[folder.id];
    setExpanded((prev) => ({ ...prev, [folder.id]: next }));
    if (next) loadFiles(folder.id);
  };

  const addFolder = async () => {
    setActionError('');
    let picked;
    try {
      picked = await host.pickCodeFolder();
    } catch (e) {
      setActionError(e?.message || 'Could not open the folder picker.');
      return;
    }
    if (picked?.cancelled) return;
    if (!picked?.ok || !picked.path) {
      setActionError(picked?.reason || 'Could not open the folder picker.');
      return;
    }
    setAdding(true);
    try {
      await addConversationFolder(conversationId, picked.path);
      await reload();
    } catch (e) {
      setActionError(e?.message || 'Could not add this folder.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-1 mb-1">
        <span className="font-display text-[10.5px] font-semibold uppercase tracking-widest text-ink-4">
          Working folders{folders.length > 1 ? ` · ${folders.length}` : ''}
        </span>
        <Tooltip content="Add a folder to this chat">
          <button
            type="button"
            aria-label="Add a folder to this chat"
            title={adding ? 'Adding…' : undefined}
            disabled={adding}
            onClick={addFolder}
            className={clsx(
              'inline-flex items-center justify-center h-5 w-5 rounded',
              'text-ink-4 hover:text-ink hover:bg-surface-2',
              'transition-colors bg-transparent border-0 cursor-pointer',
              'disabled:opacity-50 disabled:cursor-wait',
            )}
          >
            {Ico.plus(13)}
          </button>
        </Tooltip>
      </div>
      {actionError && <p className="text-xs px-1 pb-0.5 text-danger">{actionError}</p>}
      {loadError && <p className="text-xs px-1 pb-0.5 text-danger">{loadError}</p>}
      {!loadError && folders.length === 0 && !adding && (
        <button
          type="button"
          onClick={addFolder}
          className={clsx(
            'flex items-center gap-2 px-1 py-1 rounded-card-row',
            'text-[12px] text-ink-4 hover:text-ink hover:bg-surface-2',
            'cursor-pointer bg-transparent border-0 text-left',
          )}
        >
          <span className="text-ink-4 inline-flex flex-none">{Ico.folder(13)}</span>
          <span>Add a folder for the agent to work in.</span>
        </button>
      )}
      {folders.map((folder) => (
        <FolderCard
          key={folder.id}
          folder={folder}
          expanded={!!expanded[folder.id]}
          onToggle={() => toggle(folder)}
          onRequestRemove={setPendingRemove}
          filesState={filesByFolder[folder.id]}
        />
      ))}
      <ConfirmModal
        open={!!pendingRemove}
        title={`Remove "${pendingRemove?.name || 'folder'}" from this chat?`}
        message="The agent will no longer work in this folder. The folder and its files stay on your computer."
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        onClose={() => setPendingRemove(null)}
        onConfirm={async () => {
          const target = pendingRemove;
          setPendingRemove(null);
          if (!target) return;
          setActionError('');
          try {
            await removeConversationFolder(conversationId, target.id);
          } catch (e) {
            setActionError(e?.message || 'Could not remove this folder.');
          }
          await reload();
        }}
      />
    </div>
  );
}
