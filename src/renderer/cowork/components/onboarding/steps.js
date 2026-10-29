// The "Get to know Cowork" onboarding steps — the single source of
// truth for the sidebar checklist. Each step renders one row; clicking it
// opens a fresh chat seeded with `prompt`, the message Cowork answers to
// show off that capability. Edit copy or reorder here; the UI follows.
//
// A step with `opensExamples` has no prompt: its row takes the person to
// Home, where the examples are, and it is completed when one of them is sent
// (see completion.js), not by the click.
//
// `desktopOnly: true` hides a step on the web build (useOnboarding filters
// on host.isWeb): web runs against a cloud workspace, so steps that walk
// the user through local-machine access can't be completed there.

// The first step starts from the person's own work. The prompt names the ways
// to bring it and a few small things to start with, so the agent's first reply
// lists them instead of leaving a blank page; the same text is what a console
// link places in the composer.
export const OWN_WORK_PROMPT =
  'I\'d like to start with something real from my work. Ask me one question about what I\'m working on, and give me two or three small examples to jump-start it, like a report to update, a spreadsheet to clean, or a thread to answer. Tell me I can attach a file, paste notes or a link, or connect Gmail, and say you\'ll take the first step once I answer.';

// Stable prefixes used to recognize a (possibly user-edited) send and complete
// the matching step. Kept next to the prompts so a copy edit can't silently
// break the match — steps.test.js asserts each prompt starts with its prefix.
export const OWN_WORK_PREFIX = 'I\'d like to start with something real';

export const HABIT_TRACKER_PROMPT =
  'Build me a habit tracker as a live artifact: a simple week grid I can tick off each day. Start with three sensible habits and make them easy to rename.';
export const HABIT_TRACKER_PREFIX = 'Build me a habit tracker';

export const ONBOARDING_STEPS = [
  {
    id: 'bring-your-work',
    title: 'Start with your own work',
    description: 'Tell Cowork what you\'re working on and hand it a file or notes.',
    prompt: OWN_WORK_PROMPT,
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
    // Google Drive has a complete in-browser connect flow — point the step
    // at the path that actually works end to end.
    description: 'Link Google Drive, let Cowork act on your files.',
    prompt:
      'I want to connect my Google Drive so you can work with my real files. Walk me through linking it, then once it\'s connected, do something useful with a file and show me what you found.',
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
