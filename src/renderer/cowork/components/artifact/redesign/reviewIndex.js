// reviewIndex.js — barrel for the M3 "review loop" frontend surfaces.
//
// Three self-contained React 19 components for the redesigned artifact workspace:
//   - ReviewBanner  owner-side "review returned → Fix with AI" banner (mounts under topbar)
//   - ReviewerView  the reviewer experience, mode='in-app' | 'link' (the shared-link route)
//   - VerdictBar    the forced verdict footer (Request changes / Approve) used inside ReviewerView
//
// Usage:
//   import { ReviewBanner, ReviewerView, VerdictBar } from '.../redesign/reviewIndex.js';
//   // or mount the standalone reviewer page directly:
//   import ReviewerView from '.../redesign/reviewIndex.js';

export { ReviewBanner } from './ReviewBanner.jsx';
export { VerdictBar } from './VerdictBar.jsx';
export { ReviewerView } from './ReviewerView.jsx';

// Default export is the standalone reviewer page (the shared-link entrypoint).
export { default } from './ReviewerView.jsx';
