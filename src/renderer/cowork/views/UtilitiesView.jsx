import { useEffect, useMemo, useState } from 'react';
import Ico from '../components/Icons';
import { Message, Button, Card, EmptyState as UiEmptyState } from '../components/ui';
import { PageHeader as CollectionPageHeader } from '../components/collection';
import { MarkdownContent } from '../components/markdown/MarkdownContent';
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

function PageHeader({ title, subtitle }) {
  return (
    <div className="page-header">
      <div style={{ flex: 1 }}>
        <h1 className="page-title">{title}</h1>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--frost-600)', marginTop: 4 }}>{subtitle}</div>}
      </div>
    </div>
  );
}

function EmptyState({ children }) {
  return <div style={{ padding: 32, color: 'var(--frost-600)', fontSize: 13 }}>{children}</div>;
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
      {!isMemoryKind && <PageHeader title={title} subtitle={subtitle} />}
      {status && <Message style={{ margin: '16px 28px 0', fontSize: 12.5 }}>{status}</Message>}
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
      <div style={{ height: 14 }} />
      <div className="util-split" style={{
        flex: 1, minHeight: 0,
        display: 'grid', gridTemplateColumns: '300px 1fr',
        padding: '0 32px 24px', gap: 24,
      }}>
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
        <div className="scroll-clean" style={{
          overflowY: 'auto', minHeight: 0,
        }}>
          {editing === 'edit' && selected ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)' }}>
                    {labelCategory(selected.category)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--frost-600)' }}>
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
                style={memoryEditorStyle}
              />
            </>
          ) : displayed ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)' }}>
                    {labelCategory(displayed.category)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--frost-600)' }}>
                    {displayed.scope === 'Project' && displayed.projectName
                      ? `Project · ${displayed.projectName}`
                      : displayed.scope}
                  </div>
                </div>
                <Button variant="subtle" onClick={() => startEdit(displayed)}>Edit</Button>
                <Button variant="subtle" onClick={() => remove(displayed)}>Delete</Button>
              </div>
              <div style={memoryViewerStyle}>
                <MarkdownContent
                  text={displayed.content || displayed.preview || ''}
                  id={`mem-${displayed.path || displayed.category || 'doc'}`}
                  complete
                  dense
                />
              </div>
            </>
          ) : (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
        padding: '0 4px 4px', display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span>{heading}</span>
        {isActive && <span style={{ color: 'var(--accent)', letterSpacing: 0, textTransform: 'none', fontFamily: 'var(--font-body)', fontSize: 10.5 }}>· active</span>}
        <span style={{ marginLeft: 'auto', color: 'var(--ink-4)', letterSpacing: 0, textTransform: 'none', fontFamily: 'var(--font-body)' }}>{files.length}</span>
      </div>
      {files.length === 0 ? (
        <div style={{ padding: '2px 6px 2px', color: 'var(--ink-4)', fontSize: 12 }}>—</div>
      ) : files.map((file) => (
        <button
          key={file.path}
          className={`recent-item${selected?.path === file.path ? ' active' : ''}`}
          onClick={() => onSelect(file)}
          style={{ height: 'auto', minHeight: 26, padding: '4px 10px', fontSize: 12.5 }}
        >
          <span style={{ color: 'var(--primary-700)', display: 'inline-flex' }}>{Ico.doc(13)}</span>
          <span style={{ flex: 1, whiteSpace: 'normal' }}>{labelCategory(file.category)}</span>
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
    } catch (err) {
      setStatus(err.message || 'Could not remove datasource connection.');
    }
  };

  return (
    <div className="util-publish" style={{ padding: 28, display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-strong)', marginBottom: 10 }}>Saved connections</div>
        {(data.connections || []).length ? (data.connections || []).map((conn) => (
          <div key={`${conn.engine}-${conn.name}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-0)', fontSize: 13 }}>
            <div style={{ flex: 1 }}>
              <strong style={{ color: 'var(--text-strong)' }}>{conn.displayName || conn.engine}</strong> / {conn.name}
              <div style={{ fontSize: 11.5, color: 'var(--frost-600)' }}>{conn.testAvailable ? 'Ready for datasource tools' : 'Saved in data vault'}</div>
            </div>
            <Button variant="subtle" onClick={() => remove(conn)}>Remove</Button>
          </div>
        )) : <EmptyState>No data vault connections found.</EmptyState>}
      </div>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <select aria-label="Engine" value={engine} onChange={(e) => setEngineAndTemplate(e.target.value)} style={inputStyle}>
          {(data.engines || []).map((item) => <option key={item.engine} value={item.engine}>{item.displayName}</option>)}
        </select>
        {(engineDef?.authMethods || []).length > 0 && (
          <select aria-label="Authentication method" value={selectedAuth?.name || ''} onChange={(e) => setAuthAndTemplate(e.target.value)} style={inputStyle}>
            {(engineDef.authMethods || []).map((method) => <option key={method.name} value={method.name}>{method.display}</option>)}
          </select>
        )}
        <input aria-label="Connection name (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="connection name (optional)" style={inputStyle} />
        {fields.length > 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--frost-600)' }}>
            Required: {fields.filter((field) => field.required).map((field) => field.name).join(', ') || 'none'}
          </div>
        )}
        {fields.length ? fields.map((field) => (
          <label key={field.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-strong)' }}>
              {fieldLabel(field.name)}{field.required ? ' *' : ''}
            </span>
            {shouldUseTextarea(field) ? (
              <textarea
                value={credentialValues[field.name] ?? ''}
                onChange={(event) => updateCredential(field, event.target.value)}
                rows={4}
                placeholder={field.description || field.default || ''}
                spellCheck={false}
                style={{ ...inputStyle, height: 'auto', padding: 10, fontFamily: 'var(--font-mono)', userSelect: 'text' }}
              />
            ) : (
              <input
                value={credentialValues[field.name] ?? ''}
                onChange={(event) => updateCredential(field, event.target.value)}
                type={field.secret ? 'password' : 'text'}
                placeholder={field.description || field.default || ''}
                style={inputStyle}
              />
            )}
            {field.description && <small style={{ fontSize: 11.5, color: 'var(--frost-600)' }}>{field.description}</small>}
          </label>
        )) : (
          <div style={{ padding: 12, border: '1px solid var(--border-01)', borderRadius: 8, color: 'var(--frost-600)', fontSize: 12.5 }}>
            This engine does not expose editable credential fields in the installed registry.
          </div>
        )}
        {validation && <div style={{ fontSize: 12, color: 'var(--frost-700)' }}>{validation}</div>}
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

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!data.publishReady && (
        <Message variant="warning">
          Configure a Minds API key in Settings before sharing.
        </Message>
      )}
      {(data.artifacts || []).length ? (data.artifacts || []).map((artifact) => (
        <div key={artifact.path} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: '1px solid var(--border-01)', borderRadius: 9 }}>
          <span style={{ color: 'var(--primary-700)', display: 'inline-flex' }}>{Ico.upload(15)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--text-strong)' }}>{artifact.title}</div>
            <div style={{ fontSize: 11.5, color: 'var(--frost-600)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{artifact.path}</div>
            {artifact.publishedUrl && <div style={{ fontSize: 12, color: 'var(--sage-700)', marginTop: 4, userSelect: 'text' }}>{artifact.publishedUrl}</div>}
          </div>
          {artifact.publishedUrl && <Button variant="subtle" onClick={() => navigator.clipboard?.writeText(artifact.publishedUrl)}>Copy URL</Button>}
          {artifact.publishedUrl && <Button variant="subtle" onClick={() => window.open(artifact.publishedUrl, '_blank', 'noopener,noreferrer')}>Open</Button>}
          <Button variant="subtle" disabled={!data.publishReady} onClick={() => publish(artifact)}>Share</Button>
        </div>
      )) : <EmptyState>No HTML artifacts found in output folders.</EmptyState>}
      {(data.history || []).length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-strong)', marginBottom: 8 }}>Share history</div>
          {(data.history || []).slice(0, 10).map((item) => (
            <div key={`${item.artifact}-${item.publishedAt}`} style={{ padding: '8px 0', borderTop: '1px solid var(--border-0)', fontSize: 12.5 }}>
              <strong>{item.artifactName}</strong>
              {item.url && <span style={{ marginLeft: 8, color: 'var(--sage-700)', userSelect: 'text' }}>{item.url}</span>}
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

// Native <select> paints its own chevron in the right padding area;
// the chevron looked flush with the right border at `padding: 10px`.
// Bumping right padding gives the indicator some air.
const selectStyle = { ...inputStyle, paddingRight: 28 };

// Editor and viewer share the same fixed min-height + typography so
// flipping between read and edit doesn't shift the layout. `--ink`
// keeps the text readable in both light and dark themes (the bug
// before this change was relying on the browser default text color,
// which rendered black-on-dark in dark mode).
const memoryEditorStyle = {
  width: '100%',
  minHeight: 520,
  border: '1px solid var(--border-01)',
  borderRadius: 7,
  padding: 12,
  fontFamily: 'var(--font-mono)',
  fontSize: 12.5,
  lineHeight: 1.55,
  outline: 'none',
  background: 'var(--surface-0)',
  color: 'var(--ink)',
  resize: 'vertical',
  userSelect: 'text',
};

// Container for the MarkdownContent renderer in view mode. Keeps the
// minHeight matched to the editor textarea so flipping between read
// and edit doesn't shift the layout. Body styling (font, line-height,
// colours) is left to MarkdownContent itself so headings, lists, and
// code fences render with the same chat-column rhythm.
const memoryViewerStyle = {
  minHeight: 520,
  padding: '12px 14px',
  border: '1px solid var(--border-01)',
  borderRadius: 7,
  background: 'var(--surface-0)',
  userSelect: 'text',
  overflowY: 'auto',
};
