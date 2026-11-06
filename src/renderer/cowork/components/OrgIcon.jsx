/**
 * An organization's icon (ENG-4020) in the org switcher and account menu:
 * the image from the org attribute `brand_icon_url` when it is an https URL
 * on the auth host, else (and when the image fails to load) a tile with the
 * org's first letter.
 */
import { useState } from 'react';
import { trustedBrandImageUrl } from '../../lib/orgBranding';

export function orgInitial(label) {
  const first = Array.from((label || '').trim())[0];
  return first ? first.toLocaleUpperCase() : '?';
}

export function OrgIcon({ iconUrl, label, size = 16, fallback = true }) {
  const src = trustedBrandImageUrl(iconUrl);
  const [failedSrc, setFailedSrc] = useState(null);
  const box = { width: size, height: size };
  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
        className="shrink-0 rounded-[4px] object-cover"
        style={box}
        data-testid="org-icon-image"
      />
    );
  }
  if (!fallback) return null;
  return (
    <span
      aria-hidden="true"
      className="shrink-0 inline-flex items-center justify-center rounded-[4px] text-[10px] font-bold text-accent select-none bg-[color-mix(in_srgb,var(--accent)_18%,var(--surface))]"
      style={box}
      data-testid="org-icon-initial"
    >
      {orgInitial(label)}
    </span>
  );
}

export default OrgIcon;
