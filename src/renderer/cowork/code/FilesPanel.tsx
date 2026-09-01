import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Menu from '../components/ui/Menu';
import Spinner from '../components/ui/Spinner';
import type { InputReference } from './api';
import {
  workspaceApi,
  type WorkspaceEntry,
  type WorkspaceFileContent,
  type WorkspaceResource,
  type WorkspaceSearchMatch,
} from './workspaceApi';
import './files-panel.css';


type FilesStyle = CSSProperties & { '--code-files-width': string };

function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function displayLines(file: WorkspaceFileContent): string[] {
  const lines = file.content.split('\n');
  if (file.content.endsWith('\n')) lines.pop();
  return lines;
}

const FILE_WINDOW_LINES = 200;
const SEARCH_CONTEXT_BEFORE = 20;

export function FilesPanel({
  open,
  sessionId,
  onClose,
  onReference,
}: {
  open: boolean;
  sessionId: string;
  onClose: () => void;
  onReference: (reference: InputReference) => void;
}) {
  const [resources, setResources] = useState<WorkspaceResource[]>([]);
  const [resourceId, setResourceId] = useState('');
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [file, setFile] = useState<WorkspaceFileContent | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkspaceSearchMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<{ anchor: number; focus: number } | null>(null);
  const [width, setWidth] = useState(560);
  const fileRequest = useRef(0);
  const selectedResource = resources.find((item) => item.id === resourceId) || resources[0] || null;
  const selectedRange = selection
    ? [Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus)] as const
    : null;
  const lines = useMemo(() => file ? displayLines(file) : [], [file]);

  useEffect(() => {
    fileRequest.current += 1;
    setResources([]);
    setResourceId('');
    setPath('');
    setEntries([]);
    setFile(null);
    setQuery('');
    setResults([]);
    setSelection(null);
    if (!open) {
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setError('');
    workspaceApi.resources(sessionId)
      .then(({ items }) => {
        if (!alive) return;
        setResources(items);
        setResourceId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || '');
      })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Files could not be loaded.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, sessionId]);

  useEffect(() => {
    if (!open || !resourceId || file || query) return undefined;
    let alive = true;
    setLoading(true);
    setError('');
    workspaceApi.entries(sessionId, resourceId, path)
      .then((page) => { if (alive) setEntries(page.items); })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'This folder could not be opened.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [file, open, path, query, resourceId, sessionId]);

  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([]);
      return undefined;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      workspaceApi.search(sessionId, query, resourceId || null)
        .then((page) => { if (alive) setResults(page.items); })
        .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Search failed.'); })
        .finally(() => { if (alive) setLoading(false); });
    }, 180);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [open, query, resourceId, sessionId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  const openFile = (
    nextResourceId: string,
    nextPath: string,
    focusLine?: number | null,
    windowStart?: number | null,
  ) => {
    const request = fileRequest.current + 1;
    fileRequest.current = request;
    setLoading(true);
    setError('');
    setSelection(null);
    const start = windowStart || (focusLine ? Math.max(1, focusLine - SEARCH_CONTEXT_BEFORE) : 1);
    workspaceApi.file(sessionId, nextResourceId, nextPath, start, start + FILE_WINDOW_LINES - 1)
      .then((content) => {
        if (fileRequest.current !== request) return;
        setResourceId(nextResourceId);
        setFile(content);
        setPath(parentPath(content.path));
        setQuery('');
        if (focusLine) setSelection({ anchor: focusLine, focus: focusLine });
      })
      .catch((reason) => {
        if (fileRequest.current === request) {
          setError(reason instanceof Error ? reason.message : 'This file could not be opened.');
        }
      })
      .finally(() => {
        if (fileRequest.current === request) setLoading(false);
      });
  };
  const openFileWindow = (start: number) => {
    if (!file) return;
    openFile(file.resource_id, file.path, null, start);
  };
  const chooseResource = (id: string) => {
    fileRequest.current += 1;
    setResourceId(id);
    setPath('');
    setFile(null);
    setQuery('');
    setSelection(null);
  };
  const chooseEntry = (entry: WorkspaceEntry) => {
    if (entry.kind === 'directory') {
      fileRequest.current += 1;
      setPath(entry.path);
      setFile(null);
      return;
    }
    openFile(entry.resource_id, entry.path);
  };
  const addReference = () => {
    if (!file) return;
    const start = selectedRange?.[0];
    const end = selectedRange?.[1];
    const range = start ? `:${start}${end && end !== start ? `-${end}` : ''}` : '';
    onReference({
      name: `${file.resource_name}/${file.path}${range}`,
      path: `${file.resource_id}:${file.path}${range ? `#L${start}${end && end !== start ? `-${end}` : ''}` : ''}`,
      kind: 'mention',
      resource_id: file.resource_id,
      relative_path: file.path,
      line_start: start,
      line_end: end,
      content_hash: file.content_hash,
    });
  };
  const widthFromPointer = (clientX: number) => Math.min(760, Math.max(400, window.innerWidth - clientX));

  if (!open) return null;

  return (
    <>
      <button type="button" className="code-files-scrim" aria-label="Close files panel" onClick={onClose} />
      <aside
        id="code-files-panel"
        className="code-files"
        aria-label="Task files"
        style={{ '--code-files-width': `${width}px` } as FilesStyle}
      >
        <div
          className="code-files__resize"
          role="separator"
          aria-label="Resize files panel"
          aria-orientation="vertical"
          aria-valuemin={400}
          aria-valuemax={760}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setWidth(widthFromPointer(event.clientX));
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(widthFromPointer(event.clientX));
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            setWidth((current) => Math.min(760, Math.max(400, current + (event.key === 'ArrowLeft' ? 20 : -20))));
          }}
        />
        <header className="code-files__header">
          <div>
            <div className="code-eyebrow">TASK CONTEXT</div>
            <div className="code-files__title">Files</div>
          </div>
          <Button icon size="sm" variant="subtle" aria-label="Close files panel" onClick={onClose}>{Ico.close(14)}</Button>
        </header>
        <div className="code-files__tools">
          {selectedResource && (
            <Menu
              side="bottom"
              align="start"
              width={220}
              ariaLabel="Project folder"
              trigger={(
                <Button size="sm" variant="subtle" aria-label={`Resource: ${selectedResource.name}`}>
                  {Ico.folder(13)}<span>{selectedResource.name}</span>{resources.length > 1 && Ico.chevDown(10)}
                </Button>
              )}
              items={resources.map((resource) => ({
                key: resource.id,
                label: resource.name,
                icon: Ico.folder(13),
                hint: resource.id === selectedResource.id ? Ico.check(11) : undefined,
                onClick: () => chooseResource(resource.id),
              }))}
            />
          )}
          <Input
            value={query}
            onChange={setQuery}
            size="sm"
            leading={Ico.search(13)}
            wrapperClassName="code-files__search"
            placeholder="Search task files"
            aria-label="Search task files"
          />
        </div>
        {error && <div className="code-files__error"><Alert variant="danger">{error}</Alert></div>}
        <div className="code-files__body scroll-clean">
          {loading && !file && <div className="code-files__loading"><Spinner /> Loading…</div>}
          {!loading && resources.length === 0 && !error && (
            <div className="code-files__empty"><span>{Ico.folder(18)}</span><strong>No task files available</strong><p>This task does not have a prepared working copy on this computer.</p></div>
          )}
          {!!query && !loading && results.length === 0 && !error && (
            <div className="code-files__empty"><span>{Ico.search(18)}</span><strong>No matches</strong><p>Try a filename, symbol, or phrase from the code.</p></div>
          )}
          {!!query && results.length > 0 && (
            <div className="code-files__results">
              {results.map((result) => (
                <button
                  type="button"
                  key={`${result.resource_id}:${result.path}:${result.line || 0}`}
                  onClick={() => openFile(result.resource_id, result.path, result.line)}
                >
                  <span className="code-files__result-path">
                    {resources.length > 1 && <em>{result.resource_name}</em>}{result.path}{result.line ? `:${result.line}` : ''}
                  </span>
                  {result.preview && <span className="code-files__result-preview">{result.preview}</span>}
                </button>
              ))}
            </div>
          )}
          {!query && !file && resources.length > 0 && (
            <div className="code-files__browser">
              <div className="code-files__crumbs">
                <button type="button" onClick={() => setPath('')}>{selectedResource?.name}</button>
                {path.split('/').filter(Boolean).map((part, index, parts) => (
                  <span key={`${part}-${index}`}><i>/</i><button type="button" onClick={() => setPath(parts.slice(0, index + 1).join('/'))}>{part}</button></span>
                ))}
              </div>
              {path && (
                <button type="button" className="code-files__entry is-parent" onClick={() => setPath(parentPath(path))}>
                  <span>{Ico.chevLeft(12)}</span><strong>Back</strong>
                </button>
              )}
              {entries.map((entry) => (
                <button type="button" className="code-files__entry" key={`${entry.kind}:${entry.path}`} onClick={() => chooseEntry(entry)}>
                  <span>{entry.kind === 'directory' ? Ico.folder(14) : Ico.code(14)}</span>
                  <strong>{entry.name}</strong>
                  {entry.kind === 'directory' && <i>{Ico.chevRight(11)}</i>}
                </button>
              ))}
              {!loading && entries.length === 0 && <div className="code-files__folder-empty">This folder is empty.</div>}
            </div>
          )}
          {!query && file && (
            <div className="code-files__viewer">
              <div className="code-files__viewer-bar">
                <button type="button" onClick={() => { setFile(null); setSelection(null); }}>{Ico.chevLeft(12)} Files</button>
                <strong title={file.path}>{file.name}</strong>
                <span>Lines {file.line_start}–{file.line_end} of {file.line_count}</span>
              </div>
              <div className="code-files__code" role="listbox" aria-label={`${file.name} lines`} aria-multiselectable="true">
                {lines.map((line, index) => {
                  const lineNumber = file.line_start + index;
                  const selected = !!selectedRange && lineNumber >= selectedRange[0] && lineNumber <= selectedRange[1];
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={selected ? 'is-selected' : ''}
                      key={lineNumber}
                      onClick={(event) => setSelection((current) => (
                        event.shiftKey && current
                          ? { anchor: current.anchor, focus: lineNumber }
                          : { anchor: lineNumber, focus: lineNumber }
                      ))}
                    >
                      <span>{lineNumber}</span><code>{line || ' '}</code>
                    </button>
                  );
                })}
              </div>
              {file.truncated && (
                <nav className="code-files__pagination" aria-label="File pages">
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={file.line_start <= 1 || loading}
                    onClick={() => openFileWindow(Math.max(1, file.line_start - FILE_WINDOW_LINES))}
                  >
                    {Ico.chevLeft(11)} Previous
                  </Button>
                  <span>{file.line_start}–{file.line_end}</span>
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={file.line_end >= file.line_count || loading}
                    onClick={() => openFileWindow(file.line_end + 1)}
                  >
                    Next {Ico.chevRight(11)}
                  </Button>
                </nav>
              )}
            </div>
          )}
        </div>
        {file && !query && (
          <footer className="code-files__footer">
            <span>{selectedRange ? `Lines ${selectedRange[0]}${selectedRange[1] !== selectedRange[0] ? `–${selectedRange[1]}` : ''}` : 'Whole file'}</span>
            <Button size="sm" variant="primary" onClick={addReference}>{Ico.plus(12)} Add to prompt</Button>
          </footer>
        )}
      </aside>
    </>
  );
}
