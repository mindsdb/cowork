import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../../Icons';
import {
  applyHtmlVisualEditAtRanges,
  createHtmlVisualEditorDocument,
} from './htmlVisualEditorDocument';
import {
  HTML_VISUAL_EDITOR_PARENT_SOURCE,
  HTML_VISUAL_EDITOR_SOURCE,
} from './htmlVisualEditorRuntime';

// The token is a trust boundary: the parent accepts an editing postMessage only
// when it matches, so the artifact's own scripts must not be able to guess it.
// Same ladder as `allocateConversationId` in api.js — randomUUID is gated to
// secure contexts, getRandomValues is not, and Math.random is the last resort
// for an environment with no crypto at all (not a real Electron/browser case).
function createToken() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
  if (bytes) return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function buildFrame(content, baseUrl) {
  const token = createToken();
  const document = createHtmlVisualEditorDocument(content, { baseUrl, token });
  return { key: token, token, ...document };
}

export function ArtifactHtmlVisualEditor({
  source,
  value,
  onChange,
  onSave,
  draftUrl,
  onTextSelection,
}) {
  const iframeRef = useRef(null);
  const textareaRef = useRef(null);
  const visualValueRef = useRef(value);
  const sourceKey = `${source?.path || ''}\n${draftUrl || ''}`;
  const sourceKeyRef = useRef(sourceKey);
  const [showSource, setShowSource] = useState(false);
  const [frame, setFrame] = useState(() => buildFrame(value, draftUrl));
  const elementRangesRef = useRef(frame.elements);
  const [ready, setReady] = useState(false);
  const [editableCount, setEditableCount] = useState(frame.editableCount);
  const [selection, setSelection] = useState(null);
  const [error, setError] = useState('');

  const rebuildFrame = useCallback((content) => {
    visualValueRef.current = content;
    const nextFrame = buildFrame(content, draftUrl);
    elementRangesRef.current = nextFrame.elements;
    setFrame(nextFrame);
    setEditableCount(nextFrame.editableCount);
    setReady(false);
    setSelection(null);
    setError('');
  }, [draftUrl]);

  useEffect(() => {
    const sourceChanged = sourceKeyRef.current !== sourceKey;
    if (sourceChanged) sourceKeyRef.current = sourceKey;
    if (sourceChanged || (!showSource && value !== visualValueRef.current)) {
      rebuildFrame(value);
    } else if (showSource && value !== visualValueRef.current) {
      // A discard or external refresh can still replace the draft while the
      // advanced source view is open. Keep the next canvas mount in sync.
      visualValueRef.current = value;
    }
  }, [rebuildFrame, showSource, sourceKey, value]);

  useEffect(() => {
    const onMessage = (event) => {
      const message = event.data;
      // Electron may expose a different WindowProxy for an opaque sandboxed
      // OOPIF. The per-render token is injected before artifact scripts run,
      // kept inside the editor closure, and is the reliable channel identity.
      if (
        !iframeRef.current
        || message?.source !== HTML_VISUAL_EDITOR_SOURCE
        || message?.token !== frame.token
      ) return;

      if (message.type === 'ready') {
        setReady(true);
        setEditableCount(message.editableCount || 0);
      } else if (message.type === 'selection') {
        setSelection(message.elementId ? { id: message.elementId, label: message.label } : null);
      } else if (message.type === 'change' && message.elementId) {
        try {
          const next = applyHtmlVisualEditAtRanges(
            visualValueRef.current,
            elementRangesRef.current,
            message.elementId,
            message.html,
          );
          visualValueRef.current = next.content;
          elementRangesRef.current = next.elements;
          setError('');
          onChange(next.content);
        } catch (changeError) {
          setError(changeError.message || 'This text could not be updated.');
        }
      } else if (message.type === 'save') {
        onSave?.(visualValueRef.current);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frame.token, onChange, onSave]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSave?.();
      }
    };
    const node = textareaRef.current;
    node?.addEventListener('keydown', onKeyDown);
    return () => node?.removeEventListener('keydown', onKeyDown);
  }, [onSave, showSource]);

  const finishEditing = () => {
    iframeRef.current?.contentWindow?.postMessage({
      source: HTML_VISUAL_EDITOR_PARENT_SOURCE,
      type: 'finish',
    }, '*');
  };

  const toggleSource = () => {
    if (!showSource) finishEditing();
    else rebuildFrame(visualValueRef.current);
    setShowSource((current) => !current);
  };

  const reportSourceSelection = () => {
    const node = textareaRef.current;
    if (!node || node.selectionStart === node.selectionEnd) return;
    onTextSelection?.({
      type: 'text-range',
      path: source.path,
      start: node.selectionStart,
      end: node.selectionEnd,
      quote: value.slice(node.selectionStart, node.selectionEnd).slice(0, 500),
    });
  };

  const guidance = useMemo(() => {
    if (showSource) return 'Advanced mode — changes still save as a revision';
    if (error) return error;
    if (selection) return `${selection.label || 'Text'} selected — type to change it`;
    if (!ready) return 'Preparing editable text…';
    if (editableCount === 0) return 'No directly editable text was found';
    return 'Click any text in the artifact to edit it';
  }, [editableCount, error, ready, selection, showSource]);

  return (
    <div className="artifact-html-visual-editor">
      <div className="artifact-html-edit-toolbar">
        <div className="artifact-html-edit-guidance" role="status">
          <span className={`artifact-html-edit-indicator${selection ? ' is-active' : ''}`} aria-hidden="true" />
          <strong>{showSource ? 'HTML source' : 'Editing artifact'}</strong>
          <span className={error ? 'is-error' : ''}>{guidance}</span>
        </div>
        <div className="artifact-html-edit-actions">
          {selection && !showSource && (
            <button type="button" onClick={finishEditing}>
              {Ico.check(13)} Done
            </button>
          )}
          <button type="button" className="is-secondary" onClick={toggleSource}>
            {showSource ? Ico.edit(13) : Ico.code(13)}
            {showSource ? 'Back to artifact' : 'Advanced'}
          </button>
        </div>
      </div>

      {showSource ? (
        <section className="artifact-source-pane artifact-html-source-pane" aria-label="Artifact HTML source">
          <div className="artifact-pane-label">
            <span>HTML source</span>
            <code>{source.path}</code>
          </div>
          <textarea
            ref={textareaRef}
            className="artifact-source-textarea"
            aria-label={`Edit ${source.path}`}
            spellCheck={false}
            value={value}
            onChange={(event) => {
              visualValueRef.current = event.target.value;
              onChange(event.target.value);
            }}
            onSelect={reportSourceSelection}
          />
        </section>
      ) : (
        <div className="artifact-html-edit-canvas">
          <iframe
            key={frame.key}
            ref={iframeRef}
            title="Edit artifact on canvas"
            srcDoc={frame.content}
            sandbox="allow-scripts"
            className="artifact-html-edit-iframe"
            onLoad={(event) => {
              setReady(true);
              event.currentTarget.contentWindow?.postMessage({
                source: HTML_VISUAL_EDITOR_PARENT_SOURCE,
                type: 'status',
              }, '*');
            }}
          />
        </div>
      )}
    </div>
  );
}

export default ArtifactHtmlVisualEditor;
