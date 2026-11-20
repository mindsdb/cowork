// The "Get to know Cowork" onboarding steps — the single source of
// truth for the sidebar checklist. Each step renders one row; clicking it
// opens a fresh chat seeded with `prompt`, the message Cowork answers to
// show off that capability. Edit copy or reorder here; the UI follows.
//
// A step with `opensExamples` or `opensOwnWork` has no prompt: its row takes
// the person to Home, showing the examples or the own-work mode, and it is
// completed when a message goes out from there (see completion.js), not by
// the click. The own-work row sends nothing itself: a prompt that asked the
// person what they were working on got a question back, and most left there.
//
// `desktopOnly: true` hides a step on the web build (useOnboarding filters
// on host.isWeb): web runs against a cloud workspace, so steps that walk
// the user through local-machine access can't be completed there.

export const HABIT_TRACKER_PROMPT =
  'Build me a habit tracker as a live artifact: a simple week grid I can tick off each day. Start with three sensible habits and make them easy to rename.';
export const HABIT_TRACKER_PREFIX = 'Build me a habit tracker';

export const ONBOARDING_STEPS = [
  {
    id: 'bring-your-work',
    title: 'Start with your own work',
    description: 'Hand Cowork a file, notes or a link, and it starts.',
    opensOwnWork: true,
  },
  {
    id: 'connect-app',
    title: 'Connect an app',
    // Google Drive has a complete in-browser connect flow — point the step
    // at the path that actually works end to end.
    description: 'Link Google Drive, let Cowork act on your files.',
    prompt:
      'I want to connect my Google Drive so you can work with my real files. Walk me through linking it, then once it\'s connected, help me pick a file with "Add files from Google Drive", do something useful with it, and show me what you found.',
    desktopOnly: true,
  },
  // Keeps its original id, so a person who finished the habit tracker still
  // sees it done.
  {
    id: 'see-it-work',
    title: 'Try an example',
    description: 'Pick one on Home and watch it build.',
    opensExamples: true,
  },
  // The 'point-at-folder' step ("give you access to a folder on my
  // computer") is removed, not reworded (ENG-1852): no host can connect a
  // folder outside the project today — there is no folder picker, and the
  // promise ended with the agent's own skills/ directory reported as
  // "connected". Restore a folder step when local-folder access actually
  // ships (ENG-384 / ENG-497 / ENG-325). Completion state for the old id
  // persists harmlessly in anton.onboarding.completed.
];
