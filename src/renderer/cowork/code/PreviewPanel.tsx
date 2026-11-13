import { useEffect, useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { getApiOrigin } from '../../platform/host';
import { safeCodeExternalUrl } from './developerTools';
import { openCodeExternalUrl } from './shellLinks';
import { useTranslation } from '../../lib/i18n';
import './preview-panel.css';


type Viewport = 'responsive' | 'tablet' | 'mobile';

const viewportWidths: Record<Viewport, string> = {
  responsive: '100%',
  tablet: '768px',
  mobile: '390px',
};

// The frame keeps allow-same-origin (see below), so a page on this app's own
// origin could reach the parent document and lift its sandbox.
function framablePreviewUrl(url: string | null): string | null {
  const safe = safeCodeExternalUrl(url);
  return safe && new URL(safe).origin !== getApiOrigin() ? safe : null;
}


export function PreviewPanel({
  open,
  url,
  onClose,
}: {
  open: boolean;
  url: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('code');
  const [generation, setGeneration] = useState(0);
  const [viewport, setViewport] = useState<Viewport>('responsive');
  const previewUrl = framablePreviewUrl(url);

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
      <button type="button" className="code-preview-scrim" aria-label={t('previewPanel.closeAriaLabel')} onClick={onClose} />
      <aside id="code-preview-panel" className="code-preview" aria-label={t('previewPanel.ariaLabel')}>
        <header className="code-preview__header">
          <div>
            <div className="section-label">{t('previewPanel.eyebrow')}</div>
            <div className="code-preview__title">{t('previewPanel.title')}</div>
          </div>
          <div className="code-preview__actions">
            <Button icon size="sm" variant="subtle" aria-label={t('previewPanel.reloadAriaLabel')} disabled={!previewUrl} onClick={() => setGeneration((current) => current + 1)}>{Ico.reload(14)}</Button>
            <Button icon size="sm" variant="subtle" aria-label={t('previewPanel.openInBrowserAriaLabel')} disabled={!previewUrl} onClick={() => void openCodeExternalUrl(previewUrl)}>{Ico.arrowUpRight(14)}</Button>
            <Button icon size="sm" variant="subtle" aria-label={t('previewPanel.closeAriaLabel')} onClick={onClose}>{Ico.close(14)}</Button>
          </div>
        </header>
        <div className="code-preview__toolbar">
          <code title={previewUrl || undefined}>{previewUrl || t('previewPanel.unavailable')}</code>
          <ToggleGroup
            size="sm"
            className="code-preview__viewports"
            aria-label={t('previewPanel.widthAriaLabel')}
            value={viewport}
            onValueChange={(value) => setViewport(value as Viewport)}
            options={[
              { value: 'responsive', label: Ico.computer(14), 'aria-label': t('previewPanel.responsiveAriaLabel') },
              { value: 'tablet', label: Ico.appWindow(14), 'aria-label': t('previewPanel.tabletAriaLabel') },
              { value: 'mobile', label: Ico.phone(14), 'aria-label': t('previewPanel.mobileAriaLabel') },
            ]}
          />
        </div>
        <div className="code-preview__stage">
          {previewUrl ? (
            <iframe
              key={`${previewUrl}:${generation}`}
              title={t('previewPanel.frameTitle')}
              src={previewUrl}
              style={{ width: viewportWidths[viewport] }}
              // allow-same-origin stays: the framed page is the task's own dev
              // server on a loopback origin distinct from this app's, and module
              // scripts (Vite) are CORS-fetched, which an opaque origin cannot do.
              sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
              referrerPolicy="no-referrer"
            />
          ) : (
            <EmptyState
              size="sm"
              className="code-preview__empty"
              icon={Ico.globe(20)}
              title={t('previewPanel.empty.title')}
              description={t('previewPanel.empty.description')}
            />
          )}
        </div>
      </aside>
    </>
  );
}
