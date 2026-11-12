// Terms consent, arcade edition. Same legal gate as before — full
// documents one click away, explicit checkbox, same consent sentence —
// only the framing changed (a retro "license agreement" dialog).

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArcadeShell } from './components';
import { PixelSprite } from './sprites';
import { TERMS_TEXT, PRIVACY_TEXT } from './legalText';
import { STOCK_PRODUCT_NAME } from '../../../shared/product-name';
import { useTranslation } from '../../lib/i18n';

type View = 'main' | 'terms' | 'privacy';

/**
 * Accessible modal for the full legal documents. Owns its own focus
 * management (focus in on open, trap Tab within the dialog, Escape to
 * close, restore focus to the trigger on close) so the consent screen
 * stays simple and rule-of-hooks-safe.
 */
export function LegalViewer({ doc, onClose }: { doc: 'terms' | 'privacy'; onClose: () => void }) {
  const { t } = useTranslation('setup');
  const isTerms = doc === 'terms';
  const dialogRef = useRef<HTMLDivElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    backBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      // Trap Tab within the dialog's focusable elements.
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      prevFocus?.focus?.();
    };
  }, [onClose]);

  // Portaled to <body> so it floats above the titlebar drag overlay.
  return createPortal(
    <div className="arc-legal-overlay" onClick={onClose}>
      <div
        className="arc-legal"
        role="dialog"
        aria-modal="true"
        aria-label={isTerms ? t('legal.terms') : t('legal.privacy')}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="arc-legal-head">
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--arc-cyan, #3dd6f5)' }}>
            {isTerms ? t('legal.termsHeading') : t('legal.privacyHeading')}
          </span>
          <button type="button" className="arc-btn-ghost" onClick={onClose} ref={backBtnRef}>
            {t('legal.back')}
          </button>
        </div>
        <div className="arc-legal-body">
          <pre>{isTerms ? TERMS_TEXT : PRIVACY_TEXT}</pre>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function TermsScreen({ onAccept }: { onAccept: () => void }) {
  const { t } = useTranslation('setup');
  const [view, setView] = useState<View>('main');
  const [accepted, setAccepted] = useState(false);

  if (view === 'terms' || view === 'privacy') {
    return <LegalViewer doc={view} onClose={() => setView('main')} />;
  }

  return (
    <ArcadeShell title={t('terms.title')} subtitle={t('terms.subtitle')}>
      <div className="arc-stack arc-fade-in" style={{ gap: 26, width: 'min(560px, 100%)' }}>
        <PixelSprite name="scroll" size={64} title={t('terms.spriteTitle')} />

        <div style={{ fontSize: 12.5, lineHeight: 1.7, letterSpacing: '0.04em', color: 'var(--arc-muted)', textAlign: 'center', maxWidth: 440 }}>
          {t('terms.intro')}
        </div>

        <div className="arc-panel" style={{ width: '100%', boxSizing: 'border-box', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="arc-btn-ghost" style={{ flex: 1, minWidth: 180 }} onClick={() => setView('terms')}>
              {t('terms.readTerms')}
            </button>
            <button type="button" className="arc-btn-ghost" style={{ flex: 1, minWidth: 180 }} onClick={() => setView('privacy')}>
              {t('terms.readPrivacy')}
            </button>
          </div>

          {/* Not a <label>: the consent text embeds the Terms/Privacy
              link buttons, and nested interactive elements make native
              label→checkbox forwarding unreliable. The row itself
              toggles via onClick; the links stopPropagation. */}
          <div
            className="arc-check"
            onClick={() => setAccepted((a) => !a)}
          >
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              aria-label={t('terms.consentAriaLabel')}
            />
            <span className="arc-check-box" aria-hidden>{accepted ? '✓' : ''}</span>
            <span className="arc-check-text">
              {t('terms.consentBefore')}{' '}
              <button type="button" className="arc-link" onClick={(e) => { e.stopPropagation(); setView('terms'); }}>{t('legal.terms')}</button>
              {' '}{t('terms.consentAnd')}{' '}
              <button type="button" className="arc-link" onClick={(e) => { e.stopPropagation(); setView('privacy'); }}>{t('legal.privacy')}</button>.
              {' '}{t('terms.consentAfter')}
            </span>
          </div>
        </div>

        <button className="arc-btn arc-btn-green" disabled={!accepted} onClick={onAccept}>
          {t('terms.accept')}
        </button>

        <div style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--arc-dim)', textAlign: 'center', lineHeight: 1.6 }}>
          {t('terms.nextInstall', { product: STOCK_PRODUCT_NAME })}
          <br />{t('terms.takesAMinute')}
        </div>
      </div>
    </ArcadeShell>
  );
}
