import { useEffect, useMemo, useRef, useState } from 'react';

import { MarkdownContent } from '../components/markdown/MarkdownContent';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { Modal, ModalBody, ModalHeader } from '../components/ui/Modal';
import Select from '../components/ui/Select';
import Spinner from '../components/ui/Spinner';
import { codingApi, type SkillLibraryDocument, type SkillLibraryItem } from './api';
import './skill-detail.css';

interface ParsedSkillContent {
  body: string;
  metadata: Array<{ label: string; value: string }>;
}

function parseSkillContent(content: string): ParsedSkillContent {
  if (!content.startsWith('---\n')) return { body: content, metadata: [] };
  const closing = content.indexOf('\n---', 4);
  if (closing < 0) return { body: content, metadata: [] };

  const metadata = content.slice(4, closing).split('\n').flatMap((line) => {
    const separator = line.indexOf(':');
    if (separator < 1) return [];
    const label = line.slice(0, separator).trim().replace(/-/g, ' ');
    const value = line.slice(separator + 1).trim();
    return label && value ? [{ label, value }] : [];
  });
  return { metadata, body: content.slice(closing + 4).trimStart() };
}

function kindLabel(kind: SkillLibraryItem['kind']): string {
  if (kind === 'instructions') return 'Instructions';
  if (kind === 'workflow') return 'Workflow';
  return 'Skill';
}

export function SkillDetailModal({
  item,
  onClose,
}: {
  item: SkillLibraryItem | null;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<SkillLibraryDocument | null>(null);
  const [requestedFile, setRequestedFile] = useState<{ itemId: string; path?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSource, setShowSource] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const requestId = useRef(0);
  const selectedPath = item && requestedFile?.itemId === item.id ? requestedFile.path : undefined;

  useEffect(() => {
    if (!item) return undefined;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    codingApi.skillDocument(item.id, selectedPath)
      .then((nextDocument) => {
        if (currentRequest === requestId.current) setDocument(nextDocument);
      })
      .catch((reason) => {
        if (currentRequest !== requestId.current) return;
        setDocument(null);
        setError(reason instanceof Error ? reason.message : 'Could not load this skill.');
      })
      .finally(() => {
        if (currentRequest === requestId.current) setLoading(false);
      });
    return () => { requestId.current += 1; };
  }, [item, retryToken, selectedPath]);

  useEffect(() => {
    setShowSource(false);
  }, [item?.id]);

  const parsed = useMemo(() => parseSkillContent(document?.content || ''), [document?.content]);
  const displayedDocument = document?.item.id === item?.id ? document : null;
  const subtitle = item
    ? `${item.source_name} · ${kindLabel(item.kind)}${item.version ? ` · ${item.version.slice(0, 8)}` : ''}`
    : '';

  return (
    <Modal open={!!item} onClose={onClose} size="md" labelledBy="skill-detail-title" maxHeight="min(760px, 88vh)">
      <ModalHeader
        id="skill-detail-title"
        title={item?.name || 'Skill'}
        subtitle={subtitle}
        onClose={onClose}
        right={displayedDocument && !loading ? (
          <Button size="sm" variant="subtle" onClick={() => setShowSource((value) => !value)}>
            {Ico.code(13)} {showSource ? 'Rendered' : 'View source'}
          </Button>
        ) : undefined}
      />
      <ModalBody padding="0" background="var(--bg)">
        {loading && !displayedDocument ? (
          <div className="code-skill-detail__state" role="status"><Spinner /> Loading skill…</div>
        ) : error ? (
          <div className="code-skill-detail__state is-error">
            <Alert variant="danger">{error}</Alert>
            <Button size="sm" variant="subtle" onClick={() => setRetryToken((value) => value + 1)}>Try again</Button>
          </div>
        ) : displayedDocument ? (
          <article className="code-skill-detail">
            <div className="code-skill-detail__document-bar">
              <span aria-hidden="true">{item?.kind === 'skill' ? Ico.cube(14) : Ico.code(14)}</span>
              {displayedDocument.files.length > 1 ? (
                <Select
                  value={displayedDocument.selected_path}
                  onValueChange={(path) => setRequestedFile({ itemId: displayedDocument.item.id, path })}
                  options={displayedDocument.files.map((path) => ({ value: path, label: path }))}
                  variant="unstyled"
                  size="sm"
                  menuLabel="Files"
                  ariaLabel="Skill file"
                  className="code-skill-detail__file-picker"
                />
              ) : <code>{displayedDocument.selected_path}</code>}
              {loading && <Spinner className="code-skill-detail__loading" />}
            </div>
            {showSource ? (
              <pre className="code-skill-detail__source">{displayedDocument.content}</pre>
            ) : (
              <div className="code-skill-detail__content">
                {parsed.metadata.length > 0 && (
                  <dl className="code-skill-detail__metadata">
                    {parsed.metadata.map(({ label, value }, index) => (
                      <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>
                    ))}
                  </dl>
                )}
                <MarkdownContent
                  id={`skill-document-${displayedDocument.item.id}-${displayedDocument.selected_path}`}
                  text={parsed.body}
                  complete
                  enableForms={false}
                  enableCharts={false}
                  isAssistant={false}
                />
              </div>
            )}
          </article>
        ) : null}
      </ModalBody>
    </Modal>
  );
}
