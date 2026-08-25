import { memo, useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { Textarea } from '../components/ui/Input';
import { codingApi, type CodingSession, type EngineCommand, type InputReference, type PermissionMode, type SkillLibraryItem } from './api';
import { CodeCommandPalette, useCodePaletteItems, type CodePaletteItem } from './CodeCommandPalette';
import { MentionMenu, PromptQueue } from './ComposerMenus';
import { PermissionSelect } from './PermissionSelect';
import { isActiveStatus } from './presentation';
import { mergeReferences, PromptReferenceChips, referencesFromFiles } from './PromptReferences';
import { SkillDetailModal } from './SkillDetailModal';


type CodeComposerProps = {
  session: CodingSession;
  busy: boolean;
  onSend: (prompt: string, delivery: 'turn' | 'steer' | 'queue', attachments: InputReference[]) => Promise<void>;
  onStop: () => Promise<void>;
  commands: EngineCommand[];
  onClientCommand: (command: EngineCommand) => void;
  onPermissionChange: (permission: PermissionMode) => Promise<void>;
  onSteerQueued: (instructionId: string) => Promise<void>;
  onRemoveQueued: (instructionId: string) => Promise<void>;
  history?: string[];
};

function sameStrings(left: string[] = [], right: string[] = []): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameReferences(left: InputReference[] = [], right: InputReference[] = []): boolean {
  return left.length === right.length && left.every((item, index) => (
    item.name === right[index]?.name
    && item.path === right[index]?.path
    && item.kind === right[index]?.kind
  ));
}

function sameQueuedInstructions(left: CodingSession, right: CodingSession): boolean {
  const leftItems = left.queued_instructions || [];
  const rightItems = right.queued_instructions || [];
  return leftItems.length === rightItems.length && leftItems.every((item, index) => {
    const other = rightItems[index];
    return item.id === other?.id
      && item.prompt === other.prompt
      && item.created_at === other.created_at
      && sameReferences(item.attachments, other.attachments);
  });
}

function sameComposerProps(left: CodeComposerProps, right: CodeComposerProps): boolean {
  // CodeView recreates thin action closures as task data arrives, but those
  // closures are behaviorally identical until one of the session fields below
  // changes (and selecting another task remounts the composer by key). Ignoring
  // only those wrappers prevents transcript polling from interrupting input.
  return left.busy === right.busy
    && left.commands === right.commands
    && left.session.id === right.session.id
    && left.session.status === right.session.status
    && left.session.engine_id === right.session.engine_id
    && left.session.project_id === right.session.project_id
    && left.session.permission_mode === right.session.permission_mode
    && sameQueuedInstructions(left.session, right.session)
    && sameStrings(left.history, right.history);
}

export const CodeComposer = memo(function CodeComposer({
  session,
  busy,
  onSend,
  onStop,
  commands,
  onClientCommand,
  onPermissionChange,
  onSteerQueued,
  onRemoveQueued,
  history = [],
}: CodeComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [attachments, setAttachments] = useState<InputReference[]>([]);
  const [mentionResults, setMentionResults] = useState<InputReference[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [referenceError, setReferenceError] = useState('');
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [detailItem, setDetailItem] = useState<SkillLibraryItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyDraftRef = useRef('');
  const active = isActiveStatus(session.status);
  const hasDraft = !!prompt.trim();
  const commandQuery = /^\/([^\s]*)$/.exec(prompt)?.[1]?.toLowerCase() ?? null;
  const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(prompt);
  const mentionQuery = mentionMatch?.[1] ?? null;
  const paletteItems = useCodePaletteItems({ commands, query: commandQuery, projectId: session.project_id });
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
      await onSend(commandPrompt, active ? 'queue' : 'turn', []);
    } catch {
      setPrompt(commandPrompt);
    }
  };
  const choosePaletteItem = (item: CodePaletteItem) => {
    if (item.kind === 'skill') {
      setPrompt(`${item.invocation} `);
      return;
    }
    void chooseCommand(item.command);
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
      await onSend(value, active ? 'queue' : 'turn', submittedAttachments);
    } catch {
      setPrompt(value);
      setAttachments(submittedAttachments);
    }
  };
  return (
    <div className="code-composer">
      <PromptQueue
        items={session.queued_instructions || []}
        active={active}
        busy={busy}
        onSteer={onSteerQueued}
        onRemove={onRemoveQueued}
      />
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
        {commandQuery != null && (
          <CodeCommandPalette
            items={paletteItems}
            query={commandQuery}
            selectedIndex={commandIndex}
            agentLabel={session.engine_id === 'codex' ? 'Codex' : session.engine_id}
            onQueryChange={(query) => setPrompt(`/${query}`)}
            onSelectedIndexChange={setCommandIndex}
            onChoose={choosePaletteItem}
            onViewSkill={setDetailItem}
            onDismiss={() => setPrompt('')}
          />
        )}
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
          placeholder={active ? 'Message the agent…' : session.status === 'failed' ? 'Retry with more context…' : 'Ask for another change…'}
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
            if (paletteItems.length > 0 && event.key === 'ArrowDown') {
              event.preventDefault();
              setCommandIndex((value) => (value + 1) % paletteItems.length);
              return;
            }
            if (paletteItems.length > 0 && event.key === 'ArrowUp') {
              event.preventDefault();
              setCommandIndex((value) => (value - 1 + paletteItems.length) % paletteItems.length);
              return;
            }
            if (commandQuery != null && event.key === 'Escape') {
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
              if (paletteItems[commandIndex]) {
                choosePaletteItem(paletteItems[commandIndex]);
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
          <PermissionSelect
            value={session.permission_mode}
            onValueChange={(value) => void onPermissionChange(value)}
            disabled={busy}
          />
          <span className="code-composer__actions-spacer" aria-hidden="true" />
          <span className="code-composer__hint">{active ? 'Enter to queue · Shift+Enter for a new line' : 'Enter to send · ↑↓ history · Shift+Enter for a new line'}</span>
          {active && !hasDraft ? (
            <Button icon variant="primary" size="sm" disabled={busy} onClick={() => void onStop()} aria-label="Stop coding agent">
              {Ico.stop(12)}
            </Button>
          ) : (
            <Button icon variant="primary" size="sm" disabled={busy || !hasDraft} onClick={() => void submit()} aria-label={active ? 'Queue instruction' : 'Send follow-up'}>
              {Ico.send(13)}
            </Button>
          )}
        </div>
      </div>
      <SkillDetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}, sameComposerProps);
