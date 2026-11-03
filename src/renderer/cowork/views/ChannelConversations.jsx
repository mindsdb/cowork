/* Settings > Channels > Conversations, for org admins: the conversations the
   channel runtime created for routes, which have no owner and so no place in
   anyone's own list. A list on the left, the selected one read only on the
   right (ChannelTranscript), and Delete. ChannelsView owns the list request
   and only mounts this tab when the server answered it (not 403 or 404). */
import { useEffect, useState } from 'react';
import { ConfirmModal } from '../components/ConfirmModal';
import ChannelTranscript from '../components/ChannelTranscript';
import { Button } from '../components/ui';
import {
  deleteChannelConversation,
  fetchChannelConversation,
  fetchOlderChannelMessages,
} from '../api';

/** A list item's last-activity time for display, or '' when it has none. */
function activityLabel(item) {
  const raw = item.updatedAt || item.createdAt;
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/**
 * @param {{
 *   list: {state: 'ok'|'error', items: object[], error?: string},
 *   onReload: () => void,
 *   onChanged: () => void,
 * }} props
 */
export default function ChannelConversations({ list, onReload, onChanged }) {
  const [selectedId, setSelectedId] = useState(null);
  const [opened, setOpened] = useState({ status: 'idle' });
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    setLoadingEarlier(false);
    setOpened({ status: 'loading' });
    fetchChannelConversation(selectedId).then((result) => {
      if (cancelled) return;
      setOpened(result);
      if (result.status === 'not_found') onReload();
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  async function loadEarlier() {
    if (opened.status !== 'ok' || loadingEarlier) return;
    const { task } = opened;
    setLoadingEarlier(true);
    const page = await fetchOlderChannelMessages(task.id, task.messagesCursor);
    // A page that lands after another conversation was opened belongs to the
    // old one: drop it, or the pane would show one conversation while the
    // list and Delete act on another.
    setOpened((current) => {
      if (!page || current.status !== 'ok' || current.task.id !== task.id) return current;
      // The cursor guarantees no overlap with the loaded page, so prepend as App does.
      return {
        status: 'ok',
        task: {
          ...current.task,
          messages: [...page.messages, ...current.task.messages],
          hasMoreMessages: page.hasMoreMessages,
          messagesCursor: page.messagesCursor,
        },
      };
    });
    setLoadingEarlier(false);
  }

  async function confirmDelete() {
    if (opened.status !== 'ok') return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // The conversation on screen, which is what the person confirmed.
      await deleteChannelConversation(opened.task.id);
      setConfirmOpen(false);
      setSelectedId(null);
      setOpened({ status: 'idle' });
      onChanged();
    } catch (err) {
      setDeleteError(`Couldn't delete this conversation: ${err?.message || 'unknown error'}`);
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  if (list.state === 'error') {
    return (
      <div className="channels-pad">
        <p className="channels-muted">Couldn't load channel conversations. {list.error}</p>
        <Button variant="subtle" onClick={onReload}>Retry</Button>
      </div>
    );
  }

  return (
    <main className="channels-body">
      <nav className="channels-list scroll-clean" aria-label="Channel conversations">
        {list.items.length === 0 && <p className="channels-muted channels-pad">No channel conversations yet.</p>}
        {list.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`channels-list-item${item.id === selectedId ? ' is-active' : ''}`}
            aria-current={item.id === selectedId || undefined}
            onClick={() => { setDeleteError(null); setSelectedId(item.id); }}
          >
            <span className="channels-list-name">
              {item.title}
              <code className="channels-type">{item.channelType}</code>
              <span className="channels-muted">{activityLabel(item)}</span>
            </span>
          </button>
        ))}
      </nav>
      <section className="channels-detail scroll-clean">
        {!selectedId && <p className="channels-muted channels-pad">Pick a conversation to read it.</p>}
        {selectedId && opened.status === 'loading' && <p className="channels-muted channels-pad">Loading…</p>}
        {selectedId && opened.status === 'not_found' && (
          <p className="channels-muted channels-pad">This conversation was deleted.</p>
        )}
        {selectedId && opened.status === 'unavailable' && (
          <p className="channels-muted channels-pad">Couldn't load this conversation. Try again in a moment.</p>
        )}
        {selectedId && opened.status === 'ok' && (
          <>
            <div className="flex items-center justify-between channels-pad">
              <span className="text-ink-3 text-sm">Read only · {opened.task.channelType}</span>
              <Button variant="subtle" onClick={() => setConfirmOpen(true)} aria-label="Delete conversation">
                Delete
              </Button>
            </div>
            {deleteError && <p className="text-danger channels-pad">{deleteError}</p>}
            <div className="channels-pad">
              <ChannelTranscript
                messages={opened.task.messages}
                hasMore={opened.task.hasMoreMessages}
                loadingEarlier={loadingEarlier}
                onLoadEarlier={loadEarlier}
              />
            </div>
          </>
        )}
      </section>
      <ConfirmModal
        open={confirmOpen}
        title="Delete this channel conversation?"
        message="Its messages are removed for everyone. The route stays, and its next message starts a new conversation."
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => setConfirmOpen(false)}
      />
    </main>
  );
}
