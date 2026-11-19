import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyHtmlVisualEditAtRanges,
  createHtmlVisualEditorDocument,
  htmlVisualElementHtml,
  restoreHtmlVisualElementAtRanges,
} from './htmlVisualEditorDocument';
import { createFrameToken } from './frameToken';
import {
  HTML_VISUAL_EDITOR_PARENT_SOURCE,
  HTML_VISUAL_EDITOR_SOURCE,
} from './htmlVisualEditorRuntime';
import { absoluteDraftUrl, useInlinedFrameDocument } from './inlineArtifactFrame';
import { normalizePreviewView } from '../usePreviewView';
import { EditModeSwitch } from './EditModeSwitch';
import { LiveEditControls } from './LiveEditPanel';
import { useTranslation } from '../../../../lib/i18n';

/* The frame runtime names a selected element in English (or by the page's own
   aria-label, which stays as written); these are its generic names. */
const ELEMENT_LABEL_KEYS = {
  Heading: 'heading',
  Paragraph: 'paragraph',
  'List item': 'listItem',
  'Button label': 'buttonLabel',
  Caption: 'caption',
  Text: 'text',
};

/** An element's name for the unsaved changes list, in the user's language. */
function elementLabel(raw, t) {
  const label = raw || 'Text';
  return Object.hasOwn(ELEMENT_LABEL_KEYS, label) ? t(`htmlEditor.elements.${ELEMENT_LABEL_KEYS[label]}`) : label;
}

/** What a reader sees of some HTML: its text, on one line. */
export function htmlText(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/* Brings the unsaved changes list in line with the source: each change reads
   its element's HTML now, and one back to what it was is no change at all. */
function syncChanges(changes, content, elements) {
  return changes.flatMap((change) => {
    const after = htmlVisualElementHtml(content, elements, change.id);
    if (after == null || after === change.before) return [];
    return [after === change.after ? change : { ...change, after }];
  });
}

function buildFrame(content, baseUrl) {
  const token = createFrameToken();
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
  // Whether the editor is on screen (Edit), not hidden behind Preview.
  active = true,
  // `{ view, seq }` from usePreviewView: where the user is in the Preview.
  previewView = null,
  // Hears where the user is in the canvas (a normalized view, as the
  // Preview's), so a save made here keeps the Preview on the same slide.
  onViewChange = null,
  // `{ dirty, saving, canEdit, onSave, onDiscard }`: Save and Discard, in
  // the Live edit panel while there is unsaved text.
  editActions = null,
  // The Live edit panel's slot (LiveEditPanel): the editor's status, the
  // unsaved changes, Source code and Save / Discard render there. The
  // Navigate / Edit text switch stays over the canvas.
  controlsTarget = null,
}) {
  const { t } = useTranslation('artifacts');
  const iframeRef = useRef(null);
  const textareaRef = useRef(null);
  const visualValueRef = useRef(value);
  const documentUrl = absoluteDraftUrl(draftUrl);
  const sourceKey = `${source?.path || ''}\n${draftUrl || ''}`;
  const sourceKeyRef = useRef(sourceKey);
  const [showSource, setShowSource] = useState(false);
  const [frame, setFrame] = useState(() => buildFrame(value, documentUrl));
  // The source the canvas reflects: the one it was built from plus every edit
  // made in it. Equal to the draft means the canvas is current and can stay
  // on whatever slide or page the user moved it to.
  const frameValueRef = useRef(value);
  // Built from the source first, then inlined: element ranges are offsets
  // into the source, and parse5 never parses the inlined document.
  const inlined = useInlinedFrameDocument(frame.content, documentUrl);
  const elementRangesRef = useRef(frame.elements);
  const cancelSnapshotRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [editableCount, setEditableCount] = useState(frame.editableCount);
  // Navigate / Edit (EditModeSwitch); kept across canvas rebuilds, which
  // hear it again on their 'ready'.
  const [editMode, setEditMode] = useState('edit');
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const [selection, setSelection] = useState(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [error, setError] = useState('');
  // The unsaved changes, one per element edited since the last save:
  // `{ id, label, before, after }`, `before` the element's HTML in the source
  // and `after` its HTML now. Each can be undone on its own from the Live
  // edit panel; a save or a discard empties the list.
  const [changes, setChangesState] = useState([]);
  const changesRef = useRef(changes);
  const setChanges = useCallback((next) => {
    changesRef.current = typeof next === 'function' ? next(changesRef.current) : next;
    setChangesState(changesRef.current);
  }, []);
  // Opening on the Preview's view. `seenViewSeqRef` is the last preview view
  // considered, so a view is applied once and the editor otherwise keeps
  // whatever slide the user moved it to. A replay needs the page as it loaded,
  // so a canvas that may have moved (it was on screen, or already replayed a
  // view) is rebuilt first. `pendingViewRef` waits for the frame to be ready.
  const seenViewSeqRef = useRef(0);
  const pendingViewRef = useRef(null);
  const frameMovedRef = useRef(false);
  const [viewRequest, setViewRequest] = useState(0);
  // false, or what is being replayed: 'preview' (opening on the Preview's
  // view) or 'own' (going back to the canvas's own place after a rebuild).
  const [syncingView, setSyncingView] = useState(false);
  const pendingKindRef = useRef('preview');
  const syncTimerRef = useRef(0);
  // Keeping the place across a rebuild (ENG-4383). The runtime reports where
  // the user is in the canvas (htmlVisualEditorRuntime.js view recorder); a
  // rebuild because the content changed replays it into the new canvas, as
  // the Preview's view is replayed when Edit opens. The report comes from
  // inside the artifact: it is checked like the Preview's.
  const ownViewRef = useRef(null);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  const postMode = useCallback((mode) => {
    iframeRef.current?.contentWindow?.postMessage({
      source: HTML_VISUAL_EDITOR_PARENT_SOURCE,
      type: 'mode',
      mode,
    }, '*');
  }, []);
  const changeEditMode = useCallback((mode) => {
    setEditMode(mode);
    postMode(mode);
  }, [postMode]);

  // keepPlace: the content changed under the user, who stays where they
  // were. Otherwise the canvas starts over (a replay that missed, another
  // file) and its own place is forgotten.
  const rebuildFrame = useCallback((content, { keepPlace = false } = {}) => {
    if (keepPlace && ownViewRef.current && !pendingViewRef.current) {
      pendingViewRef.current = ownViewRef.current;
      pendingKindRef.current = 'own';
    } else if (!keepPlace) {
      ownViewRef.current = null;
      onViewChangeRef.current?.(null);
    }
    frameMovedRef.current = false;
    visualValueRef.current = content;
    frameValueRef.current = content;
    const nextFrame = buildFrame(content, documentUrl);
    // The same text gives the same elements, so the changes carry over to
    // the new canvas; ones the new source took back drop out.
    if (nextFrame.editableCount !== elementRangesRef.current.length) setChanges([]);
    else setChanges((list) => syncChanges(list, content, nextFrame.elements));
    elementRangesRef.current = nextFrame.elements;
    cancelSnapshotRef.current = null;
    setFrame(nextFrame);
    setEditableCount(nextFrame.editableCount);
    setReady(false);
    setSyncingView(false);
    setSelection(null);
    setError('');
  }, [documentUrl, setChanges]);

  useEffect(() => {
    const sourceChanged = sourceKeyRef.current !== sourceKey;
    if (sourceChanged) {
      sourceKeyRef.current = sourceKey;
      setChanges([]);
    }
    if (sourceChanged || (!showSource && value !== visualValueRef.current)) {
      rebuildFrame(value, { keepPlace: !sourceChanged });
    } else if (showSource && value !== visualValueRef.current) {
      // A discard or external refresh can still replace the draft while the
      // advanced source view is open. Keep the next canvas mount in sync.
      visualValueRef.current = value;
    }
  }, [rebuildFrame, setChanges, showSource, sourceKey, value]);

  // Saved or discarded: nothing is unsaved any more.
  const dirty = editActions ? !!(editActions.dirty || editActions.saving) : null;
  useEffect(() => {
    if (dirty === false) setChanges([]);
  }, [dirty, setChanges]);

  // Records an element's edit in the unsaved changes list. `previous` is the
  // source before this edit, which holds the element's original HTML the
  // first time it changes.
  const recordChange = useCallback((id, content, elements, previous = null) => {
    setChanges((list) => {
      const after = htmlVisualElementHtml(content, elements, id);
      const existing = list.find((change) => change.id === id);
      if (!existing) {
        const before = previous && htmlVisualElementHtml(previous.content, previous.elements, id);
        if (before == null || after == null || after === before) return list;
        const label = selectionRef.current?.id === id ? selectionRef.current.label : '';
        return [...list, { id, label, before, after }];
      }
      if (after == null || after === existing.before) return list.filter((change) => change.id !== id);
      return list.map((change) => (change.id === id ? { ...change, after } : change));
    });
  }, [setChanges]);

  // Undoes one change: the element gets its original HTML back and the
  // canvas is rebuilt on it, in the same place.
  const undoChange = useCallback((id) => {
    const change = changesRef.current.find((item) => item.id === id);
    if (!change) return;
    setChanges((list) => list.filter((item) => item.id !== id));
    try {
      const next = restoreHtmlVisualElementAtRanges(
        visualValueRef.current,
        elementRangesRef.current,
        id,
        change.before,
      );
      rebuildFrame(next.content, { keepPlace: true });
      onChange(next.content);
    } catch (undoError) {
      setError(undoError.message || t('htmlEditor.updateFailed'));
    }
  }, [onChange, rebuildFrame, setChanges, t]);

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
        postMode(editModeRef.current);
      } else if (message.type === 'selection') {
        setSelection(message.elementId ? { id: message.elementId, label: message.label } : null);
        if (message.elementId) {
          // Escape returns the source to this point. The DOM can't serve as the
          // original: artifact scripts may have rewritten the element's text.
          cancelSnapshotRef.current = {
            id: message.elementId,
            content: visualValueRef.current,
            elements: elementRangesRef.current,
          };
        }
      } else if (message.type === 'cancel') {
        const snapshot = cancelSnapshotRef.current;
        if (!snapshot || snapshot.id !== message.elementId) return;
        cancelSnapshotRef.current = null;
        elementRangesRef.current = snapshot.elements;
        setError('');
        if (snapshot.content !== visualValueRef.current) {
          visualValueRef.current = snapshot.content;
          frameValueRef.current = snapshot.content;
          recordChange(snapshot.id, snapshot.content, snapshot.elements);
          onChange(snapshot.content);
        }
      } else if (message.type === 'change' && message.elementId) {
        try {
          const previous = { content: visualValueRef.current, elements: elementRangesRef.current };
          const next = applyHtmlVisualEditAtRanges(
            previous.content,
            previous.elements,
            message.elementId,
            message.html,
          );
          recordChange(message.elementId, next.content, next.elements, previous);
          visualValueRef.current = next.content;
          frameValueRef.current = next.content;
          elementRangesRef.current = next.elements;
          setError('');
          onChange(next.content);
        } catch (changeError) {
          setError(changeError.message || t('htmlEditor.updateFailed'));
        }
      } else if (message.type === 'save') {
        onSave?.(visualValueRef.current);
      } else if (message.type === 'view') {
        const raw = message.view;
        const view = raw && typeof raw === 'object' ? normalizePreviewView({ ...raw, type: 'view' }) : null;
        if (!view) return;
        ownViewRef.current = view;
        onViewChangeRef.current?.(view);
      } else if (message.type === 'view-applied') {
        setSyncingView(false);
        // The replay did not land on the Preview's slide. Start over from the
        // page as it loads, which is where the editor opened before.
        if (message.status === 'mismatch') rebuildFrame(visualValueRef.current);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frame.token, onChange, onSave, postMode, rebuildFrame, recordChange]);

  useEffect(() => {
    if (!active || showSource || !previewView || previewView.seq === seenViewSeqRef.current) return;
    seenViewSeqRef.current = previewView.seq;
    // null: the Preview reloaded and the user has not moved it since.
    if (!previewView.view) return;
    pendingViewRef.current = previewView.view;
    pendingKindRef.current = 'preview';
    if (frameMovedRef.current) rebuildFrame(visualValueRef.current);
    else setViewRequest((count) => count + 1);
  }, [active, previewView, rebuildFrame, showSource]);

  useEffect(() => {
    // After the effect above: a canvas the user can see may be moved by them.
    if (active && ready) frameMovedRef.current = true;
  }, [active, ready]);

  useEffect(() => {
    const view = pendingViewRef.current;
    const target = iframeRef.current?.contentWindow;
    if (!view || !ready || !target) return;
    pendingViewRef.current = null;
    frameMovedRef.current = true;
    setSyncingView(pendingKindRef.current);
    target.postMessage({ source: HTML_VISUAL_EDITOR_PARENT_SOURCE, type: 'view', view }, '*');
    // The frame answers within its own replay budget; never leave the status
    // line on "opening" for a frame that stopped answering.
    window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => setSyncingView(false), 12000);
  }, [frame.token, ready, viewRequest]);

  useEffect(() => () => window.clearTimeout(syncTimerRef.current), []);

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
    else if (visualValueRef.current !== frameValueRef.current) rebuildFrame(visualValueRef.current, { keepPlace: true });
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
    if (showSource) return t('htmlEditor.advancedMode');
    if (error) return error;
    if (syncingView === 'own') return t('htmlEditor.keepingPlace');
    if (syncingView) return t('htmlEditor.syncingView');
    if (selection) return t('htmlEditor.selected', { label: elementLabel(selection.label, t) });
    if (!ready) return t('htmlEditor.preparing');
    if (editableCount === 0) return t('htmlEditor.noEditable');
    if (editMode === 'navigate') return t('htmlEditor.mode.navigateGuidance');
    return t('htmlEditor.clickToEdit');
  }, [editMode, editableCount, error, ready, selection, showSource, syncingView, t]);

  return (
    <div className="artifact-html-visual-editor">
      {/* Only while on screen: hidden behind the Preview, the editor stays
          mounted but its controls leave the panel to whatever is open. */}
      {active && (
        <LiveEditControls
          target={controlsTarget}
          heading={showSource ? t('htmlEditor.htmlSource') : t('htmlEditor.editing')}
          guidance={guidance}
          isError={!!error && !showSource}
          active={!!selection}
          changes={changes.map((change) => ({
            id: change.id,
            label: elementLabel(change.label, t),
            text: htmlText(change.after),
            was: htmlText(change.before),
          }))}
          onUndoChange={undoChange}
          advanced={{ on: showSource, onToggle: toggleSource }}
          editActions={editActions}
        />
      )}
      {showSource && (
        <section className="artifact-source-pane artifact-html-source-pane" aria-label={t('htmlEditor.sourceAriaLabel')}>
          <div className="artifact-pane-label section-label">
            <span>{t('htmlEditor.htmlSource')}</span>
            <code>{source.path}</code>
          </div>
          <textarea
            ref={textareaRef}
            className="artifact-source-textarea"
            aria-label={t('sourceEditor.editAriaLabel', { path: source.path })}
            spellCheck={false}
            value={value}
            onChange={(event) => {
              visualValueRef.current = event.target.value;
              onChange(event.target.value);
            }}
            onSelect={reportSourceSelection}
          />
        </section>
      )}
      {/* Hidden, not unmounted, behind the source view: the page keeps the
          slide or section the user had moved it to. */}
      <div className="artifact-html-edit-canvas" hidden={showSource}>
        {/* Over the page, where Comments has its Navigate / Comment. */}
        {ready && editableCount > 0 && <EditModeSwitch mode={editMode} onChange={changeEditMode} />}
        {!inlined.pending && (
          <iframe
            key={frame.key}
            ref={iframeRef}
            title={t('htmlEditor.canvasTitle')}
            srcDoc={inlined.content}
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
        )}
      </div>
    </div>
  );
}

export default ArtifactHtmlVisualEditor;
