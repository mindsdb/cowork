// The mobile app (ENG-4023): a Capacitor shell whose webview
// loads this same web build from the cloud. The web code stays the product;
// this module only answers "am I inside the app, and which one?".
//
// Contract with the native shell (mobile/, built separately):
//   - it appends `MindsHubCowork-iOS/<version>` or
//     `MindsHubCowork-Android/<version>` to the webview user agent;
//   - it injects `window.Capacitor`, with the `MindsHubAuth` plugin used for
//     sign-in (see mobileAuth.ts).
//
// Read once at module load, like WEB_BUILD: the user agent cannot change while
// a page is open. Code inside src/renderer/cowork/ reads it through
// platform/host.ts (`host.isMobileShell`), never from here.

import { WEB_BUILD } from './buildTarget';

export type MobileShellPlatform = 'ios' | 'android';

export interface MobileShell {
  platform: MobileShellPlatform;
  /** The native shell's version, e.g. "1.0.0". */
  version: string;
}

/**
 * The oldest native shell this web build still works with. Raise it only when
 * the web app starts depending on something a newer shell provides; an older
 * shell then shows the "update the app" screen instead of a broken app.
 */
export const MIN_SHELL_VERSION = '1.0.0';

const SHELL_UA = /\bMindsHubCowork-(iOS|Android)\/(\d+(?:\.\d+)*)/;

/** Parse the shell marker out of a user agent string. Null outside the app. */
export function parseMobileShellUserAgent(userAgent: string | null | undefined): MobileShell | null {
  if (typeof userAgent !== 'string') return null;
  const match = SHELL_UA.exec(userAgent);
  if (!match) return null;
  return {
    platform: match[1] === 'iOS' ? 'ios' : 'android',
    version: match[2],
  };
}

function versionParts(version: string): number[] | null {
  const trimmed = version.trim();
  if (!/^\d+(?:\.\d+)*$/.test(trimmed)) return null;
  return trimmed.split('.').map((part) => Number(part));
}

/**
 * True when the shell is older than `minShellVersion`. Versions compare as
 * dotted numbers, missing parts counting as 0 ("1.2" == "1.2.0"). A shell
 * version that cannot be read needs an update; a minimum that cannot be read
 * blocks nobody, so a typo in the constant never locks every user out.
 */
export function shellNeedsUpdate(shellVersion: string, minShellVersion: string): boolean {
  const min = versionParts(minShellVersion);
  if (!min) return false;
  const shell = versionParts(shellVersion);
  if (!shell) return true;
  const length = Math.max(min.length, shell.length);
  for (let i = 0; i < length; i += 1) {
    const a = shell[i] ?? 0;
    const b = min[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

/** Read the shell from the current browser. Null outside the app. */
export function detectMobileShell(
  nav: { userAgent?: string } | undefined = typeof navigator !== 'undefined' ? navigator : undefined,
): MobileShell | null {
  return parseMobileShellUserAgent(nav?.userAgent);
}

/** The app shell this page runs in, or null in a browser or the desktop app. */
export const mobileShell: MobileShell | null = WEB_BUILD ? detectMobileShell() : null;
export const isMobileShell: boolean = mobileShell !== null;

const VIEWPORT_FIT_COVER = 'viewport-fit=cover';

/** Add `viewport-fit=cover` to a viewport meta content string, once. */
export function withViewportFitCover(content: string): string {
  if (/viewport-fit\s*=\s*cover/.test(content)) return content;
  const base = content.trim().replace(/,\s*$/, '');
  return base ? `${base}, ${VIEWPORT_FIT_COVER}` : VIEWPORT_FIT_COVER;
}

/**
 * Prepare the document for the app: `data-shell` on <html> so CSS can target
 * the app, and `viewport-fit=cover` so the page draws under the notch and the
 * home indicator and `env(safe-area-inset-*)` reports real insets (without it
 * every inset reads 0). Only called inside the app; browsers keep their page.
 */
export function applyMobileShellDocument(shell: MobileShell, doc: Document = document): void {
  doc.documentElement.dataset.shell = shell.platform;
  const meta = doc.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', withViewportFitCover(meta.getAttribute('content') ?? ''));
  trackVisualViewport(doc);
}

// Below this many px of lost height the visual viewport is treated as the
// whole screen: toolbar and rounding wobble, not a keyboard.
const KEYBOARD_MIN_PX = 80;

interface ViewportBox {
  height: number;
  offsetTop: number;
}

/**
 * The CSS the phone layout needs for the current visual viewport.
 *
 * The webview keeps its layout viewport at full height when the keyboard
 * opens and pans the page just far enough to show the caret. A full-height
 * `position: fixed` shell then leaves its bottom (the composer's controls)
 * under the keyboard and pushes its top under the status bar. Sizing the
 * shell to the visible box and moving it by the pan keeps both edges on
 * screen. While the keyboard is up it covers the home indicator, so the
 * bottom safe-area padding is dropped.
 */
export function visualViewportStyle(viewport: ViewportBox, layoutHeight: number): {
  height: string;
  top: string;
  keyboard: boolean;
} {
  return {
    height: `${Math.round(viewport.height)}px`,
    top: `${Math.round(viewport.offsetTop)}px`,
    keyboard: layoutHeight - viewport.height > KEYBOARD_MIN_PX,
  };
}

function trackVisualViewport(doc: Document): void {
  const win = doc.defaultView;
  const viewport = win?.visualViewport;
  if (!win || !viewport) return;
  const root = doc.documentElement;
  const update = () => {
    // Not innerHeight: iOS shrinks that with the keyboard too.
    const style = visualViewportStyle(viewport, root.clientHeight);
    root.style.setProperty('--shell-viewport-height', style.height);
    root.style.setProperty('--shell-viewport-top', style.top);
    if (style.keyboard) root.dataset.keyboard = 'open';
    else delete root.dataset.keyboard;
    // Once the shell fits the visible box there is nothing left to reveal,
    // so undo the pan. Left panned, the strip behind the keyboard would show
    // past the end of the page in the webview's own color.
    if (viewport.offsetTop > 0) win.scrollTo(0, 0);
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
}
