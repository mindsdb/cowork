import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import type { EngineCommand, InputReference, QueuedInstruction } from './api';
import { MoreNotices } from './ComposerLip';
import { useTranslation } from '../../lib/i18n';


export function PromptQueue({
  items,
  active,
  busy,
  onSteer,
  onRemove,
  more = 0,
  onShowMore = () => {},
}: {
  items: QueuedInstruction[];
  active: boolean;
  busy: boolean;
  onSteer: (instructionId: string) => Promise<void>;
  onRemove: (instructionId: string) => Promise<void>;
  /** Notices waiting behind the queue, which holds the composer lip's place. */
  more?: number;
  onShowMore?: () => void;
}) {
  const { t } = useTranslation('code');
  if (items.length === 0) return null;
  return (
    <div className="code-prompt-queue" aria-label={t('promptQueue.ariaLabel')}>
      {items.map((instruction, index) => (
        <div className="code-prompt-queue__item" key={instruction.id}>
          <span className="code-prompt-queue__icon" aria-hidden="true">{Ico.arrowUpLeft(12)}</span>
          <p title={instruction.prompt}>{instruction.prompt}</p>
          <small>{t('promptQueue.queued', { count: instruction.attachments?.length ?? 0 })}</small>
          <div className="code-prompt-queue__actions">
            {active && (
              <Button
                variant="subtle"
                size="xs"
                disabled={busy}
                aria-label={t('promptQueue.steerAriaLabel', { position: index + 1 })}
                onClick={() => void onSteer(instruction.id)}
              >
                {Ico.arrowUpLeft(12)} {t('promptQueue.steer')}
              </Button>
            )}
            <Button
              icon
              variant="subtle"
              size="xs"
              disabled={busy}
              aria-label={t('promptQueue.removeAriaLabel', { position: index + 1 })}
              onClick={() => void onRemove(instruction.id)}
            >
              {Ico.trash(12)}
            </Button>
          </div>
        </div>
      ))}
      {more > 0 && <span className="code-prompt-queue__more"><MoreNotices count={more} onShow={onShowMore} /></span>}
    </div>
  );
}


export function SlashMenu({
  commands,
  selectedIndex,
  onChoose,
}: {
  commands: EngineCommand[];
  selectedIndex: number;
  onChoose: (command: EngineCommand) => void;
}) {
  const { t } = useTranslation('code');
  if (commands.length === 0) return null;
  return (
    <div className="code-slash-menu" role="listbox" aria-label={t('slashMenu.ariaLabel')}>
      <div className="code-slash-menu__label section-label">{t('slashMenu.label')}</div>
      {commands.map((command, index) => (
        <button
          key={command.name}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          className={index === selectedIndex ? 'is-selected' : ''}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(command)}
        >
          <code>/{command.name}</code>
          <span>
            <strong>{command.label}</strong>
            <small>{command.description}</small>
          </span>
          {command.argument_hint && <em>{command.argument_hint}</em>}
        </button>
      ))}
    </div>
  );
}


export function MentionMenu({
  items,
  selectedIndex,
  onChoose,
}: {
  items: InputReference[];
  selectedIndex: number;
  onChoose: (reference: InputReference) => void;
}) {
  const { t } = useTranslation('code');
  if (items.length === 0) return null;
  return (
    <div className="code-slash-menu code-mention-menu" role="listbox" aria-label={t('mentionMenu.ariaLabel')}>
      <div className="code-slash-menu__label section-label">{t('mentionMenu.label')}</div>
      {items.slice(0, 8).map((reference, index) => (
        <button
          key={reference.path}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          className={index === selectedIndex ? 'is-selected' : ''}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(reference)}
        >
          <code>@</code>
          <span><strong>{reference.name}</strong><small>{reference.path}</small></span>
        </button>
      ))}
    </div>
  );
}
