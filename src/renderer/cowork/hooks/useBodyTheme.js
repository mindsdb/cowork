// The app's light/dark theme as the page shows it: `data-theme` on <body>,
// which useThemeSkin keeps current. Read from the DOM rather than passed
// down, so a component deep in the transcript follows a theme switch without
// every parent threading it through.

import { useEffect, useState } from 'react';

/** @returns {'light' | 'dark'} */
export function readBodyTheme() {
  if (typeof document === 'undefined') return 'light';
  return document.body?.dataset?.theme === 'dark' ? 'dark' : 'light';
}

/** @returns {'light' | 'dark'} */
export function useBodyTheme() {
  const [theme, setTheme] = useState(readBodyTheme);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    const obs = new MutationObserver(() => setTheme(readBodyTheme()));
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export default useBodyTheme;
