import { useState } from 'react';
import { AlertCircle, ChevronRight, FileText } from 'lucide-react';
import { Icon } from '../components/ui/Icon';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import { codingApi, type DiffFile } from './api';
import { DiffPatchView } from './DiffPatchView';
import type { RepositoryStatus } from './repositorySetupModels';
import { useTranslation } from '../../lib/i18n';

export function RepositoryLocalChanges({
  projectId,
  name,
  status,
}: {
  projectId: string;
  name: string;
  status: RepositoryStatus;
}) {
  const { t } = useTranslation('code');
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    setError('');
    try {
      setFiles((await codingApi.repositoryDiff(projectId, status.resource_id)).files);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('repositoryLocalChanges.loadError'));
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="code-repository-changes" aria-label={t('repositoryLocalChanges.ariaLabel', { name })}>
      <div className="code-repository-changes__heading">
        <span>
          <Icon of={AlertCircle} size={16} />
          {t('repositoryLocalChanges.heading', { name, count: status.change_count })}
        </span>
        <Button size="sm" variant="subtle" onClick={() => void toggle()} aria-expanded={open}>
          {open ? t('repositoryLocalChanges.hideDiff') : t('repositoryLocalChanges.viewDiff')}
        </Button>
      </div>
      {!open && (
        <ul>
          {status.changes.map((path) => (
            <li key={path}>
              <Icon of={FileText} size={14} />
              <span>{path}</span>
            </li>
          ))}
          {status.change_count > status.changes.length && (
            <li>{t('repositoryLocalChanges.moreFiles', { count: status.change_count - status.changes.length })}</li>
          )}
        </ul>
      )}
      {open && (
        <div className="code-repository-changes__diff">
          {loading ? (
            <Spinner />
          ) : error ? (
            <Alert variant="danger">
              {error}
              <Button
                size="sm"
                variant="subtle"
                onClick={() => {
                  setOpen(false);
                }}
              >
                {t('repositoryLocalChanges.closeAndRetry')}
              </Button>
            </Alert>
          ) : files?.length ? (
            files.map((file) => (
              <details key={file.path}>
                <summary>
                  <Icon of={ChevronRight} size={14} />
                  <span>{file.path}</span>
                  <small>
                    +{file.additions} −{file.deletions}
                  </small>
                </summary>
                {file.binary ? (
                  <p>{t('repositoryLocalChanges.binary')}</p>
                ) : (
                  <DiffPatchView patch={file.patch} onSelectionChange={() => {}} />
                )}
              </details>
            ))
          ) : (
            <p>{t('repositoryLocalChanges.noChanges')}</p>
          )}
        </div>
      )}
    </section>
  );
}
