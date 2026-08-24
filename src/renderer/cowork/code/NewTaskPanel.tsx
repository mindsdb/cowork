import { useEffect, useState } from 'react';
import Ico from '../components/Icons';
import ModelSelect from '../components/ModelSelect';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import Spinner from '../components/ui/Spinner';
import { Textarea } from '../components/ui/Input';
import type { ModelPickerMeta, ModelPickerSource } from '../lib/modelPickerOptions';
import { codingApi, type CodeProject, type CreateCodeTaskInput, type SourceContext } from './api';
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
const NO_CONNECTIONS: CodeProject['connections'] = [];
const NEW_PROJECT_VALUE = '__new_code_project__';

function providerLabel(provider: 'github' | 'linear' | 'slack'): string {
  if (provider === 'github') return 'GitHub';
  if (provider === 'linear') return 'Linear';
  return 'Slack';
}

export function NewTaskPanel({
  busy,
  error,
  defaultEngineId,
  defaultModel,
  models,
  modelMeta,
  projects = [],
  selectedProjectId = null,
  onProjectChange = () => {},
  onOpenProjectSettings = () => {},
  onCreate,
}: {
  busy: boolean;
  error: string;
  defaultEngineId: string;
  defaultModel: string;
  models: ModelPickerSource[];
  modelMeta: ModelPickerMeta;
  projects: CodeProject[];
  selectedProjectId: string | null;
  onProjectChange: (id: string | null) => void;
  onOpenProjectSettings: () => void;
  onCreate: (args: CreateCodeTaskInput) => Promise<void>;
}) {
  const draft = useNewTaskDraft({
    busy, defaultEngineId, defaultModel, models, modelMeta,
    projects, selectedProjectId, onProjectChange, onOpenProjectSettings, onCreate,
  });
  const {
    prompt, setPrompt, catalogError,
    engineId, setEngineId, model, setModel, engineLoading, permissionMode, setPermissionMode,
    startGuidance, setStartGuidance, attachments, setAttachments, draggingFiles, setDraggingFiles,
    fileInputRef, promptRef, modelOptions, refreshModels,
    availableEngines, attachFiles, selectedProject, sourceContexts, setSourceContexts, taskReady,
    startUnavailable, readinessMessage, readinessKind, handleStart,
  } = draft;
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkConnectionKey, setLinkConnectionKey] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const projectConnections = selectedProject?.connections || NO_CONNECTIONS;
  const linkedConnection = projectConnections.find((item) => `${item.provider}:${item.name}` === linkConnectionKey)
    || projectConnections[0];
  useEffect(() => {
    if (!projectConnections.some((item) => `${item.provider}:${item.name}` === linkConnectionKey)) {
      const first = projectConnections[0];
      setLinkConnectionKey(first ? `${first.provider}:${first.name}` : '');
    }
  }, [linkConnectionKey, projectConnections]);
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
          <p>Give the agent an outcome, choose a project, and say how you want it verified.</p>
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
          {sourceContexts.length > 0 && (
            <div className="code-source-contexts" aria-label="Linked work">
              {sourceContexts.map((item) => (
                <span key={`${item.provider}:${item.url}`}>
                  {providerLabel(item.provider)} · {item.title || item.external_id}
                  <button type="button" aria-label={`Remove ${item.title || item.external_id}`} onClick={() => setSourceContexts((current) => current.filter((context) => context.url !== item.url))}>{Ico.close(10)}</button>
                </span>
              ))}
            </div>
          )}

          {linkOpen && (
            <div className="code-source-linker">
              <Select
                value={linkConnectionKey}
                onValueChange={setLinkConnectionKey}
                options={projectConnections.map((connection) => ({
                  value: `${connection.provider}:${connection.name}`,
                  label: `${providerLabel(connection.provider)} · ${connection.label || connection.name}`,
                }))}
                size="sm"
                ariaLabel="Developer tool connection"
                disabled={linkBusy}
              />
              <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="Paste an issue, pull request, or conversation link" aria-label="Source link" disabled={linkBusy} />
              <Button size="sm" disabled={linkBusy || !linkUrl.trim() || !selectedProject || !linkedConnection} onClick={async () => {
                if (!selectedProject || !linkedConnection) return;
                setLinkBusy(true); setLinkError('');
                try {
                  const kind = linkedConnection.provider === 'github' && /\/pull\//.test(linkUrl) ? 'pull_request' : linkedConnection.provider === 'slack' ? 'conversation' : 'issue';
                  const context = await codingApi.readSourceContext(selectedProject.id, {
                    provider: linkedConnection.provider,
                    kind,
                    url: linkUrl.trim(),
                    connection_name: linkedConnection.name,
                  });
                  setSourceContexts((current: SourceContext[]) => [...current.filter((item) => item.url !== context.url), context]);
                  setLinkUrl(''); setLinkOpen(false);
                } catch (reason) {
                  setLinkError(reason instanceof Error ? reason.message : 'Could not load that link.');
                } finally { setLinkBusy(false); }
              }}>Link</Button>
              <button type="button" aria-label="Close link work" onClick={() => setLinkOpen(false)}>{Ico.close(12)}</button>
            </div>
          )}
          {linkError && <div className="code-source-linker__error" role="alert">{linkError}</div>}

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
            <Select
              value={selectedProjectId || ''}
              onValueChange={(value) => {
                if (value === NEW_PROJECT_VALUE) {
                  onProjectChange(null);
                  onOpenProjectSettings();
                  return;
                }
                onProjectChange(value || null);
              }}
              options={[
                ...projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                  title: `${project.folders.length} folder${project.folders.length === 1 ? '' : 's'}`,
                })),
                { value: NEW_PROJECT_VALUE, label: 'New Code Project…' },
              ]}
              variant="pill"
              size="sm"
              label="Project"
              ariaLabel="Code Project"
              placeholder="Choose project"
              disabled={busy}
              minWidth={150}
              className="code-project-picker"
            />
            <Button icon variant="subtle" size="sm" onClick={onOpenProjectSettings} disabled={busy} aria-label={selectedProject ? `Edit ${selectedProject.name}` : 'Create Code Project'}>
              {selectedProject ? Ico.settings(13) : Ico.plus(13)}
            </Button>
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
            {availableEngines.length > 1 && (
              <Select
                value={engineId}
                onValueChange={setEngineId}
                options={availableEngines}
                variant="pill"
                size="sm"
                label="Agent"
                ariaLabel="Coding agent"
                disabled={busy || engineLoading}
                loading={engineLoading}
                minWidth={126}
                className="code-agent-picker"
              />
            )}
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
            {selectedProject?.connections.length ? (
              <Button size="sm" variant="subtle" onClick={() => { setLinkOpen((current) => !current); setLinkError(''); }} disabled={busy}>
                {Ico.link(12)} Link work
              </Button>
            ) : null}
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

        </section>
        {(error || catalogError) && <Alert variant="danger">{error || catalogError}</Alert>}

      </div>
    </main>
  );
}
