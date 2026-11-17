// The artifact's address in the middle of the viewer header (ENG-4227): the
// published page (globe) when it is published, a running live app's address,
// or "Draft ·" and the draft's address otherwise, with copy and open-in-a-tab
// beside it. A draft that opens by a signed link has no address until the
// link is minted, which opening does: the pill then names it by its slug.
//
// Long addresses lose their middle, never the end: the last path segment (the
// slug) always shows whole, and the host and the rest of the path give way to
// an ellipsis first. The full address is the tooltip.

import { useEffect, useState } from 'react';
import Ico from '../Icons';
import { Tooltip } from '../ui';
import { copyText } from '../../lib/clipboard';
import { useTranslation } from '../../../lib/i18n';

/** `text` cut in the middle to at most `max` characters, keeping its end. */
export function middleEllipsis(text, max = 56) {
  const value = String(text || '');
  if (value.length <= max) return value;
  const tail = Math.ceil((max - 1) * 0.6);
  const head = max - 1 - tail;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/**
 * `{ head, tail }` of a shown address: `tail` is its last path segment, which
 * always shows; `head` is everything before it (host and path, ending in
 * "/"), which shrinks to an ellipsis when space is short. A bare host or a
 * name with no "/" is all tail.
 */
export function splitAddress(shown) {
  const value = String(shown || '');
  const cut = value.lastIndexOf('/');
  if (cut <= 0 || cut === value.length - 1) return { head: '', tail: value };
  return { head: value.slice(0, cut + 1), tail: value.slice(cut + 1) };
}

/** An address as a person reads it: no scheme, no trailing slash. */
export function displayAddress(url) {
  return String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/**
 * @param {object} props
 * @param {'published' | 'live' | 'draft'} props.kind
 * @param {string} props.url  The address, absolute; '' while a draft link is not minted.
 * @param {string} props.fallback  What names the draft without an address (its slug).
 * @param {boolean} props.canOpen  Whether ↗ is offered (the old button's rule).
 * @param {() => void} props.onOpen
 */
export function ArtifactAddressPill({ kind, url, fallback, canOpen, onOpen }) {
  const { t } = useTranslation('artifacts');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  const shown = url ? displayAddress(url) : fallback;
  const { head, tail } = splitAddress(shown);
  const isDraft = kind === 'draft';
  return (
    <div className="artifact-address-pill" data-kind={kind}>
      <span className="artifact-address-pill-icon" aria-hidden="true">
        {isDraft ? Ico.doc(14) : Ico.globe(14)}
      </span>
      {isDraft && <span className="artifact-address-pill-draft">{t('address.draft')}</span>}
      <span className="artifact-address-pill-text" title={url || fallback}>
        {head && <span className="artifact-address-pill-head">{head}</span>}
        <span className="artifact-address-pill-tail"><bdi>{middleEllipsis(tail, 48)}</bdi></span>
      </span>
      {url && (
        <Tooltip content={copied ? t('address.copied') : t('address.copy')}>
          <button
            type="button"
            className="artifact-address-pill-action"
            aria-label={copied ? t('address.copied') : t('address.copy')}
            onClick={async () => { if (await copyText(url)) setCopied(true); }}
          >
            {copied ? Ico.check(14) : Ico.copy(14)}
          </button>
        </Tooltip>
      )}
      {canOpen && (
        <Tooltip content={t('header.openInTab')}>
          <button
            type="button"
            className="artifact-address-pill-action"
            aria-label={t('header.openInTab')}
            onClick={onOpen}
          >
            {Ico.arrowUpRight(14)}
          </button>
        </Tooltip>
      )}
    </div>
  );
}

export default ArtifactAddressPill;
