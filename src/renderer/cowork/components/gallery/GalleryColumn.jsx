import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../Icons';
import { Button } from '../ui';
import { useTranslation } from '../../../lib/i18n';
import { productName } from '../../../lib/deploymentBrand';
import { ALL_CATEGORIES, filterGallery } from './galleryFilter';
import { runMinutes, sendsAtOnce, takesOwnFile } from './galleryRules';
import { trackGalleryExampleOpened, trackGallerySearched } from '../../lib/analytics';

// How long a typed search must hold before it is recorded, so one search is
// one event rather than one per keystroke.
const SEARCH_SETTLE_MS = 1000;

const iconButton = 'w-8 h-8 shrink-0 rounded-md inline-grid place-items-center bg-transparent border border-line text-ink-3 hover:text-ink hover:bg-surface-2 cursor-pointer';

function Thumbnail({ src, className }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span aria-hidden="true" className={`${className} bg-surface-3`} />;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={`${className} object-cover bg-surface-3`} />;
}

function Meta({ entry }) {
  const { t } = useTranslation('shell');
  const minutes = runMinutes(entry.seconds);
  const parts = [entry.badge, minutes ? t('gallery.minutes', { count: minutes }) : null].filter(Boolean);
  return <span className="text-[12px] text-ink-3">{parts.join(' · ')}</span>;
}

function Row({ entry, onOpen, highlighted = false }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full flex items-center gap-3 p-2 rounded-lg border-0 text-left cursor-pointer font-[inherit] ${highlighted ? 'bg-[var(--surface-raised)]' : 'bg-transparent'} hover:bg-[var(--surface-raised)]`}
    >
      <Thumbnail src={entry.thumbnail} className="w-[104px] h-[64px] rounded-md shrink-0" />
      <span className="min-w-0 flex flex-col gap-1">
        <span className="text-[14px] font-semibold text-ink leading-snug">{entry.title}</span>
        <Meta entry={entry} />
      </span>
    </button>
  );
}

function AnswerBlocks({ answer }) {
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-2">
      {answer.blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === 'heading') return <h4 key={key} className="m-0 text-[13px] font-semibold text-ink">{block.text}</h4>;
        if (block.type === 'paragraph') return <p key={key} className="m-0">{block.text}</p>;
        if (block.type === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return <List key={key} className="m-0 pl-5 flex flex-col gap-1">{block.items.map((item) => <li key={item}>{item}</li>)}</List>;
        }
        return (
          <div key={key} className="overflow-x-auto">
            <table className="text-[12px] border-collapse">
              <thead><tr>{block.columns.map((c) => <th key={c} className="text-left font-semibold text-ink pr-3 pb-1">{c}</th>)}</tr></thead>
              <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} className="pr-3 py-0.5 align-top">{cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      })}
      {answer.draft && (
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 p-3">
          {answer.draft.label && <span className="text-[12px] font-semibold text-ink-3">{answer.draft.label}</span>}
          <p className="m-0 whitespace-pre-line">{answer.draft.text}</p>
        </div>
      )}
    </div>
  );
}

function FileLink({ file, isElectron, openExternal }) {
  const { t } = useTranslation('shell');
  const label = file.label || file.name;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
      <span className="min-w-0 flex flex-col">
        <span className="text-[13px] text-ink">{label}</span>
        {file.what && <span className="text-[12px] text-ink-3">{file.what}</span>}
      </span>
      {/* Desktop hands the file to the browser; on the web the console sends it
          as an attachment, so a plain link saves it. */}
      {isElectron
        ? <Button variant="subtle" size="sm" onClick={() => openExternal(file.href)}>{Ico.download(14)} {t('gallery.download')}</Button>
        : <a href={file.href} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-accent shrink-0">{t('gallery.download')}</a>}
    </div>
  );
}

function Example({ entry, openExternal }) {
  const { t } = useTranslation('shell');
  // A live example opens in the browser rather than in a frame here: the
  // shell policies keep our own app domains (the console among them) out of
  // frame-src, and on Desktop the main process would add the local server's
  // token to an unmarked frame's requests.
  const live = entry.example && (entry.example.viewUrl || entry.example.src);
  return (
    <div className="flex flex-col gap-2">
      <Thumbnail src={entry.thumbnail} className="w-full h-[220px] rounded-lg border border-line" />
      {live && (
        <Button variant="subtle" size="sm" className="self-start" onClick={() => openExternal(live)}>
          {Ico.externalLink(14)} {t('gallery.playInBrowser')}
        </Button>
      )}
    </div>
  );
}

function Detail({ entry, position, total, query, onBack, onStep, onCategory, onStart, onOwnWork, onHide, isElectron, openExternal, reserveCorner }) {
  const { t } = useTranslation('shell');
  const minutes = runMinutes(entry.seconds);
  const facts = [
    entry.model ? t('gallery.builtWith', { model: entry.model }) : null,
    minutes ? t('gallery.minutes', { count: minutes }) : null,
    entry.needs ? t('gallery.needs', { needs: entry.needs }) : null,
  ].filter(Boolean);
  const files = [...entry.files, ...(entry.sampleInput ? [{ ...entry.sampleInput, what: entry.sampleInput.what || t('gallery.sampleInput') }] : [])];
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
        <Button variant="subtle" size="sm" onClick={onBack}>
          {Ico.chevLeft(14)} {query ? t('gallery.backToResults', { query }) : t('gallery.backToAll')}
        </Button>
        <div className="flex items-center gap-1.5">
          <button type="button" className={iconButton} aria-label={t('gallery.previous')} disabled={position <= 1} onClick={() => onStep(-1)}>{Ico.chevLeft(14)}</button>
          <span className="text-[12px] text-ink-3 min-w-[44px] text-center" aria-live="polite">{t('gallery.position', { current: position, total })}</span>
          <button type="button" className={iconButton} aria-label={t('gallery.next')} disabled={position >= total} onClick={() => onStep(1)}>{Ico.chevRight(14)}</button>
          <button type="button" className={`${iconButton} ml-1`} aria-label={t('gallery.hide')} onClick={onHide}>{Ico.close(14)}</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        <nav aria-label={t('gallery.breadcrumb')} className="text-[12px] text-ink-3 flex items-center gap-1">
          <button type="button" className="bg-transparent border-0 p-0 text-ink-2 hover:text-ink cursor-pointer font-[inherit]" onClick={onBack}>{t('gallery.title')}</button>
          <span aria-hidden="true">›</span>
          <button type="button" className="bg-transparent border-0 p-0 text-ink-2 hover:text-ink cursor-pointer font-[inherit]" onClick={() => onCategory(entry.category)}>{entry.category}</button>
        </nav>
        <Example entry={entry} openExternal={openExternal} />
        <h3 className="m-0 text-[18px] font-semibold text-ink leading-snug">{entry.title}</h3>
        {entry.description && <p className="m-0 text-[13px] leading-relaxed text-ink-2">{entry.description}</p>}
        {entry.answer && (
          <section className="flex flex-col gap-2">
            <h4 className="m-0 text-[11px] font-semibold tracking-[0.06em] uppercase text-ink-3">{t('gallery.whatItMade', { product: productName('Cowork') })}</h4>
            <AnswerBlocks answer={entry.answer} />
          </section>
        )}
        {files.length > 0 && (
          <div className="flex flex-col gap-2">
            {files.map((file) => <FileLink key={file.href} file={file} isElectron={isElectron} openExternal={openExternal} />)}
          </div>
        )}
        {facts.length > 0 && <p className="m-0 text-[12px] text-ink-3">{facts.join(' · ')}</p>}
      </div>
      <div className={`px-4 py-3 border-t border-line flex flex-col gap-2 ${reserveCorner ? 'pr-12' : ''}`}>
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" onClick={() => onStart(entry)}>{t(sendsAtOnce(entry) ? 'gallery.tryIt' : 'gallery.start')}</Button>
          {takesOwnFile(entry.needs) && onOwnWork && <Button variant="default" onClick={onOwnWork}>{t('gallery.ownFile')}</Button>}
        </div>
        <p className="m-0 text-[12px] text-ink-3 text-center">{t(sendsAtOnce(entry) ? 'gallery.tryItNote' : 'gallery.startNote')}</p>
      </div>
    </div>
  );
}

/**
 * The Use Case Gallery beside Home: the console Gallery's finished examples,
 * with search, category tabs and an example view that steps through the
 * current list. Starting from an example hands its sample to Home, which fills
 * the composer and sends nothing.
 */
export default function GalleryColumn({
  manifest, failure = null, onRetry, onHide, onStart, onOwnWork = null,
  isElectron = false, openExternal = () => {}, focusSearch = false, className = '',
  // The first run, opened by itself: greets the person instead of titling the list.
  welcome = false,
  // 'panel' beside Home, drawn like the sidebar; 'sheet' over Home on a phone.
  variant = 'panel',
  // Keeps the bottom-right corner clear for the app's Appearance button.
  reserveCorner = false,
}) {
  const { t } = useTranslation('shell');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [openId, setOpenId] = useState(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);

  const view = useMemo(
    () => (manifest ? filterGallery(manifest, { query, category }) : null),
    [manifest, query, category],
  );

  useEffect(() => {
    if (!view?.searching) return undefined;
    const timer = setTimeout(() => trackGallerySearched(query.trim().length, view.list.length), SEARCH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [query, view]);

  const list = view?.list ?? [];
  const opened = openId ? manifest?.entries.find((entry) => entry.id === openId) ?? null : null;
  const index = opened ? list.findIndex((entry) => entry.id === opened.id) : -1;

  const open = (entry, from) => {
    setOpenId(entry.id);
    trackGalleryExampleOpened(entry.id, from);
  };
  const step = (delta) => {
    const next = list[index + delta];
    if (next) open(next, 'step');
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onHide('escape');
      return;
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '');
    if (!opened || typing) return;
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  };

  const tabs = manifest ? [{ category: ALL_CATEGORIES, label: t('gallery.all') }, ...manifest.sections.map((s) => ({ category: s.category, label: s.category }))] : [];

  return (
    <aside
      aria-labelledby="home-gallery-title"
      onKeyDown={onKeyDown}
      className={`home-gallery flex flex-col min-h-0 h-full overflow-hidden bg-[var(--sidebar-bg,var(--surface))] ${variant === 'panel' ? 'border border-solid border-line rounded-[14px] shadow-sh-2' : ''} ${className}`}
    >
      {opened ? (
        <Detail
          entry={opened}
          position={index + 1}
          total={list.length}
          query={view?.searching ? query.trim() : ''}
          onBack={() => setOpenId(null)}
          onStep={step}
          onCategory={(next) => { setCategory(next); setQuery(''); setOpenId(null); }}
          onStart={onStart}
          onOwnWork={onOwnWork}
          onHide={() => onHide('button')}
          isElectron={isElectron}
          openExternal={openExternal}
          reserveCorner={reserveCorner}
        />
      ) : null}
      {/* The list stays mounted under an opened example, so Back returns to the
          same search, tab and scroll position. */}
      <div className={`flex-1 min-h-0 flex flex-col ${opened ? 'hidden' : ''}`}>
        <div className="px-4 pt-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              {welcome && <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-ink-3">{t('gallery.title')}</span>}
              <h2 id="home-gallery-title" className="m-0 text-[17px] font-semibold text-ink">
                {welcome ? t('gallery.welcomeTitle', { product: productName('Cowork') }) : t('gallery.title')}
              </h2>
              <p className="m-0 text-[13px] leading-snug text-ink-2">
                {t(welcome ? 'gallery.welcomeIntro' : 'gallery.intro', { product: productName('Cowork') })}
              </p>
            </div>
            <button type="button" className={iconButton} aria-label={t('gallery.hide')} onClick={() => onHide('button')}>{Ico.close(14)}</button>
          </div>
          {manifest && (
            <>
              <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-line bg-[var(--surface-raised)] focus-within:border-accent">
                <span className="text-ink-3 inline-flex" aria-hidden="true">{Ico.search(14)}</span>
                <span className="sr-only">{t('gallery.searchLabel')}</span>
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('gallery.searchPlaceholder')}
                  className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[14px] text-ink font-[inherit]"
                />
              </label>
              <div role="tablist" aria-label={t('gallery.tabsLabel')} className="flex gap-4 overflow-x-auto border-b border-line">
                {tabs.map((tab) => {
                  const selected = tab.category === category;
                  const count = view.counts[tab.category] ?? 0;
                  return (
                    <button
                      key={tab.category}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setCategory(tab.category)}
                      className={`shrink-0 h-9 px-0 bg-transparent border-0 border-b-2 cursor-pointer font-[inherit] text-[13px] font-semibold whitespace-nowrap ${selected ? 'border-accent text-ink' : `border-transparent ${count ? 'text-ink-2' : 'text-ink-4'}`}`}
                    >
                      {tab.label} <span className="font-normal text-ink-3">{count}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className={`flex-1 min-h-0 overflow-y-auto px-2 pt-3 flex flex-col gap-1 ${reserveCorner ? 'pb-14' : 'pb-3'}`}>
          {!manifest && (
            <div role="status" className="px-2 flex flex-col items-start gap-2">
              <p className="m-0 text-[13px] text-ink-2">{failure ? t('gallery.unavailable') : t('gallery.loading')}</p>
              {failure && onRetry && <Button variant="subtle" size="sm" onClick={onRetry}>{t('gallery.retry')}</Button>}
            </div>
          )}
          {manifest && view.searching && (
            <p role="status" className="m-0 px-2 pb-1 text-[13px] text-ink-2">{t('gallery.results', { count: list.length })}</p>
          )}
          {manifest && view.startHere.length > 0 && (
            <>
              <h3 className="m-0 px-2 pt-1 text-[11px] font-semibold tracking-[0.06em] uppercase text-ink-3">{t('gallery.startHere')}</h3>
              {view.startHere.map((entry) => <Row key={`start-${entry.id}`} entry={entry} onOpen={() => open(entry, 'start_here')} highlighted />)}
              <h3 className="m-0 px-2 pt-3 text-[11px] font-semibold tracking-[0.06em] uppercase text-ink-3">{t('gallery.allExamples')}</h3>
            </>
          )}
          {manifest && list.map((entry) => (
            <Row key={entry.id} entry={entry} onOpen={() => open(entry, view.searching ? 'search' : 'list')} />
          ))}
          {manifest && list.length === 0 && (
            <p className="m-0 px-2 text-[13px] text-ink-2">{t('gallery.noResults', { product: productName('Cowork') })}</p>
          )}
        </div>
      </div>
    </aside>
  );
}
