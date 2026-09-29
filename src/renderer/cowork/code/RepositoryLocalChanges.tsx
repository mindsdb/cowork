import { useState } from 'react';
import { AlertCircle, ChevronRight, FileText } from 'lucide-react';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import { codingApi, type DiffFile } from './api';
import { DiffPatchView } from './DiffPatchView';
import type { RepositoryStatus } from './repositorySetupModels';

export function RepositoryLocalChanges({
  projectId,
  name,
  status,
}: {
  projectId: string;
  name: string;
  status: RepositoryStatus;
}) {
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
      setError(reason instanceof Error ? reason.message : 'Could not load local changes. Try again.');
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="code-repository-changes" aria-label={`${name} local changes`}>
      <div className="code-repository-changes__heading">
        <span>
          <AlertCircle size={15} />
          {name} has {status.change_count} local {status.change_count === 1 ? 'change' : 'changes'}
        </span>
        <Button size="sm" variant="subtle" onClick={() => void toggle()} aria-expanded={open}>
          {open ? 'Hide diff' : 'View diff'}
        </Button>
      </div>
      {!open && (
        <ul>
          {status.changes.map((path) => (
            <li key={path}>
              <FileText size={13} />
              <span>{path}</span>
            </li>
          ))}
          {status.change_count > status.changes.length && (
            <li>{status.change_count - status.changes.length} more files</li>
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
                Close and retry
              </Button>
            </Alert>
          ) : files?.length ? (
            files.map((file) => (
              <details key={file.path}>
                <summary>
                  <ChevronRight size={13} />
                  <span>{file.path}</span>
                  <small>
                    +{file.additions} −{file.deletions}
                  </small>
                </summary>
                {file.binary ? (
                  <p>Binary file changed.</p>
                ) : (
                  <DiffPatchView patch={file.patch} onSelectionChange={() => {}} />
                )}
              </details>
            ))
          ) : (
            <p>No local changes remain. Refresh to update this panel.</p>
          )}
        </div>
      )}
    </section>
  );
}
