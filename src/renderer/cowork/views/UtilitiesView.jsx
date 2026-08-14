import { useEffect, useMemo, useState } from 'react';
import Ico from '../components/Icons';
import { Alert, Button, Card, Field, EmptyState as UiEmptyState, Select, Input, Textarea } from '../components/ui';
import { PageHeader as CollectionPageHeader } from '../components/collection';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
import { copyText } from '../lib/clipboard';
import {
  deleteDatasource,
  deleteMemory,
  fetchDatasources,
  fetchMemory,
  fetchPublishable,
  findMemoryEntry,
  labelCategory,
  publishArtifact,
  saveDatasource,
  saveMemory,
  validateDatasource,
} from '../api';
import { trackArtifactPublished } from '../lib/analytics';

const TITLES = {
  memory:  ['Memories', 'Profile, rules, and lessons the agent can reuse across tasks.'],
  publish: ['Share', 'HTML artifacts the agent can share with Minds credentials.'],
};

function EmptyState({ children }) {
  return <div className="p-8 text-[var(--frost-600)] text-[13px]">{children}</div>;
}

function credentialTemplate(engineDef) {
  return Object.fromEntries(activeCredentialFields(engineDef).map((field) => [field.name, field.default || '']));
}

function activeAuthMethod(engineDef, authMethod) {
  const methods = engineDef?.authMethods || [];
  if (!methods.length) return null;
  return methods.find((method) => method.name === authMethod) || methods[0];
}

function activeCredentialFields(engineDef, authMethod) {
  const method = activeAuthMethod(engineDef, authMethod);
  return method?.fields || engineDef?.fields || [];
}

function fieldLabel(name) {
  return String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isLongField(field) {
  return /json|private_key|certificate|token_secret|session_configuration/i.test(field.name || '');
}

function shouldUseTextarea(field) {
  return isLongField(field) && !field.secret;
}

export default function UtilitiesView({ kind, project, onRefreshArtifacts }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setData(null);
    setSelected(null);
    setStatus('');
    // Memory listing is universal: Global plus every project on disk,
    // grouped in the sidebar. We don't pass project?.path here so the
    // page shows the full picture regardless of which project is
    // active in the rail.
    if (kind === 'memory')  fetchMemory().then(setData).catch((err) => setStatus(err.message));
    if (kind === 'publish') fetchPublishable().then(setData).catch((err) => setStatus(err.message));
  }, [kind, project?.path]);

  const [title, subtitle] = TITLES[kind] || ['Utility', ''];

  // Memory kind owns its own scrolling: the sidebar list and the
  // viewer pane each scroll independently so flipping through a long
  // file doesn't push the file list around. The legacy kinds keep
  // the original "page scrolls" behaviour.
  const isMemoryKind = kind === 'memory';
  const wrapperStyle = isMemoryKind
    ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
    : { flex: 1, overflowY: 'auto' };

  return (
    <div className="scroll-clean" style={wrapperStyle}>
      {/* MemoryView renders its own header. For the legacy kinds we
          keep the plain header here. */}
      {!isMemoryKind && <CollectionPageHeader title={title} subtitle={subtitle} />}
      {status && <Alert variant="danger" role="status" aria-live="polite" style={{ margin: '16px 28px 0', fontSize: 12.5 }}>{status}</Alert>}
      {!data ? <EmptyState>Loading…</EmptyState> : null}
      {data && kind === 'memory' && (
        <MemoryView
          data={data}
          selected={selected}
          onSelect={setSelected}
          project={project}
          setData={setData}
          setStatus={setStatus}
        />
      )}
      {/* The legacy 'connect' kind has been retired in favour of the
          Connect Apps and Data page. ConnectView is no longer
          rendered from here. */}
      {data && kind === 'publish' && <PublishView data={data} setData={setData} setStatus={setStatus} onRefreshArtifacts={onRefreshArtifacts} />}
    </div>
  );
}

function MemoryView({ data, selected, onSelect, project, setData, setStatus }) {
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  const projectSections = sections.filter((s) => s.scope === 'Project');
  const globalSection = sections.find((s) => s.scope === 'Global');
  const totalFiles = sections.reduce((acc, s) => acc + (s.files?.length || 0), 0);

  // `selected` holds the sidebar selection; after save `data.sections`
  // refreshes but `selected` can still point at stale content. Always
  // read the live entry from the latest sections when rendering.
  const displayed = useMemo(
    () => (selected?.path ? findMemoryEntry(sections, selected.path) : selected) || selected,
    [sections, selected],
  );

  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({
    scope: 'Global', category: '', content: '', projectName: null, projectId: null,
  });

  const refresh = async () => {
    const latest = await fetchMemory();
    setData(latest);
    if (selected?.path) {
      const updated = findMemoryEntry(latest?.sections, selected.path);
      if (updated) onSelect(updated);
    }
    return latest;
  };

  const startEdit = (file) => {
    setEditing('edit');
    setDraft({
      scope: file.scope || 'Global',
      category: file.category,
      content: file.content || file.preview || '',
      projectName: file.projectName || null,
      projectId: file.projectId || null,
    });
    onSelect(file);
  };

  const save = async () => {
    if (!draft.category) {
      setStatus('No memory category selected.');
      return;
    }
    if (draft.scope === 'Project' && !draft.projectId) {
      setStatus('Pick a project for this memory.');
      return;
    }
    try {
      await saveMemory({
        scope: draft.scope,
        category: draft.category,
        content: draft.content,
        projectId: draft.scope === 'Project' ? draft.projectId : null,
      });
      setStatus(`Saved ${labelCategory(draft.category)} memory.`);
      setEditing(null);
      await refresh();
    } catch (err) {
      setStatus(err.message || 'Could not save memory.');
    }
  };

  const remove = async (file) => {
    const label = labelCategory(file.category);
    if (!window.confirm(`Delete "${label}" memory? This clears the saved content.`)) return;
    try {
      await deleteMemory({
        scope: file.scope || 'Global',
        category: file.category,
        projectId: file.scope === 'Project' ? file.projectId : null,
      });
      setStatus(`Deleted ${label} memory.`);
      setEditing(null);
      onSelect(null);
      await refresh();
    } catch (err) {
      setStatus(err.message || 'Could not delete memory.');
    }
  };

  return (
    <>
      <CollectionPageHeader
        title="Memories"
        subtitle="Profile, rules, and lessons the agent can reuse across tasks."
      />
      <div className="h-[14px]" />
      <div className="util-split flex-1 min-h-0 grid grid-cols-[300px_1fr] px-8 pb-6 gap-6">
        <Card padding="snug" flat className="scroll-clean" style={{
          display: 'flex', flexDirection: 'column', gap: 14,
          overflowY: 'auto', minHeight: 0,
        }}>
          {globalSection && (
            <MemorySectionList
              heading="Global"
              files={globalSection.files || []}
              selected={selected}
              onSelect={onSelect}
            />
          )}
          {projectSections.map((section, idx) => (
            <MemorySectionList
              key={`${section.projectName}-${idx}`}
              heading={`Project · ${section.projectName}`}
              files={section.files || []}
              selected={selected}
              onSelect={onSelect}
              isActive={section.projectName === project?.name}
            />
          ))}
          {totalFiles === 0 && <EmptyState>No memory entries found.</EmptyState>}
        </Card>
        <div className="scroll-clean overflow-y-auto min-h-0">
          {editing === 'edit' && selected ? (
            <>
              <div className="flex items-center gap-[10px] mb-[10px]">
                <div className="flex-1">
                  <div className="text-base font-[650] text-ink">
                    {labelCategory(selected.category)}
                  </div>
                  <div className="text-[12px] text-[var(--frost-600)]">
                    {selected.scope === 'Project' && selected.projectName
                      ? `Project · ${selected.projectName}`
                      : selected.scope}
                  </div>
                </div>
                <Button variant="subtle" onClick={() => setEditing(null)}>Cancel</Button>
                <Button variant="primary" onClick={save}>Save</Button>
              </div>
              <textarea
                value={draft.content}
                onChange={(e) => setDraft((prev) => ({ ...prev, content: e.target.value }))}
                className={memoryEditorClass}
              />
            </>
          ) : displayed ? (
            <>
              <div className="flex items-center gap-[10px] mb-[10px]">
                <div className="flex-1">
                  <div className="text-base font-[650] text-ink">
                    {labelCategory(displayed.category)}
                  </div>
                  <div className="text-[12px] text-[var(--frost-600)]">
                    {displayed.scope === 'Project' && displayed.projectName
                      ? `Project · ${displayed.projectName}`
                      : displayed.scope}
                  </div>
                </div>
                <Button variant="subtle" onClick={() => startEdit(displayed)}>Edit</Button>
                <Button variant="subtle" onClick={() => remove(displayed)}>Delete</Button>
              </div>
              <div className={memoryViewerClass}>
                <MarkdownContent
                  text={displayed.content || displayed.preview || ''}
                  id={`mem-${displayed.path || displayed.category || 'doc'}`}
                  complete
                  dense
                />
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center">
              <UiEmptyState description="Select a memory entry to inspect it." />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function MemorySectionList({ heading, files, selected, onSelect, isActive }) {
  return (
    <div className="flex flex-col gap-px">
      <div className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-ink-4 font-semibold px-1 pb-1 flex items-center gap-[6px]">
        <span>{heading}</span>
        {isActive && <span className="text-accent tracking-[0] normal-case font-[family-name:var(--font-body)] text-[10.5px]">· active</span>}
        <span className="ml-auto text-ink-4 tracking-[0] normal-case font-[family-name:var(--font-body)]">{files.length}</span>
      </div>
      {files.length === 0 ? (
        <div className="px-[6px] py-[2px] text-ink-4 text-[12px]">—</div>
      ) : files.map((file) => (
        <button
          key={file.path}
          className={`recent-item${selected?.path === file.path ? ' active' : ''}`}
          // These three must beat the unlayered `.recent-item` globals rule
          // (height:26px; padding:0 10px), which wins specificity ties against
          // Tailwind utilities — so they stay inline. Lets multi-line labels grow.
          style={{ height: 'auto', minHeight: 26, padding: '4px 10px' }}
          onClick={() => onSelect(file)}
        >
          <span className="text-[var(--primary-700)] inline-flex">{Ico.doc(13)}</span>
          <span className="flex-1 whitespace-normal">{labelCategory(file.category)}</span>
        </button>
      ))}
    </div>
  );
}


function ConnectView({ data, setData, setStatus }) {
  const firstEngine = data.engines?.[0]?.engine || '';
  const initialEngine = (data.engines || []).find((item) => item.engine === firstEngine);
  const [engine, setEngine] = useState(firstEngine);
  const [authMethod, setAuthMethod] = useState(activeAuthMethod(initialEngine)?.name || '');
  const [name, setName] = useState('');
  const [credentialValues, setCredentialValues] = useState(credentialTemplate(initialEngine));
  const [validation, setValidation] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState('');

  const engineDef = (data.engines || []).find((item) => item.engine === engine);
  const fields = activeCredentialFields(engineDef, authMethod);
  const selectedAuth = activeAuthMethod(engineDef, authMethod);

  const setEngineAndTemplate = (value) => {
    setEngine(value);
    const selected = (data.engines || []).find((item) => item.engine === value);
    const nextAuth = activeAuthMethod(selected)?.name || '';
    setAuthMethod(nextAuth);
    setCredentialValues(credentialTemplate(selected));
    setValidation('');
    setStatus('');
  };

  const setAuthAndTemplate = (value) => {
    setAuthMethod(value);
    const method = activeAuthMethod(engineDef, value);
    setCredentialValues(Object.fromEntries((method?.fields || []).map((field) => [field.name, field.default || ''])));
    setValidation('');
    setStatus('');
  };

  const credentialsForSubmit = () => {
    const known = Object.fromEntries(fields.map((field) => [field.name, credentialValues[field.name] ?? '']));
    return known;
  };

  const updateCredential = (field, value) => {
    setCredentialValues((prev) => ({ ...prev, [field.name]: value }));
    setValidation('');
  };

  const validate = async () => {
    const credentials = credentialsForSubmit();
    try {
      setBusy(true);
      setBusyAction('check');
      const result = await validateDatasource({ engine, name, authMethod: authMethod || null, credentials });
      setValidation(result.message || 'Credential shape checked.');
      if (result.missingFields?.length) {
        setStatus(`Missing required fields: ${result.missingFields.join(', ')}`);
      } else {
        setStatus('Required fields are present. Save this connection to make it available to agent tasks.');
      }
    } catch (err) {
      setValidation('');
      setStatus(err.message || 'Could not validate datasource credentials.');
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setStatus('');
    const credentials = credentialsForSubmit();
    try {
      setBusy(true);
      setBusyAction('save');
      await validateDatasource({ engine, name, authMethod: authMethod || null, credentials });
      const saved = await saveDatasource({ engine, name, authMethod: authMethod || null, credentials });
      const latest = await fetchDatasources();
      setData(latest);
      setStatus(`Saved ${saved.slug || `${engine}-${saved.name || name}`} to the data vault.`);
      if (!name.trim() && saved.name) setName(saved.name);
    } catch (err) {
      setStatus(err.message || 'Could not save datasource connection.');
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  };

  const remove = async (conn) => {
    if (!window.confirm(`Remove datasource "${conn.engine}/${conn.name}"?`)) return;
    try {
      await deleteDatasource(conn.engine, conn.name);
      const latest = await fetchDatasources();
      setData(latest);
      setStatus(`Removed ${conn.engine}/${conn.name}.`);
      // Project files' Context card holds its own Google Drive file list —
      // see the matching dispatch in CustomizeView.handleDelete.
      window.dispatchEvent(new CustomEvent('anton:connections-changed'));
    } catch (err) {
      setStatus(err.message || 'Could not remove datasource connection.');
    }
  };

  return (
    <div className="util-publish p-[28px] grid grid-cols-[1fr_360px] gap-6">
      <div>
        <div className="text-[13px] font-[650] text-strong mb-[10px]">Saved connections</div>
        {(data.connections || []).length ? (data.connections || []).map((conn) => (
          <div key={`${conn.engine}-${conn.name}`} className="flex items-center gap-[10px] py-[10px] border-b border-t-0 border-x-0 border-solid border-[var(--border-0)] text-[13px]">
            <div className="flex-1">
              <strong className="text-strong">{conn.displayName || conn.engine}</strong> / {conn.name}
              <div className="text-[11.5px] text-[var(--frost-600)]">{conn.testAvailable ? 'Ready for datasource tools' : 'Saved in data vault'}</div>
            </div>
            <Button variant="subtle" onClick={() => remove(conn)}>Remove</Button>
          </div>
        )) : <EmptyState>No data vault connections found.</EmptyState>}
      </div>
      <form onSubmit={save} className="flex flex-col gap-[10px]">
        <Select
          ariaLabel="Engine"
          value={engine}
          onValueChange={setEngineAndTemplate}
          style={inputStyle}
          options={(data.engines || []).map((item) => ({ value: item.engine, label: item.displayName }))}
        />
        {(engineDef?.authMethods || []).length > 0 && (
          <Select
            ariaLabel="Authentication method"
            value={selectedAuth?.name || ''}
            onValueChange={setAuthAndTemplate}
            style={inputStyle}
            options={(engineDef.authMethods || []).map((method) => ({ value: method.name, label: method.display }))}
          />
        )}
        <Input aria-label="Connection name (optional)" value={name} onChange={(v) => setName(v)} placeholder="connection name (optional)" style={inputStyle} />
        {fields.length > 0 && (
          <div className="text-[11.5px] text-[var(--frost-600)]">
            Required: {fields.filter((field) => field.required).map((field) => field.name).join(', ') || 'none'}
          </div>
        )}
        {fields.length ? fields.map((field) => (
          <Field
            key={field.name}
            label={fieldLabel(field.name)}
            required={field.required}
            help={field.description || undefined}
          >
            {shouldUseTextarea(field) ? (
              <Textarea
                value={credentialValues[field.name] ?? ''}
                onChange={(v) => updateCredential(field, v)}
                rows={4}
                placeholder={field.description || field.default || ''}
                spellCheck={false}
                style={{ ...inputStyle, height: 'auto', padding: 10, fontFamily: 'var(--font-mono)', userSelect: 'text' }}
              />
            ) : (
              <Input
                value={credentialValues[field.name] ?? ''}
                onChange={(v) => updateCredential(field, v)}
                type={field.secret ? 'password' : 'text'}
                placeholder={field.description || field.default || ''}
                style={inputStyle}
              />
            )}
          </Field>
        )) : (
          <div className="p-3 border border-solid border-[var(--border-01)] rounded-card-row text-[var(--frost-600)] text-sm">
            This engine does not expose editable credential fields in the installed registry.
          </div>
        )}
        {validation && <div className="text-[12px] text-[var(--frost-700)]">{validation}</div>}
        <Button variant="subtle" disabled={!engine.trim() || busy} onClick={validate}>
          {busyAction === 'check' ? 'Checking' : 'Check fields'}
        </Button>
        <Button type="submit" variant="primary" disabled={!engine.trim() || busy}>
          {busyAction === 'save' ? 'Saving' : 'Save connection'}
        </Button>
      </form>
    </div>
  );
}

function PublishView({ data, setData, setStatus, onRefreshArtifacts }) {
  const publish = async (artifact) => {
    try {
      setStatus('Sharing…');
      const result = await publishArtifact(artifact.path);
      if (result.url) trackArtifactPublished(result.report_id || artifact.id || '', 'public');
      setStatus(result.url ? `Shared: ${result.url}` : 'Shared.');
      const latest = await fetchPublishable();
      setData(latest);
      onRefreshArtifacts?.();
    } catch (err) {
      setStatus(err.message || 'Sharing failed.');
    }
  };

  const copyUrl = async (url) => {
    const ok = await copyText(url);
    setStatus(ok ? 'Copied URL to clipboard.' : "Couldn't copy — select the URL above to copy it manually.");
  };

  return (
    <div className="p-[28px] flex flex-col gap-[10px]">
      {!data.publishReady && (
        <Alert variant="warning">
          Configure a Minds API key in Settings before sharing.
        </Alert>
      )}
      {(data.artifacts || []).length ? (data.artifacts || []).map((artifact) => (
        <div key={artifact.path} className="flex items-center gap-3 p-3 border border-solid border-[var(--border-01)] rounded-[9px]">
          <span className="text-[var(--primary-700)] inline-flex">{Ico.upload(15)}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-[650] text-strong">{artifact.title}</div>
            <div className="text-[11.5px] text-[var(--frost-600)] whitespace-nowrap overflow-hidden text-ellipsis">{artifact.path}</div>
            {artifact.publishedUrl && <div className="text-[12px] text-[var(--sage-700)] mt-1 select-text">{artifact.publishedUrl}</div>}
          </div>
          {artifact.publishedUrl && <Button variant="subtle" onClick={() => copyUrl(artifact.publishedUrl)}>Copy URL</Button>}
          {artifact.publishedUrl && <Button variant="subtle" onClick={() => window.open(artifact.publishedUrl, '_blank', 'noopener,noreferrer')}>Open</Button>}
          <Button variant="subtle" disabled={!data.publishReady} onClick={() => publish(artifact)}>Share</Button>
        </div>
      )) : <EmptyState>No HTML artifacts found in output folders.</EmptyState>}
      {(data.history || []).length > 0 && (
        <div className="mt-[18px]">
          <div className="text-[13px] font-[650] text-strong mb-2">Share history</div>
          {(data.history || []).slice(0, 10).map((item) => (
            <div key={`${item.artifact}-${item.publishedAt}`} className="py-2 border-t border-x-0 border-b-0 border-solid border-[var(--border-0)] text-sm">
              <strong>{item.artifactName}</strong>
              {item.url && <span className="ml-2 text-[var(--sage-700)] select-text">{item.url}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  height: 34,
  border: '1px solid var(--border-01)',
  borderRadius: 7,
  padding: '0 10px',
  fontSize: 13,
  outline: 'none',
  background: 'var(--surface-0)',
  color: 'var(--ink)',
};

// Editor and viewer share the same fixed min-height + typography so
// flipping between read and edit doesn't shift the layout. `--ink`
// keeps the text readable in both light and dark themes (the bug
// before this change was relying on the browser default text color,
// which rendered black-on-dark in dark mode).
const memoryEditorClass = 'w-full min-h-[520px] border border-solid border-[var(--border-01)] rounded-[7px] p-3 font-mono text-sm leading-[1.55] outline-none bg-[var(--surface-0)] text-ink resize-y select-text';

// Container for the MarkdownContent renderer in view mode. Keeps the
// minHeight matched to the editor textarea so flipping between read
// and edit doesn't shift the layout. Body styling (font, line-height,
// colours) is left to MarkdownContent itself so headings, lists, and
// code fences render with the same chat-column rhythm.
const memoryViewerClass = 'min-h-[520px] px-[14px] py-3 border border-solid border-[var(--border-01)] rounded-[7px] bg-[var(--surface-0)] select-text overflow-y-auto';
