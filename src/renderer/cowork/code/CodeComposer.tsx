import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { Textarea } from '../components/ui/Input';
import { codingApi, type CodingSession, type EngineCommand, type InputReference } from './api';
import { MentionMenu, PromptQueue, SlashMenu } from './ComposerMenus';
import { isActiveStatus } from './presentation';
import { mergeReferences, PromptReferenceChips, referencesFromFiles } from './PromptReferences';


export function CodeComposer({
  session,
  busy,
  onSend,
  onStop,
  commands,
  onClientCommand,
  onRemoveQueued,
  history = [],
}: {
  session: CodingSession;
  busy: boolean;
  onSend: (prompt: string, delivery: 'turn' | 'steer' | 'queue', attachments: InputReference[]) => Promise<void>;
  onStop: () => Promise<void>;
  commands: EngineCommand[];
  onClientCommand: (command: EngineCommand) => void;
  onRemoveQueued: (instructionId: string) => Promise<void>;
  history?: string[];
}) {
  const [prompt, setPrompt] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [activeDelivery, setActiveDelivery] = useState<'steer' | 'queue'>('steer');
  const [attachments, setAttachments] = useState<InputReference[]>([]);
  const [mentionResults, setMentionResults] = useState<InputReference[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [referenceError, setReferenceError] = useState('');
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyDraftRef = useRef('');
  const active = isActiveStatus(session.status);
  const commandQuery = /^\/([^\s]*)$/.exec(prompt)?.[1]?.toLowerCase();
  const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(prompt);
  const mentionQuery = mentionMatch?.[1] ?? null;
  const visibleCommands = useMemo(
    () => commandQuery == null ? [] : commands.filter((command) => command.name.includes(commandQuery)).slice(0, 8),
    [commandQuery, commands],
  );
  useEffect(() => setCommandIndex(0), [commandQuery]);
  useEffect(() => {
    setMentionIndex(0);
    if (mentionQuery == null) {
      setMentionResults([]);
      return undefined;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      codingApi.workspaceFiles(session.id, mentionQuery)
        .then(({ items }) => { if (alive) setMentionResults(items); })
        .catch(() => { if (alive) setMentionResults([]); });
    }, 100);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [mentionQuery, session.id]);

  const chooseCommand = async (command: EngineCommand) => {
    if (command.argument_hint) {
      setPrompt(`/${command.name} `);
      return;
    }
    if (command.action === 'client') {
      setPrompt('');
      onClientCommand(command);
      return;
    }
    const commandPrompt = `/${command.name}`;
    setPrompt('');
    try {
      await onSend(commandPrompt, active ? activeDelivery : 'turn', []);
    } catch {
      setPrompt(commandPrompt);
    }
  };
  const chooseMention = (reference: InputReference) => {
    const at = prompt.lastIndexOf('@');
    setPrompt(`${prompt.slice(0, at)}@${reference.name} `);
    setAttachments((current) => mergeReferences(current, [reference]));
    setMentionResults([]);
  };
  const attachFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const result = referencesFromFiles(files);
    setReferenceError(result.error);
    if (!result.error) setAttachments((current) => mergeReferences(current, result.items));
  };
  const submit = async () => {
    const value = prompt.trim();
    if (!value || busy) return;
    const submittedAttachments = attachments;
    setPrompt('');
    setHistoryIndex(null);
    setAttachments([]);
    try {
      await onSend(value, active ? activeDelivery : 'turn', submittedAttachments);
    } catch {
      setPrompt(value);
      setAttachments(submittedAttachments);
    }
  };
  return (
    <div className="code-composer">
      <PromptQueue items={session.queued_instructions || []} busy={busy} onRemove={onRemoveQueued} />
      <div
        className={`code-composer__shell${draggingFiles ? ' is-dragging-files' : ''}`}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDraggingFiles(true);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFiles(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingFiles(false);
          attachFiles(event.dataTransfer.files);
        }}
      >
        {draggingFiles && <div className="code-drop-hint">Drop files to attach</div>}
        <SlashMenu commands={visibleCommands} selectedIndex={commandIndex} onChoose={chooseCommand} />
        {commandQuery == null && mentionQuery != null && (
          <MentionMenu items={mentionResults} selectedIndex={mentionIndex} onChoose={chooseMention} />
        )}
        <PromptReferenceChips
          items={attachments}
          busy={busy}
          onRemove={(path) => setAttachments((current) => current.filter((item) => item.path !== path))}
        />
        <Textarea
          value={prompt}
          onChange={(value: string) => { setPrompt(value); setHistoryIndex(null); }}
          rows={2}
          placeholder={active ? 'Guide the agent while it works…' : session.status === 'failed' ? 'Retry with more context…' : 'Ask for another change…'}
          aria-label="Follow-up instruction"
          disabled={busy}
          onPaste={(event: React.ClipboardEvent<HTMLTextAreaElement>) => {
            if (!event.clipboardData.files.length) return;
            event.preventDefault();
            attachFiles(event.clipboardData.files);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (mentionResults.length > 0 && mentionQuery != null && event.key === 'ArrowDown') {
              event.preventDefault();
              setMentionIndex((value) => (value + 1) % mentionResults.length);
              return;
            }
            if (mentionResults.length > 0 && mentionQuery != null && event.key === 'ArrowUp') {
              event.preventDefault();
              setMentionIndex((value) => (value - 1 + mentionResults.length) % mentionResults.length);
              return;
            }
            if (mentionResults.length > 0 && mentionQuery != null && event.key === 'Escape') {
              event.preventDefault();
              setMentionResults([]);
              return;
            }
            if (visibleCommands.length > 0 && event.key === 'ArrowDown') {
              event.preventDefault();
              setCommandIndex((value) => (value + 1) % visibleCommands.length);
              return;
            }
            if (visibleCommands.length > 0 && event.key === 'ArrowUp') {
              event.preventDefault();
              setCommandIndex((value) => (value - 1 + visibleCommands.length) % visibleCommands.length);
              return;
            }
            if (visibleCommands.length > 0 && event.key === 'Escape') {
              event.preventDefault();
              setPrompt('');
              return;
            }
            if (commandQuery == null && mentionQuery == null && history.length > 0 && event.key === 'ArrowUp') {
              event.preventDefault();
              const next = historyIndex == null ? 0 : Math.min(history.length - 1, historyIndex + 1);
              if (historyIndex == null) historyDraftRef.current = prompt;
              setHistoryIndex(next);
              setPrompt(history[next]);
              return;
            }
            if (commandQuery == null && mentionQuery == null && historyIndex != null && event.key === 'ArrowDown') {
              event.preventDefault();
              const next = historyIndex - 1;
              if (next < 0) {
                setHistoryIndex(null);
                setPrompt(historyDraftRef.current);
              } else {
                setHistoryIndex(next);
                setPrompt(history[next]);
              }
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (mentionQuery != null && mentionResults[mentionIndex]) {
                chooseMention(mentionResults[mentionIndex]);
                return;
              }
              if (visibleCommands[commandIndex]) {
                void chooseCommand(visibleCommands[commandIndex]);
                return;
              }
              void submit();
            }
          }}
        />
        {referenceError && <div className="code-reference-error" role="alert">{referenceError}</div>}
        <div className="code-composer__actions">
          <input
            ref={fileInputRef}
            className="code-file-input"
            type="file"
            multiple
            tabIndex={-1}
            onChange={(event) => {
              attachFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <Button icon variant="subtle" size="sm" disabled={busy} onClick={() => fileInputRef.current?.click()} aria-label="Attach files or images">
            {Ico.attach(13)}
          </Button>
          <span className="code-composer__mode">
            <span className={`code-status-dot is-${session.permission_mode === 'workspace' || session.permission_mode === 'full_access' ? 'accent' : 'neutral'}`} aria-hidden="true" />
            {{ read_only: 'Read only', supervised: 'Ask first', workspace: 'Workspace auto', full_access: 'Full access' }[session.permission_mode]}
          </span>
          {active && (
            <div className="code-delivery-mode" aria-label="Instruction timing">
              <button
                type="button"
                className={activeDelivery === 'steer' ? 'is-selected' : ''}
                aria-pressed={activeDelivery === 'steer'}
                onClick={() => setActiveDelivery('steer')}
              >Guide now</button>
              <button
                type="button"
                className={activeDelivery === 'queue' ? 'is-selected' : ''}
                aria-pressed={activeDelivery === 'queue'}
                onClick={() => setActiveDelivery('queue')}
              >Queue next</button>
            </div>
          )}
          <span className="code-composer__actions-spacer" aria-hidden="true" />
          <span className="code-composer__hint">Enter to send · ↑↓ history · Shift+Enter for a new line</span>
          {active && (
            <Button icon variant="subtle" size="sm" disabled={busy} onClick={() => void onStop()} aria-label="Stop coding agent">
              {Ico.stop(12)}
            </Button>
          )}
          <Button icon variant="primary" size="sm" disabled={busy || !prompt.trim()} onClick={() => void submit()} aria-label={active ? activeDelivery === 'queue' ? 'Queue instruction' : 'Send guidance' : 'Send follow-up'}>
            {Ico.send(13)}
          </Button>
        </div>
      </div>
    </div>
  );
}
