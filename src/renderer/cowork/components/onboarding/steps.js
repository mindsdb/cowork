// The four "Get to know Cowork" onboarding steps — the single source of
// truth for the checklist. Each step renders one row; clicking it opens a
// fresh chat seeded with `prompt`, the message Cowork answers to show off
// that capability. Edit copy or reorder here; the UI follows.

export const ONBOARDING_STEPS = [
  {
    id: 'see-it-work',
    title: 'See Cowork work',
    description: 'Hand it a quick task and watch it finish.',
    prompt:
      'I just set up Cowork and want to see what you can do. Pick one small, useful thing you can handle right now, something under a minute, and just do it. Show me the result, then tell me what else you could take on once I connect more of my tools.',
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
    description: 'Link Gmail or Slack, let Cowork act on it.',
    prompt:
      'I want to connect one of my apps so you can work with my real stuff. Walk me through linking one (email, calendar, chat, or files all work), then once it\'s connected, do something useful with it and show me what you found.',
  },
  {
    id: 'point-at-folder',
    title: 'Point it at a folder',
    description: 'Let Cowork read and edit your real files.',
    prompt:
      'I\'d like to give you access to a folder on my computer. Help me pick and connect one, then once you can see the files, show me a couple of useful things you can do with them.',
  },
];
