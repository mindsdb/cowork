import { useEffect, useRef } from 'react';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { ArtifactHtmlVisualEditor, ExitLiveEditButton } from './ArtifactHtmlVisualEditor';
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
  // Leaves Live edit; given when the viewer's toolbar (and its toggle) is hidden.
  onExit = null,
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
        onExit={onExit}
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
      <section className="artifact-source-pane" aria-label={t('sourceEditor.source')}>
        <div className="artifact-pane-label section-label">
          <span>{t('sourceEditor.sourceLabel')}</span>
          <code>{source.path}</code>
          {onExit && <ExitLiveEditButton onExit={onExit} />}
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
