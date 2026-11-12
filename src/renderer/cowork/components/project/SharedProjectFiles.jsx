import { useEffect, useRef, useState } from 'react';
import { downloadSharedProjectFile, listSharedProjectFiles, readSharedProjectFile } from '../../api';
import { projectLabel } from '../../lib/projectLabel';
import { Button } from '../ui';
import { Crumb, CrumbCurrent, CrumbSep } from '../ui/Crumb';
import SharedProjectReference from './SharedProjectReference';
import { useTranslation } from '../../../lib/i18n';

/** A recipient never mounts the owner workspace, instructions, or HTML preview. */
export default function SharedProjectFiles({ project, onShowAll }) {
  const { t } = useTranslation('projects');
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [content, setContent] = useState(null);
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const readVersion = useRef(0);

  useEffect(() => {
    let alive = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const data = await listSharedProjectFiles(project.id);
        if (!alive) return;
        setFiles(data.files);
        setTruncated(!!data.truncated);
        setError('');
      } catch {
        if (!alive) return;
        readVersion.current += 1;
        setFiles([]);
        setSelected(null);
        setContent(null);
        setError(t('sharedProjectFiles.unavailable'));
      } finally {
        pending = false;
        if (alive) setLoading(false);
      }
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      readVersion.current += 1;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [project.id]);

  const openFile = async (file) => {
    const version = ++readVersion.current;
    setSelected(file);
    setContent(null);
    setFileError('');
    try {
      const data = await readSharedProjectFile(project.id, file.path);
      if (version === readVersion.current) setContent(data.content);
    } catch {
      if (version === readVersion.current) setFileError(t('sharedProjectFiles.notText'));
    }
  };

  const download = async () => {
    try {
      const blob = await downloadSharedProjectFile(project.id, selected.path);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = selected.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setContent(null);
      setFileError(t('sharedProjectFiles.downloadUnavailable'));
    }
  };

  return (
    <section className="flex-1 min-h-0 overflow-auto font-body text-ink-2" aria-label={t('sharedProjectFiles.ariaLabel')}>
      <div className="flex items-center gap-2 px-7 py-4 border-b border-solid border-line">
        <Crumb label={t('sharedProjectFiles.projectsCrumb')} onClick={onShowAll} title={t('sharedProjectFiles.allProjects')} />
        <CrumbSep />
        <CrumbCurrent label={projectLabel(project)} />
      </div>
      <div className="max-w-[960px] mx-auto px-7 py-8 flex flex-col gap-5">
        <div>
          <p className="text-xs font-semibold text-accent">{t('sharedProjectFiles.sharedReadOnly')}</p>
          <h1 className="font-display text-2xl text-ink mt-2">{projectLabel(project)}</h1>
          <SharedProjectReference project={project} />
          <p className="text-sm mt-2 text-ink-3">{t('sharedProjectFiles.intro')}</p>
        </div>
        {error ? <p role="alert">{error}</p> : loading ? <p role="status">{t('sharedProjectFiles.loadingFiles')}</p> : (
          <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-5">
            <div className="flex flex-col gap-1 min-w-0">
              <h2 className="text-sm font-semibold mb-2">{t('sharedProjectFiles.files')}</h2>
              {!files.length && <p className="text-sm text-ink-3">{t('sharedProjectFiles.noFiles')}</p>}
              {files.map((file) => (
                <button key={file.path} type="button" onClick={() => openFile(file)}
                  aria-pressed={selected?.path === file.path}
                  className={`text-left text-sm truncate px-3 py-2 rounded-md border-0 cursor-pointer ${selected?.path === file.path ? 'bg-surface-2 text-ink' : 'bg-transparent text-ink-2 hover:bg-surface-2'}`}>
                  {file.path}
                </button>
              ))}
              {truncated && <p className="text-xs text-ink-3">{t('sharedProjectFiles.truncated')}</p>}
            </div>
            <div className="min-w-0 rounded-lg border border-solid border-line p-4">
              {selected ? <>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h2 className="text-sm font-semibold break-all">{selected.path}</h2>
                  <Button size="sm" onClick={download}>{t('sharedProjectFiles.download')}</Button>
                </div>
                {fileError ? <p role="alert" className="text-sm">{fileError}</p>
                  : content === null ? <p role="status">{t('sharedProjectFiles.loadingFile')}</p>
                    : <pre className="text-xs font-mono whitespace-pre-wrap break-words">{content}</pre>}
              </> : <p className="text-sm text-ink-3">{t('sharedProjectFiles.selectFile')}</p>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
