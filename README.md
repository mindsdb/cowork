# Browser Control M1 — demo recording

`browser-control-m1-demo.mp4` (305s, 1920x1080): end-to-end desktop demo of Browser Control Milestone 1 (read-only) recorded on the final code of the stacked PRs:

- cowork-server: #199 → #200 → #198
- cowork: #415 → #416 → #412
- anton: #252

Timeline: connect + tab approval (`awaiting-approval` → `connected`), Browser Control connection card, real dispatched `inspect` → `follow_link` (Chrome visibly navigates to `july.html`) → `scroll` → `wait` through the live server command queue → Electron poller → CDP path with content-free observed digests, then Disconnect/revoke and a blocked post-revoke dispatch.

This branch exists only to host the demo asset; safe to delete after the stack merges.
