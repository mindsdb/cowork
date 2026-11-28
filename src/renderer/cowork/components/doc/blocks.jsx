// The smaller blocks: metrics, code, image, pending, divider.
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { Icon } from '../ui/Icon';
import EditableText from './EditableText';
import { useFlushOnUnmount, usePendingEdit } from './useSaveIndicator';
import { copyText } from '../../lib/clipboard';
import { useTranslation } from '../../../lib/i18n';
import { CODE_LANGUAGES, fitsDocCodeLimit, highlightCode, isDocCodeLanguage } from '../markdown/hljs';

/**
 * How the editor fetches an image kept beside the doc (`images/…`): `(src) =>
 * Promise<Blob> | null`, null for one it doesn't fetch (a web or data: image,
 * shown as it is). The app's shell shows only blob: images from its own
 * server, so it fetches them with its credentials (DocPane); a page with the
 * images beside it needs none.
 */
export const DocImageLoader = createContext(null);

/**
 * The src an image shows from: a blob: URL for one the loader fetches, else its own src.
 * The loader is asked once per loader and src, in an effect: asked on every render, a
 * loader that doesn't keep its requests would fetch again on each one, and the image it
 * showed would set off the next.
 */
function useImageSrc(src) {
  const load = useContext(DocImageLoader);
  // What the loader made of this src: whether it fetches it, and the blob: URL once it has.
  const [shown, setShown] = useState({ load: null, src: null, fetched: false, url: null });
  useEffect(() => {
    const request = load?.(src) || null;
    setShown({ load, src, fetched: !!request, url: null });
    if (!request) return undefined;
    let made = null;
    let live = true;
    request.then((blob) => {
      if (!live) return;
      made = URL.createObjectURL(blob);
      setShown({ load, src, fetched: true, url: made });
    }, () => {});
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [load, src]);
  // Until the loader has been asked about this src, show nothing rather than a path the
  // shell won't load; with no loader, the src is shown as it is.
  if (!load) return src;
  if (shown.load !== load || shown.src !== src) return null;
  return shown.fetched ? shown.url : src;
}

export function MetricsBlock({ block, editable, onOps }) {
  const { t } = useTranslation('docs');
  const setItem = (i, patch) => {
    const items = block.items.map((it, j) => (j === i ? { ...it, ...patch } : it));
    onOps([{ op: 'update', id: block.id, set: { items } }]);
  };
  return (
    <div className="doc-metrics" role="list">
      {block.items.map((m, i) => {
        const dir = /^\s*[-−]/.test(m.delta || '') ? 'down' : /^\s*\+/.test(m.delta || '') ? 'up' : null;
        const tone = m.tone || null;
        return (
          <div className="doc-metric" role="listitem" key={i}>
            <EditableText className="doc-metric__label" value={m.label} plain singleLine editable={editable}
              onCommit={(label) => setItem(i, { label })} placeholder={t('metrics.label')} />
            <EditableText className="doc-metric__value" value={m.value} plain singleLine editable={editable}
              onCommit={(value) => setItem(i, { value })} placeholder="0" />
            {(m.delta || editable) && (
              <div className={`doc-metric__delta ${tone === 'good' ? 'doc-metric__delta--good' : tone === 'bad' ? 'doc-metric__delta--bad' : ''}`}>
                {dir && <Icon of={dir === 'up' ? TrendingUp : TrendingDown} size={12} />}
                <EditableText value={m.delta || ''} plain singleLine editable={editable}
                  onCommit={(delta) => setItem(i, { delta })} placeholder={editable ? t('metrics.change') : ''} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Whether the editor colours `code`: only where the doc's page colours it too.
 * The page's Pygments rewrites \r and a leading BOM, so it leaves those plain.
 */
function colourable(code, language) {
  return isDocCodeLanguage(language) && fitsDocCodeLimit(code)
    && !code.includes('\r') && code.charCodeAt(0) !== 0xfeff;
}

export function CodeBlock({ block, editable, onOps }) {
  const { t } = useTranslation('docs');
  const ref = useRef(null);
  const [draft, setDraft] = useState(block.code || '');
  // Typed code is committed on leaving the box, so until then it is an edit
  // waiting, as the save indicator says; and committed if the block goes
  // first, as EditableText's text is.
  const { setDirty } = usePendingEdit();
  // The language as typed while its box has the focus; otherwise the block's
  // own, so a change from the agent or another window shows.
  const [lang, setLang] = useState(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);
  const listId = useId();
  const layerRef = useRef(null);
  // The language being typed colours the code at once, before it is saved.
  const language = lang ?? block.language ?? '';
  const markup = useMemo(
    () => (colourable(draft, language) ? highlightCode(draft, language).html : null),
    [draft, language],
  );
  const syncLayer = () => {
    const layer = layerRef.current;
    const box = ref.current;
    if (!layer || !box) return;
    layer.scrollLeft = box.scrollLeft;
    layer.scrollTop = box.scrollTop;
  };
  // A layer that appears after the box scrolled starts where the box is.
  useLayoutEffect(syncLayer, [markup]);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(block.code || '');
  }, [block.code]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // The horizontal scrollbar takes height from the box; add it so the box has no vertical scroll.
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [draft]);
  const edit = (next) => { setDraft(next); setDirty(true); };
  const commit = () => {
    setDirty(false);
    if (draft !== (block.code || '')) onOps([{ op: 'update', id: block.id, set: { code: draft } }]);
  };
  useFlushOnUnmount(commit);
  return (
    <div className="doc-code">
      <div className="doc-code__bar">
        <input
          className="doc-code__lang"
          list={listId}
          value={lang ?? block.language ?? ''}
          placeholder={t('code.plainText')}
          readOnly={!editable}
          aria-label={t('code.language')}
          onFocus={() => setLang(block.language || '')}
          onChange={(e) => setLang(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          onBlur={() => {
            if (lang != null && lang !== (block.language || '')) onOps([{ op: 'update', id: block.id, set: { language: lang } }]);
            setLang(null);
          }}
        />
        <datalist id={listId}>
          {CODE_LANGUAGES.map((name) => <option key={name} value={name} />)}
        </datalist>
        <button type="button" className="doc-iconbtn" aria-label={t('code.copy')}
          onClick={async () => {
            if (!await copyText(draft)) return;
            setCopied(true);
            clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopied(false), 1200);
          }}>
          {copied ? <span style={{ fontSize: 11 }}>{t('code.copied')}</span> : <Icon of={Copy} size={14} />}
        </button>
      </div>
      <div className="doc-code__body">
        {markup != null && (
          <pre ref={layerRef} className="doc-code__hl" aria-hidden="true">
            {/* hljs escapes the code; its markup holds only its own spans. */}
            <code dangerouslySetInnerHTML={{ __html: markup }} />
          </pre>
        )}
        <textarea
          ref={ref}
          className={markup != null ? 'doc-code__text doc-code__text--hl' : 'doc-code__text'}
          value={draft}
          readOnly={!editable}
          spellCheck={false}
          aria-label={t('code.label')}
          rows={1}
          onChange={(e) => edit(e.target.value)}
          onScroll={syncLayer}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const el = e.currentTarget;
              const s = el.selectionStart;
              edit(draft.slice(0, s) + '  ' + draft.slice(el.selectionEnd));
              requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
            }
          }}
        />
      </div>
    </div>
  );
}

export function ImageBlock({ block, editable, onOps }) {
  const { t } = useTranslation('docs');
  const src = useImageSrc(block.src);
  return (
    <figure className="doc-figure">
      {src ? <img src={src} alt={block.alt || ''} loading="lazy" /> : <div className="doc-figure__loading" aria-label={block.alt || t('image.label')} />}
      {(block.caption || editable) && (
        <EditableText as="figcaption" value={block.caption || ''} plain singleLine editable={editable}
          placeholder={t('image.caption')} onCommit={(caption) => onOps([{ op: 'update', id: block.id, set: { caption } }])} />
      )}
    </figure>
  );
}

export function PendingBlock({ block, live }) {
  const { t } = useTranslation('docs');
  return (
    <div className={`doc-pending ${live ? 'doc-pending--live' : ''}`} aria-live="polite">
      <div className="doc-pending__head">
        <Icon of={Sparkles} size={14} />
        <span>{t(live ? 'pending.writing' : 'pending.toWrite')}</span>
        <span className="doc-pending__intent">{block.intent}</span>
      </div>
      {live && (
        <div className="doc-pending__lines" aria-hidden="true">
          <div className="doc-pending__line" style={{ width: '92%' }} />
          <div className="doc-pending__line" style={{ width: '78%' }} />
          <div className="doc-pending__line" style={{ width: '60%' }} />
        </div>
      )}
    </div>
  );
}

export function DividerBlock() {
  return <hr className="doc-divider" />;
}
