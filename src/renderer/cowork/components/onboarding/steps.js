// HomeView also completes step 1 by prefix-matching the habit-tracker prompt.
// desktopOnly steps require local-machine access and must be hidden on hosted web.

export const HABIT_TRACKER_PROMPT =
  'Build me a habit tracker as a live artifact: a simple week grid I can tick off each day. Start with three sensible habits and make them easy to rename.';

// Keep this recognition prefix beside the prompt; steps.test.js checks that copy edits preserve it.
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
  // The removed point-at-folder step requires local-folder access that has not shipped; old
  // completion IDs are harmless.
  // Restore only when access exists. ENG-1852 / ENG-384 / ENG-497 / ENG-325.
];
