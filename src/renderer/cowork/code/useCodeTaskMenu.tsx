import { useState, type ReactNode } from 'react';

import { ConfirmModal } from '../components/ConfirmModal';
import Ico from '../components/Icons';
import type { MenuItem } from '../components/ui/Menu';
import type { CodingSession } from './api';
import { RenameTaskModal } from './RenameTaskModal';


/** The task-list mutations Code's workspace owns (useCodeWorkspace). */
export interface CodeTaskListActions {
  onSetPinned: (id: string, pinned: boolean) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onSetArchived: (id: string, archived: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}


export interface CodeTaskMenuActions {
  onTogglePinned: (session: CodingSession) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onSetArchived: (id: string, archived: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onError: (message: string | null) => void;
}


/**
 * The actions on a coding task as an item in a list: pin, rename, archive and
 * delete. The sidebar and All tasks rows share them, with one set of dialogs.
 */
export function useCodeTaskMenu({ onTogglePinned, onRename, onSetArchived, onDelete, onError }: CodeTaskMenuActions): {
  items: (session: CodingSession, options?: { pinBusy?: boolean }) => MenuItem[];
  dialogs: ReactNode;
} {
  const [renaming, setRenaming] = useState<CodingSession | null>(null);
  const [deleting, setDeleting] = useState<CodingSession | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleArchived = async (session: CodingSession) => {
    const archive = !session.archived;
    onError(null);
    try {
      await onSetArchived(session.id, archive);
    } catch {
      onError(`Couldn't ${archive ? 'archive' : 'restore'} this task.`);
    }
  };

  const items = (session: CodingSession, { pinBusy = false } = {}): MenuItem[] => {
    // A turn in flight owns the task's files and history.
    const idle = session.status !== 'running' && session.status !== 'awaiting_approval';
    const busyReason = idle ? undefined : 'Stop the active turn first.';
    return [
      {
        label: session.pinned ? 'Unpin' : 'Pin',
        icon: Ico.pin(14),
        disabled: pinBusy,
        onClick: () => onTogglePinned(session),
      },
      { label: 'Rename', icon: Ico.edit(14), onClick: () => setRenaming(session) },
      { divider: true },
      {
        label: session.archived ? 'Restore' : 'Archive',
        icon: Ico.folder(14),
        disabled: !idle,
        title: busyReason,
        onClick: () => void toggleArchived(session),
      },
      {
        label: 'Delete',
        icon: Ico.trash(14),
        danger: true,
        disabled: !idle,
        title: busyReason,
        onClick: () => setDeleting(session),
      },
    ];
  };

  const dialogs = (
    <>
      <RenameTaskModal
        open={!!renaming}
        title={renaming?.title || ''}
        busy={busy}
        onClose={() => { if (!busy) setRenaming(null); }}
        onRename={async (title) => {
          setBusy(true);
          try {
            await onRename(renaming!.id, title);
            setRenaming(null);
          } finally {
            setBusy(false);
          }
        }}
      />
      <ConfirmModal
        open={!!deleting}
        title="Delete this coding task?"
        message="This removes the task history and any isolated working copy. Your original files are left alone."
        confirmLabel="Delete task"
        destructive
        busy={busy}
        onClose={() => { if (!busy) setDeleting(null); }}
        onConfirm={async () => {
          setBusy(true);
          onError(null);
          try {
            await onDelete(deleting!.id);
          } catch {
            onError("Couldn't delete this task.");
          } finally {
            setDeleting(null);
            setBusy(false);
          }
        }}
      />
    </>
  );

  return { items, dialogs };
}
