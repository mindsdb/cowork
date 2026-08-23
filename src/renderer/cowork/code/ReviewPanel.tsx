import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { ConfirmModal } from '../components/ConfirmModal';
import { host } from '../../platform/host';
import type { CodingSession, DiffFile, GitState } from './api';
import { compactPath, diffStats, isActiveStatus } from './presentation';


type ReviewStyle = CSSProperties & { '--code-review-width': string };


export function ReviewPanel({
  open,
  session,
  git,
  files,
  busy,
  error,
  onClose,
  onBranch,
  onCommit,
  onApply,
}: {
  open: boolean;
  session: CodingSession;
  git: GitState | null;
  files: DiffFile[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onBranch: (name: string) => Promise<void>;
  onCommit: (message: string) => Promise<void>;
  onApply: () => Promise<void>;
}) {
  const [tab, setTab] = useState<'changes' | 'git'>('changes');
  const [branch, setBranch] = useState('');
  const [message, setMessage] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [width, setWidth] = useState(460);
  const { additions, deletions } = diffStats(files);
  const active = isActiveStatus(session.status);
  const directFolderWithoutDiff = session.workspace_kind === 'direct_folder' && files.length === 0;

  useEffect(() => {
    setTab('changes');
    setBranch('');
    setMessage('');
    setApplyOpen(false);
  }, [session.id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !applyOpen) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyOpen, onClose, open]);

  const widthFromPointer = (clientX: number) => Math.min(640, Math.max(340, window.innerWidth - clientX));
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setWidth(widthFromPointer(event.clientX));
  };

  if (!open) return null;

  return (
    <>
      <button type="button" className="code-review-scrim" aria-label="Close review panel" onClick={onClose} />
      <aside
        id="code-review-panel"
        className="code-review"
        aria-label="Review changes"
        style={{ '--code-review-width': `${width}px` } as ReviewStyle}
      >
        <div
          className="code-review__resize"
          role="separator"
          aria-label="Resize review panel"
          aria-orientation="vertical"
          aria-valuemin={340}
          aria-valuemax={640}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={startResize}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(widthFromPointer(event.clientX));
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              setWidth((current) => Math.min(640, Math.max(340, current + (event.key === 'ArrowLeft' ? 20 : -20))));
            }
          }}
        />
        <header className="code-review__header">
          <div>
            <div className="code-eyebrow">TASK OUTPUT</div>
            <div className="code-review__title">Review changes</div>
          </div>
          <Button icon size="sm" variant="subtle" aria-label="Close review panel" onClick={onClose}>{Ico.close(14)}</Button>
        </header>
        <div className="code-review__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'is-active' : ''} onClick={() => setTab('changes')}>
            Changes <span>{files.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'git'} className={tab === 'git' ? 'is-active' : ''} onClick={() => setTab('git')}>Handoff</button>
        </div>
        {error && <div className="code-review__error"><Alert variant="danger">{error}</Alert></div>}

        {tab === 'changes' ? (
          <div className="code-review__body scroll-clean">
            <div className="code-review__summary">
              <span>{files.length
                ? `${files.length} changed ${files.length === 1 ? 'file' : 'files'}`
                : directFolderWithoutDiff ? 'Change tracking unavailable' : 'Working tree unchanged'}</span>
              {files.length > 0 && <><span className="code-diff-add">+{additions}</span><span className="code-diff-del">−{deletions}</span></>}
            </div>
            {files.length === 0 && (
              <div className="code-review__empty">
                <span>{Ico.code(18)}</span>
                <strong>{directFolderWithoutDiff ? 'Open the folder to review changes' : 'No changes to review yet'}</strong>
                <p>{directFolderWithoutDiff
                  ? 'Direct folders do not have a Git baseline, so Cowork cannot build an inline diff.'
                  : 'File changes will collect here while the agent works.'}</p>
              </div>
            )}
            {files.map((file, index) => (
              <details className="code-diff-file" key={file.path} open={index === 0}>
                <summary>
                  <span className="code-diff-file__status">{file.status.trim() || 'M'}</span>
                  <span className="code-diff-file__path">{file.path}</span>
                  <span className="code-diff-add">+{file.additions}</span>
                  <span className="code-diff-del">−{file.deletions}</span>
                  <span className="code-diff-file__chevron">{Ico.chevDown(11)}</span>
                </summary>
                <pre>{file.patch || (file.binary ? 'Binary file changed' : 'No textual diff')}</pre>
              </details>
            ))}
          </div>
        ) : (
          <div className="code-review__body code-git-panel scroll-clean">
            <section className="code-handoff-summary">
              <div className="code-handoff-summary__row">
                <span>Task workspace</span>
                <code title={session.workspace_path}>{compactPath(session.workspace_path)}</code>
              </div>
              <div className="code-handoff-summary__row">
                <span>Source</span>
                <code title={session.source_path}>{compactPath(session.source_path)}</code>
              </div>
              {session.base_revision && (
                <div className="code-handoff-summary__row">
                  <span>Branch</span>
                  <Badge size="xs" variant={git?.detached ? 'muted' : 'accent'}>{git?.branch || 'Detached HEAD'}</Badge>
                </div>
              )}
            </section>
            <div className="code-git-open-actions">
              <Button size="sm" variant="subtle" onClick={() => void host.openPath(session.workspace_path)}>{Ico.openFolder(13)} Open task workspace</Button>
              {session.source_path !== session.workspace_path && <Button size="sm" variant="subtle" onClick={() => void host.openPath(session.source_path)}>Open source</Button>}
            </div>
            {session.source_dirty && <Alert variant="warning" title="Source changed since this task began">Cowork will check for conflicts before applying.</Alert>}
            {session.base_revision ? (
              <>
                <section className="code-handoff-primary">
                  <div>
                    <div className="code-field-label">Bring this work back</div>
                    <p>Apply the reviewed changes to the source folder.</p>
                  </div>
                  <Button variant="primary" size="sm" disabled={active || busy || files.length === 0} onClick={() => setApplyOpen(true)}>
                    Apply to source
                  </Button>
                </section>
                <details className="code-git-advanced">
                  <summary>More Git actions <span>{Ico.chevDown(11)}</span></summary>
                  <div className="code-git-advanced__body">
                    <div className="code-git-action">
                      <div className="code-field-label">Create a branch in the task worktree</div>
                      <div className="code-inline-form"><Input value={branch} onChange={setBranch} placeholder="feature/my-change" variant="mono" disabled={active || busy} /><Button size="sm" disabled={!branch.trim() || active || busy} onClick={async () => { try { await onBranch(branch.trim()); setBranch(''); } catch { /* Parent renders the failure. */ } }}>Create</Button></div>
                    </div>
                    <div className="code-git-action">
                      <div className="code-field-label">Commit all task changes</div>
                      <div className="code-inline-form"><Input value={message} onChange={setMessage} placeholder="Describe the change" disabled={active || busy} /><Button size="sm" disabled={!message.trim() || active || busy} onClick={async () => { try { await onCommit(message.trim()); setMessage(''); } catch { /* Parent renders the failure. */ } }}>Commit</Button></div>
                    </div>
                  </div>
                </details>
              </>
            ) : <p className="code-empty-copy">This task already works in the selected folder, so there is nothing to apply.</p>}
          </div>
        )}
        <ConfirmModal
          open={applyOpen}
          title="Apply changes to the source folder?"
          message={`Update ${session.source_path} with the reviewed task changes? Cowork will stop if it finds a conflict.`}
          confirmLabel="Apply changes"
          busy={busy}
          onClose={() => { if (!busy) setApplyOpen(false); }}
          onConfirm={async () => { try { await onApply(); setApplyOpen(false); } catch { /* Keep open when preflight fails. */ } }}
        />
      </aside>
    </>
  );
}
