// Sidebar branding (title text, title color, logo) — synced Settings fields
// (navTitle/navTitleColor/navLogo), same mechanism as the greeting. Unlike
// the "Design your own" CustomTheme recipe (customTheme.ts, local-only,
// tied to the Custom skin), branding applies regardless of skin/theme.

/**
 * Apply (or with null/empty, clear) the sidebar wordmark color as an inline
 * body property. Independent of the active skin — works in every style.
 */
export function applyNavTitleColor(color: string | null | undefined): void {
  if (color) document.body.style.setProperty('--nav-title-color', color);
  else document.body.style.removeProperty('--nav-title-color');
}

interface OriginalFavicon {
  href: string | null;
  type: string | null;
  created: boolean;
}

const originalFavicons = new WeakMap<HTMLLinkElement, OriginalFavicon>();

/** Restore the page's own icon when the synced override is cleared. */
export function applyFavicon(dataUri: string | null | undefined): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!dataUri) {
    const original = link && originalFavicons.get(link);
    if (!link || !original) return;
    if (original.created) link.remove();
    else {
      for (const attribute of ['href', 'type'] as const) {
        const value = original[attribute];
        if (value === null) link.removeAttribute(attribute);
        else link.setAttribute(attribute, value);
      }
    }
    originalFavicons.delete(link);
    return;
  }

  const mime = /^data:(image\/(?:png|x-icon|vnd\.microsoft\.icon|svg\+xml|webp));base64,/i.exec(dataUri)?.[1];
  if (!mime) return;
  const created = !link;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (!originalFavicons.has(link)) {
    originalFavicons.set(link, {
      href: link.getAttribute('href'),
      type: link.getAttribute('type'),
      created,
    });
  }
  link.href = dataUri;
  link.type = mime.toLowerCase();
}
