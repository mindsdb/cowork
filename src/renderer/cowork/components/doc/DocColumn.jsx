// The chat's doc column: the doc pane beside the conversation (over it on a
// phone), with the divider that resizes it. `side` is useDocBesideChat's.
import { useEffect, useRef } from 'react';
import DocPane from './DocPane';
import { SHARE_MAX, SHARE_MIN, docShare, docShareAt, docShareForKey } from './docLayout';

const pct = (share) => Math.round(share * 100);

/**
 * The divider. The pointer is captured on it, so the drag's moves and its end
 * (released, cancelled, or the capture lost) all arrive here, and nothing
 * outlives the column.
 */
function Resizer({ areaRef, share, resizing, onResizing, onShare }) {
  const box = useRef(null); // the chat area, measured when the drag starts
  const end = () => {
    if (!box.current) return;
    box.current = null;
    onResizing(false);
  };
  // Closed mid-drag: the chat area gets its column transition back.
  useEffect(() => () => { if (box.current) onResizing(false); }, [onResizing]);
  return (
    <div
      className="doc-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the doc"
      aria-valuemin={pct(SHARE_MIN)}
      aria-valuemax={pct(SHARE_MAX)}
      aria-valuenow={pct(docShare(share))}
      tabIndex={0}
      data-active={resizing || undefined}
      onKeyDown={(e) => {
        const next = docShareForKey(share, e.key);
        if (next == null) return;
        e.preventDefault();
        onShare(next);
      }}
      onPointerDown={(e) => {
        if (!areaRef.current) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        box.current = areaRef.current.getBoundingClientRect();
        onResizing(true);
      }}
      onPointerMove={(e) => { if (box.current) onShare(docShareAt(box.current, e.clientX)); }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  );
}

export default function DocColumn({ side, narrow, areaRef }) {
  const { doc } = side;
  return (
    <div
      className={narrow ? 'fixed inset-0 z-[52] bg-surface' : 'relative min-w-0 min-h-0'}
      style={narrow ? undefined : { height: '100%' }}
    >
      {!narrow && !side.expanded && (
        <Resizer areaRef={areaRef} share={side.share} resizing={side.resizing} onResizing={side.setResizing} onShare={side.setShare} />
      )}
      <DocPane
        key={doc.artifactId}
        projectRef={doc.projectRef}
        artifactId={doc.artifactId}
        title={doc.title}
        expanded={side.expanded}
        fillsWindow={narrow}
        onToggleExpand={narrow ? undefined : side.toggleExpand}
        onClose={side.close}
        onAskAgent={side.askAgent}
        onViewChange={side.onViewChange}
      />
    </div>
  );
}
