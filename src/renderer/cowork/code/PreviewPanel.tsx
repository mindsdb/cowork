import { useEffect, useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { host } from '../../platform/host';
import './preview-panel.css';


type Viewport = 'responsive' | 'tablet' | 'mobile';

const viewportWidths: Record<Viewport, string> = {
  responsive: '100%',
  tablet: '768px',
  mobile: '390px',
};


export function PreviewPanel({
  open,
  url,
  onClose,
}: {
  open: boolean;
  url: string | null;
  onClose: () => void;
}) {
  const [generation, setGeneration] = useState(0);
  const [viewport, setViewport] = useState<Viewport>('responsive');

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <>
      <button type="button" className="code-preview-scrim" aria-label="Close preview" onClick={onClose} />
      <aside id="code-preview-panel" className="code-preview" aria-label="Live preview">
        <header className="code-preview__header">
          <div>
            <div className="code-eyebrow">PROJECT ACTION</div>
            <div className="code-preview__title">Preview</div>
          </div>
          <div className="code-preview__actions">
            <Button icon size="sm" variant="subtle" aria-label="Reload preview" disabled={!url} onClick={() => setGeneration((current) => current + 1)}>{Ico.reload(13)}</Button>
            <Button icon size="sm" variant="subtle" aria-label="Open preview in browser" disabled={!url} onClick={() => { if (url) void host.openExternal(url); }}>{Ico.arrowUpRight(13)}</Button>
            <Button icon size="sm" variant="subtle" aria-label="Close preview" onClick={onClose}>{Ico.close(14)}</Button>
          </div>
        </header>
        <div className="code-preview__toolbar">
          <code title={url || undefined}>{url || 'Preview is not available'}</code>
          <div className="code-preview__viewports" aria-label="Preview width">
            {(['responsive', 'tablet', 'mobile'] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={viewport === value ? 'is-active' : ''}
                aria-label={`${value} preview`}
                aria-pressed={viewport === value}
                onClick={() => setViewport(value)}
              >
                {value === 'responsive' ? Ico.computer(13) : value === 'tablet' ? Ico.appWindow(13) : Ico.phone(13)}
              </button>
            ))}
          </div>
        </div>
        <div className="code-preview__stage">
          {url ? (
            <iframe
              key={`${url}:${generation}`}
              title="Project preview"
              src={url}
              style={{ width: viewportWidths[viewport] }}
              sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="code-preview__empty">
              <span>{Ico.globe(20)}</span>
              <strong>No local preview yet</strong>
              <p>Run a project action that listens on the task’s development port.</p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
