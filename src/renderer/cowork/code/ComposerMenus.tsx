import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import type { EngineCommand, InputReference, QueuedInstruction } from './api';


export function PromptQueue({
  items,
  active,
  busy,
  onSteer,
  onRemove,
}: {
  items: QueuedInstruction[];
  active: boolean;
  busy: boolean;
  onSteer: (instructionId: string) => Promise<void>;
  onRemove: (instructionId: string) => Promise<void>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="code-prompt-queue" aria-label="Queued instructions">
      {items.map((instruction, index) => (
        <div className="code-prompt-queue__item" key={instruction.id}>
          <span className="code-prompt-queue__icon" aria-hidden="true">{Ico.arrowUpLeft(12)}</span>
          <p title={instruction.prompt}>{instruction.prompt}</p>
          <small>Queued{instruction.attachments?.length ? ` · ${instruction.attachments.length} file${instruction.attachments.length === 1 ? '' : 's'}` : ''}</small>
          <div className="code-prompt-queue__actions">
            {active && (
              <Button
                variant="subtle"
                size="xs"
                disabled={busy}
                aria-label={`Steer with queued instruction ${index + 1}`}
                onClick={() => void onSteer(instruction.id)}
              >
                {Ico.arrowUpLeft(11)} Steer
              </Button>
            )}
            <Button
              icon
              variant="subtle"
              size="xs"
              disabled={busy}
              aria-label={`Remove queued instruction ${index + 1}`}
              onClick={() => void onRemove(instruction.id)}
            >
              {Ico.trash(11)}
            </Button>
          </div>
        </div>
      ))}
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
  if (commands.length === 0) return null;
  return (
    <div className="code-slash-menu" role="listbox" aria-label="Code commands">
      <div className="code-slash-menu__label">Commands</div>
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
  if (items.length === 0) return null;
  return (
    <div className="code-slash-menu code-mention-menu" role="listbox" aria-label="Workspace files">
      <div className="code-slash-menu__label">Files and folders in this task</div>
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
