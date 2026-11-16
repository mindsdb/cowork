# Browser viewer message fixture (copy)

`messages.json` is a byte-for-byte copy of the browser service's viewer message list. The browser service owns it, since it serves the viewer page. This copy must stay byte-identical: change it there first, then copy the file here unchanged.

- `viewer_to_pane`: what the viewer posts to the pane with `window.postMessage`. `live` says a stream's hello shows, which waits for the person to let go of a mouse button while another stream is live. `closed` carries the socket's close code, and is posted only when no live and no pending socket is left.
- `pane_to_viewer_port`: what the pane posts on the `MessagePort` the viewer gave it. `ticket` carries a fresh ticket, which the viewer redeems in place. `pause` closes the viewer's sockets. `focus` asks the viewer to focus its picture.
- `pane_to_viewer_window`: what the pane posts to the viewer's window with `'*'`. `theme` carries the app's theme (`browserViewerTheme`). `hand_back` is the chat card's "Done, continue" (`HAND_BACK_MESSAGE` in `src/renderer/cowork/lib/browserHandBack.js`), which the viewer takes only while the person holds the browser.
- `ready_carries_port`: a viewer that takes tickets in place transfers a `MessagePort` with its ready message. A ready with no port comes from a viewer that doesn't.
- `drop_sequence`: a dropped connection, in order. `from` says who sends `message`, and `carries_port` says whether the message transfers the port.

`src/renderer/cowork/lib/browserSession.test.js` pins each pane constant to this file, `HAND_BACK_MESSAGE` among them, and `src/renderer/cowork/components/browser/BrowserPanel.test.jsx` drives its fake viewer from `drop_sequence`. After a refresh, run `npx vitest run src/renderer/cowork/lib/browserSession.test.js src/renderer/cowork/components/browser`.
