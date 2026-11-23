import { useEffect, useRef } from 'react';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { ArtifactHtmlVisualEditor } from './ArtifactHtmlVisualEditor';
import { LiveEditControls } from './LiveEditPanel';
import { useTranslation } from '../../../../lib/i18n';

function extensionOf(path) {
  const match = String(path || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] || '';
}

export function ArtifactSourceEditor({
  source,
  value,
  onChange,
  onSave,
  draftUrl,
  loadImage = null,
  onTextSelection,
  active = true,
  previewView = null,
  // Where the user is in the HTML editor's canvas (ArtifactHtmlVisualEditor).
  onViewChange = null,
  // `{ dirty, saving, canEdit, onSave, onDiscard }`: Save and Discard, shown
  // in the Live edit panel while there is unsaved text.
  editActions = null,
  // The Live edit panel's slot (LiveEditPanel), where the editor's status and
  // Save / Discard render.
  controlsTarget = null,
}) {
  const { t } = useTranslation('artifacts');
  const editorRef = useRef(null);
  const ext = extensionOf(source?.path);
  const isMarkdown = ext === '.md';
  const isHtml = ext === '.html' || ext === '.htm';

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSave?.();
      }
    };
    const node = editorRef.current;
    node?.addEventListener('keydown', onKeyDown);
    return () => node?.removeEventListener('keydown', onKeyDown);
  }, [onSave]);

  if (isHtml) {
    return (
      <ArtifactHtmlVisualEditor
        source={source}
        value={value}
        onChange={onChange}
        onSave={onSave}
        draftUrl={draftUrl}
        onTextSelection={onTextSelection}
        active={active}
        previewView={previewView}
        onViewChange={onViewChange}
        editActions={editActions}
        controlsTarget={controlsTarget}
      />
    );
  }

  const reportSelection = () => {
    const node = editorRef.current;
    if (!node || node.selectionStart === node.selectionEnd) return;
    onTextSelection?.({
      type: 'text-range',
      path: source.path,
      start: node.selectionStart,
      end: node.selectionEnd,
      quote: value.slice(node.selectionStart, node.selectionEnd).slice(0, 500),
    });
  };

  return (
    <div className={`artifact-source-workbench ${isMarkdown ? 'is-split' : ''}`}>
      {active && (
        <LiveEditControls
          target={controlsTarget}
          heading={t('htmlEditor.editing')}
          guidance={source.path}
          editActions={editActions}
        />
      )}
      <section className="artifact-source-pane" aria-label={t('sourceEditor.source')}>
        <div className="artifact-pane-label section-label">
          <span>{t('sourceEditor.sourceLabel')}</span>
          <code>{source.path}</code>
        </div>
        <textarea
          ref={editorRef}
          className="artifact-source-textarea"
          aria-label={t('sourceEditor.editAriaLabel', { path: source.path })}
          spellCheck={isMarkdown}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onSelect={reportSelection}
        />
      </section>
      {isMarkdown && (
        <section className="artifact-render-pane" aria-label={t('sourceEditor.markdownPreview')}>
          <div className="artifact-pane-label section-label"><span>{t('sourceEditor.preview')}</span><em>{t('sourceEditor.live')}</em></div>
          <div className="artifact-markdown-preview">
            <MarkdownContent text={value} id={`${source.artifactId}:draft`} loadImage={loadImage} />
          </div>
        </section>
      )}
    </div>
  );
}

export default ArtifactSourceEditor;
