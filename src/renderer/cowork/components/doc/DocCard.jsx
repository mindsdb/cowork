// DocCard — a doc in the chat transcript. Opens the doc beside the chat.
import { FileText } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { ActionBar, Card } from '../ui';
import { useArtifactLiveness } from '../../lib/artifactsStore';

export default function DocCard({ artifact, onOpen, live = false, active = false }) {
  const deleted = useArtifactLiveness(artifact, { live });
  const open = () => { if (!deleted) onOpen?.(artifact); };
  return (
    <Card
      as="div"
      interactive={!deleted}
      flat
      padding="none"
      onActivate={deleted ? undefined : open}
      aria-label={deleted ? `Deleted doc: ${artifact.title}` : `Open doc: ${artifact.title}`}
      className="railed chat-artifact-card"
      data-active={active || undefined}
    >
      <div className="chat-artifact-card__tile grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent-bg text-accent">
        <Icon of={FileText} size={16} />
      </div>
      <div className="chat-artifact-card__text flex min-w-0 flex-col gap-0.5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); open(); }}
          disabled={deleted}
          className="m-0 block min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-body text-base font-semibold text-ink underline-offset-[3px] enabled:hover:underline disabled:cursor-not-allowed disabled:opacity-70"
        >{artifact.title}</button>
        <span className="font-body text-xs text-ink-3">{deleted ? 'Doc · deleted' : active ? 'Doc · open beside the chat' : 'Doc'}</span>
      </div>
      <div
        className="chat-artifact-card__actions"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
      >
        {!deleted && <ActionBar size="sm" align="start" primary={{ label: active ? 'Showing' : 'Open', onClick: open, disabled: active }} />}
      </div>
    </Card>
  );
}
