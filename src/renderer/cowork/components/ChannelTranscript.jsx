/* Read-only transcript of a channel conversation, for an org admin.

   Every row is untrusted: a person's row is their Discord or Slack message
   stored verbatim, and an answer may repeat it. So each row renders through
   MarkdownContent with charts and forms off (a chart block's config is
   evaluated as code), with no conversation, figures or image loader, and
   with loopback links neutralised. Steps, skill, artifact and question cards
   are left out on purpose: they carry write actions this view must not have.
   The only control is "Load earlier"; paging state belongs to the caller. */
import { MarkdownContent } from './markdown/MarkdownContent';

const SHOWN_ROLES = new Set(['user', 'assistant', 'error', 'provider_required']);

/** The text of a row's content: a string as is, or the text parts of a block list. */
function rowText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n\n');
}

/** A row's time for display, or '' when it has none. */
function rowTime(message) {
  const raw = message.created_at || message.createdAt;
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function RowBody({ message }) {
  if (message.role === 'provider_required') {
    return <p className="text-ink-3">This turn needed a model provider connection and did not run.</p>;
  }
  if (message.role === 'error') {
    return <p className="text-danger">{rowText(message.content) || 'This turn failed.'}</p>;
  }
  return (
    <MarkdownContent
      text={rowText(message.content)}
      complete
      enableCharts={false}
      enableForms={false}
      neutralizeLoopback
    />
  );
}

/**
 * @param {{
 *   messages: object[],
 *   hasMore?: boolean,
 *   loadingEarlier?: boolean,
 *   onLoadEarlier?: () => void,
 * }} props
 */
export default function ChannelTranscript({ messages, hasMore = false, loadingEarlier = false, onLoadEarlier }) {
  const rows = (messages || []).filter((m) => SHOWN_ROLES.has(m?.role));
  return (
    <div className="channel-transcript flex flex-col gap-4">
      {hasMore && (loadingEarlier ? (
        <p className="text-ink-3 text-sm">Loading earlier messages…</p>
      ) : onLoadEarlier ? (
        <button type="button" className="self-start text-sm text-accent bg-transparent border-0 cursor-pointer" onClick={onLoadEarlier}>
          Load earlier messages
        </button>
      ) : null)}
      {rows.map((message, index) => (
        <article key={message.id || `${message.role}-${index}`} className="channel-transcript-row">
          <header className="text-xs text-ink-3 mb-1">
            {message.role === 'user' ? 'Channel' : 'Agent'}
            {rowTime(message) ? ` · ${rowTime(message)}` : ''}
          </header>
          <RowBody message={message} />
        </article>
      ))}
      {rows.length === 0 && <p className="text-ink-3">No messages yet.</p>}
    </div>
  );
}
