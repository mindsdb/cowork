import Ico from '../components/Icons';
import ModelSelect from '../components/ModelSelect';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import Spinner from '../components/ui/Spinner';
import { Textarea } from '../components/ui/Input';
import type { ModelPickerMeta, ModelPickerSource } from '../lib/modelPickerOptions';
import type { CreateCodeTaskInput } from './api';
import { PromptReferenceChips } from './PromptReferences';
import { useNewTaskDraft } from './useNewTaskDraft';

const PERMISSIONS = [
  {
    value: 'read_only',
    label: 'Read only',
    title: 'Inspect and explain without changing files.',
  },
  {
    value: 'supervised',
    label: 'Ask first',
    title: 'Pause before commands that need your approval.',
  },
  {
    value: 'workspace',
    label: 'Workspace auto',
    title: 'Work autonomously inside the isolated task workspace.',
  },
  {
    value: 'full_access',
    label: 'Full access',
    title: 'Work autonomously without filesystem restrictions.',
  },
];

export function NewTaskPanel({
  busy,
  error,
  defaultEngineId,
  defaultModel,
  models,
  modelMeta,
  onCreate,
}: {
  busy: boolean;
  error: string;
  defaultEngineId: string;
  defaultModel: string;
  models: ModelPickerSource[];
  modelMeta: ModelPickerMeta;
  onCreate: (args: CreateCodeTaskInput) => Promise<void>;
}) {
  const draft = useNewTaskDraft({ busy, defaultEngineId, defaultModel, models, modelMeta, onCreate });
  const {
    path, prompt, setPrompt, inspection, checking, catalogError, inspectionError,
    engineId, setEngineId, model, setModel, engineLoading, permissionMode, setPermissionMode,
    startGuidance, setStartGuidance, attachments, setAttachments, draggingFiles, setDraggingFiles,
    fileInputRef, promptRef, modelOptions, refreshModels,
    availableEngines, pickFolder, attachFiles, directFolder, taskReady,
    startUnavailable, readinessMessage, readinessKind, handleStart,
  } = draft;
  const readinessText = startGuidance || readinessMessage;
  const readinessIcon = readinessKind === 'loading'
    ? <Spinner className="text-xs" />
    : readinessKind === 'ready'
      ? Ico.check(12)
      : readinessKind === 'prompt'
        ? Ico.edit(12)
        : readinessKind === 'folder'
          ? Ico.folder(12)
          : Ico.lock(12);

  return (
    <main className="code-new-task">
      <div className="code-new-task__content">
        <div className="code-new-task__intro">
          <div className="code-new-task__heading">
            <span className="code-new-task__mark" aria-hidden="true">{Ico.code(18)}</span>
            <h1>What should the agent change?</h1>
          </div>
          <p>Give the agent an outcome, a local folder, and anything it should verify.</p>
        </div>

        <section
          className={`code-start-composer${draggingFiles ? ' is-dragging-files' : ''}`}
          aria-label="Create coding task"
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
          <Textarea
            ref={promptRef}
            value={prompt}
            onChange={(value) => {
              setPrompt(value);
              if (startGuidance) setStartGuidance('');
            }}
            rows={6}
            placeholder="Describe the change, important constraints, and how you want it verified…"
            aria-label="Coding task"
            disabled={busy}
            autoFocus
            aria-keyshortcuts="Meta+Enter Control+Enter"
            onPaste={(event: React.ClipboardEvent<HTMLTextAreaElement>) => {
              if (!event.clipboardData.files.length) return;
              event.preventDefault();
              attachFiles(event.clipboardData.files);
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
              event.preventDefault();
              void handleStart();
            }}
          />

          <PromptReferenceChips
            items={attachments}
            busy={busy}
            onRemove={(attachmentPath) => setAttachments((current) => current.filter((item) => item.path !== attachmentPath))}
          />

          <div className="code-start-composer__controls">
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
            <Button
              icon
              variant="subtle"
              size="sm"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach files or images"
            >
              {Ico.attach(14)}
            </Button>
            <button
              type="button"
              className="meta-pill code-context-control code-context-control--folder"
              onClick={pickFolder}
              disabled={busy}
              aria-label={path ? `Change folder, currently ${path}` : 'Choose folder'}
              title={path || 'Choose a local folder'}
            >
              <span className="code-context-control__icon">{Ico.folder(14)}</span>
              <span className="code-context-control__value">{path ? path.split(/[\\/]/).filter(Boolean).at(-1) : 'Choose folder'}</span>
              <span className="code-context-control__chevron">{Ico.chevDown(11)}</span>
            </button>
            <span className="code-start-composer__spacer" />
            <ModelSelect
              value={model}
              onValueChange={setModel}
              options={modelOptions}
              onOpenChange={refreshModels}
              variant="unstyled"
              className="meta-pill code-model-picker"
              ariaLabel="Choose model"
              placeholder="Select model"
              emptyText="No coding models available"
              disabled={busy || modelOptions.length === 0}
            />
            <Button
              variant="primary"
              size="lg"
              className="code-start-task-button"
              disabled={startUnavailable}
              onClick={() => void handleStart()}
              aria-describedby={readinessText ? 'code-start-readiness' : undefined}
            >
              {busy ? <Spinner className="text-sm" /> : Ico.send(14)}
              {busy ? 'Starting…' : 'Start task'}
            </Button>
          </div>
          <div className="code-start-composer__context">
            <Select
              value={engineId}
              onValueChange={setEngineId}
              options={availableEngines}
              variant="pill"
              size="sm"
              label="Agent"
              ariaLabel="Coding agent"
              disabled={busy || engineLoading || availableEngines.length === 0}
              loading={engineLoading}
              minWidth={126}
              className="code-agent-picker"
            />
            <Select
              value={permissionMode}
              onValueChange={(value) => {
                if (value === 'read_only' || value === 'supervised' || value === 'workspace' || value === 'full_access') setPermissionMode(value);
              }}
              options={PERMISSIONS}
              variant="pill"
              size="sm"
              label="Permissions"
              ariaLabel="Coding permissions"
              disabled={busy}
              minWidth={144}
            />
            {readinessText && (
              <div
                id="code-start-readiness"
                className={`code-start-readiness${taskReady ? ' is-ready' : ''}${startGuidance ? ' is-attention' : ''}`}
                role="status"
                aria-live="polite"
              >
                <span className="code-start-readiness__icon" aria-hidden="true">{readinessIcon}</span>
                <span>{readinessText}</span>
              </div>
            )}
          </div>

          {(checking || inspection?.is_git) && (
            <div className="code-repository-state">
              {checking ? (
                <><Spinner className="text-xs" /><span>Checking folder…</span></>
              ) : (
                <>
                  <span className="code-repository-state__ok">{Ico.check(12)}</span>
                  <span>{inspection?.branch || 'Detached HEAD'}</span>
                  {inspection?.revision && <code>{inspection.revision.slice(0, 8)}</code>}
                  <span className="code-repository-state__isolation">isolated worktree</span>
                </>
              )}
            </div>
          )}
        </section>

        {inspection?.warning && !directFolder && (
          <Alert variant="warning" title="Local changes stay in the source folder">{inspection.warning}</Alert>
        )}
        {(error || inspectionError || catalogError) && <Alert variant="danger">{error || inspectionError || catalogError}</Alert>}

      </div>
    </main>
  );
}
