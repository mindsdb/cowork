// The viewer's one side panel (ENG-4455), shared by Live edit, Comments and
// Stats. It stays mounted while any of them is open and only swaps what is in
// it, with a short fade of the new content, so moving between them never
// slides a panel out and another in. It slides in when the first opens and
// out when the last closes (usePresence), still showing what it held.

import { useRef } from 'react';
import { usePresence } from './usePresence';

/**
 * @param {{
 *   id?: string,
 *   mode: string | null,
 *   label?: string,
 *   children: (mode: string) => import('react').ReactNode,
 * }} props
 */
export function ViewerSidePanel({ id, mode, label, children }) {
  const presence = usePresence(!!mode);
  // While it slides out the panel keeps the content it was closed on.
  const lastModeRef = useRef(mode);
  if (mode) lastModeRef.current = mode;
  const shown = mode || lastModeRef.current;
  if (!presence.mounted || !shown) return null;
  return (
    <aside
      id={id}
      aria-label={label}
      className={`artifact-side-panel${presence.leaving ? ' is-leaving' : ''}`}
      data-mode={shown}
      data-testid="viewer-side-panel"
    >
      <div key={shown} className="artifact-side-panel-content">{children(shown)}</div>
    </aside>
  );
}

export default ViewerSidePanel;
