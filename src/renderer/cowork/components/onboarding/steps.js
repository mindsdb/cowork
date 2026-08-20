// The four "Get to know Cowork" onboarding steps — the single source of
// truth for the sidebar checklist. Each step renders one row; clicking it
// opens a fresh chat seeded with `prompt`, the message Cowork answers to
// show off that capability. Edit copy or reorder here; the UI follows.
//
// Step 1 is also completed when the habit-tracker prompt is sent from the
// home composer by any route — HomeView prefix-matches outgoing sends.
//
// `desktopOnly: true` hides a step on the web build (useOnboarding filters
// on host.isWeb): web runs against a cloud workspace, so steps that walk
// the user through local-machine access can't be completed there.

export const HABIT_TRACKER_PROMPT =
  'Build me a habit tracker as a live artifact: a simple week grid I can tick off each day. Start with three sensible habits and make them easy to rename.';

// Stable prefix used to recognize a (possibly user-edited) habit-tracker
// send and complete step 1. Kept next to the prompt so a copy edit can't
// silently break the match — steps.test.js asserts the prompt starts with it.
export const HABIT_TRACKER_PREFIX = 'Build me a habit tracker';

export const ONBOARDING_STEPS = [
  {
    id: 'see-it-work',
    title: 'See Cowork work',
    description: 'Hand it a quick task and watch it finish.',
    prompt: HABIT_TRACKER_PROMPT,
  },
  {
    id: 'customize-role',
    title: 'Customize Cowork to your role',
    description: 'Add ready-made tools and workflows.',
    prompt:
      'I want to set you up for the work I actually do. Ask me a couple of quick questions about my role, remember what matters to me, then suggest and set up a few tools or workflows that would help.',
  },
  {
    id: 'connect-app',
    title: 'Connect an app',
    // Google Drive is the one connector with a complete in-browser
    // connect flow today (Gmail doesn't have it yet) — point the step
    // at the path that actually works end to end.
    description: 'Link Google Drive, let Cowork act on your files.',
    prompt:
      'I want to connect my Google Drive so you can work with my real files. Walk me through linking it, then once it\'s connected, do something useful with a file and show me what you found.',
    desktopOnly: true,
  },
  {
    id: 'point-at-folder',
    title: 'Point it at a folder',
    description: 'Let Cowork read and edit your real files.',
    prompt:
      'I\'d like to give you access to a folder on my computer. Help me pick and connect one, then once you can see the files, show me a couple of useful things you can do with them.',
    desktopOnly: true,
  },
];
