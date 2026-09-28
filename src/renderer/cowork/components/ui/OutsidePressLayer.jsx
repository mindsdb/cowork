// `<OutsidePressLayer>` — a transparent full-viewport layer that closes a
// popup on any press outside it. Render it only while the popup is open, with
// a `zIndex` just under the popup's.
//
// Why not Base UI's own outside-press detection: it listens on the parent
// document, and two kinds of press never get there. A click inside an
// <iframe> (the artifact preview) fires in the iframe's own document, and
// Electron swallows mouse events over `-webkit-app-region: drag` regions —
// the whole window is one (App.jsx). A `no-drag` layer painted over both
// receives those presses directly. Because the press lands on this layer and
// not on the trigger underneath, re-clicking the trigger closes the popup
// instead of flickering it back open.
//
// Extra props (e.g. `data-testid`, `aria-*`) land on the layer; `style` and
// `onMouseDown` are the layer's own and are not merged.

import { createPortal } from 'react-dom';

export function OutsidePressLayer({ onPress, zIndex, ...rest }) {
  return createPortal(
    <div
      {...rest}
      onMouseDown={onPress}
      style={{
        position: 'fixed', inset: 0, zIndex,
        background: 'transparent',
        WebkitAppRegion: 'no-drag',
      }}
    />,
    document.body,
  );
}

export default OutsidePressLayer;
