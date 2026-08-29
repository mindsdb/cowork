import { useEffect, useRef } from 'react';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { ArtifactHtmlVisualEditor } from './ArtifactHtmlVisualEditor';

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
  onTextSelection,
}) {
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
      <section className="artifact-source-pane" aria-label="Artifact source">
        <div className="artifact-pane-label">
          <span>Source</span>
          <code>{source.path}</code>
        </div>
        <textarea
          ref={editorRef}
          className="artifact-source-textarea"
          aria-label={`Edit ${source.path}`}
          spellCheck={isMarkdown}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onSelect={reportSelection}
        />
      </section>
      {isMarkdown && (
        <section className="artifact-render-pane" aria-label="Markdown preview">
          <div className="artifact-pane-label"><span>Preview</span><em>Updates as you type</em></div>
          <div className="artifact-markdown-preview">
            <MarkdownContent text={value} id={`${source.artifactId}:draft`} />
          </div>
        </section>
      )}
    </div>
  );
}

export default ArtifactSourceEditor;
