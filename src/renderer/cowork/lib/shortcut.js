import { host } from '../../platform/host';

// One answer to "is this a Mac?" for keyboard hints and OS wording. The
// desktop shell knows its platform; on web, Apple user agents (including
// iPad, which reports itself as a Mac) count too.
export const IS_MAC = host.isMac()
  || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');

// "N" → "⌘N" on a Mac, "Ctrl+N" elsewhere.
export function shortcutLabel(key) {
  return `${IS_MAC ? '⌘' : 'Ctrl+'}${key}`;
}
