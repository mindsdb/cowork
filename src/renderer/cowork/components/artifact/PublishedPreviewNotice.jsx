import Ico from '../Icons';
import { Button } from '../ui';
import { host } from '../../../platform/host';
import { useTranslation } from '../../../lib/i18n';

const FONT_BODY = "'Inter', system-ui, sans-serif";
const COVER = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 28 };
const MESSAGE = { color: 'var(--ink-2)', fontSize: 13, textAlign: 'center', maxWidth: 460, fontFamily: FONT_BODY };
const ACTIONS = { display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 };

// Only a transient failure (rate limit, a view host not answering) may load on
// a reload; the others need the user or the app to change first.
const RELOADABLE = new Set(['retry']);

/** Why a published app has no preview, with a way to its published page. */
export function PublishedPreviewNotice({ message, reason, url, onReload }) {
  const { t } = useTranslation('artifacts');
  return (
    <div style={COVER}>
      <div role="status">
        <div style={MESSAGE}>{message}</div>
        <div style={ACTIONS}>
          {RELOADABLE.has(reason) && onReload && (
            <Button onClick={onReload}>{Ico.reload(14)} {t('header.reloadPreview')}</Button>
          )}
          {url && (
            <Button onClick={() => host.openExternal(url)}>{Ico.externalLink(14)} {t('viewer.openPublishedPage')}</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Over the app's frame once its token is about to expire: from then on its
 * requests fail (after the frame script waits for a refresh nobody answers)
 * and its links open blank. The body makes the frame inert, so keys stop
 * reaching it too, and focus moves to Reload.
 */
export function PublishedSessionEnded({ onReload }) {
  const { t } = useTranslation('artifacts');
  return (
    <div data-testid="published-session-ended" style={{ ...COVER, zIndex: 2, background: 'var(--surface)' }}>
      <div role="status">
        <div style={MESSAGE}>{t('viewer.publishedSessionEnded')}</div>
        <div style={ACTIONS}>
          <Button onClick={onReload} autoFocus>{Ico.reload(14)} {t('header.reloadPreview')}</Button>
        </div>
      </div>
    </div>
  );
}
