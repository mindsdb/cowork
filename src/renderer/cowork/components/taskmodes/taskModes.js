// Task modes for the home composer (ENG-1594). Each mode is a pill under the
// composer; picking one shows a removable chip in the composer toolbar, swaps
// the placeholder, and surfaces that mode's sample prompts. Picking a sample
// drops its FULL `prompt` into the composer (the short `label` is only the
// list text) — same as Manus. All texts captured from manus.im (2026-08-14),
// brand-adapted where they name the product. Website has no sample prompts on
// Manus (it shows a category flow instead), so those prompts are authored in
// the same style from Manus's website categories.
//
// `icon` is an Icons.jsx key (resolved dynamically — keep keys in sync with
// that file). `samplesVariant` mirrors Manus: slides + visualization render
// sample cards under a heading, the rest render plain rows. `chipNoun`
// (optional) is the noun the chip's remove aria-label uses when `chipLabel`
// is a verb phrase — "Remove Games mode" reads better than
// "Remove Create games mode".

export const TASK_MODES = [
  {
    id: 'slides',
    pillLabel: 'Create slides',
    chipLabel: 'Slides',
    icon: 'presentation',
    placeholder: 'Describe your presentation topic',
    instruction: 'Create a slide presentation.',
    samplesVariant: 'cards',
    samples: [
      {
        label: 'Build quarterly sales performance dashboard',
        prompt: 'Build a quarterly sales performance presentation with slides for revenue growth, deal pipeline, win/loss rates, top products, and a regional breakdown. Use sample data and simple charts I can replace with our numbers.',
      },
      {
        label: 'Analyze competitor landscape and positioning',
        prompt: 'Create a competitor landscape presentation covering key competitors, their strengths and weaknesses, market positioning, and how we differentiate. End with a SWOT slide and clear recommendations.',
      },
      {
        label: 'Automate weekly team status reporting',
        prompt: 'Create a weekly team status report presentation template with slides for milestones, completed tasks, blockers, and upcoming priorities. Keep it short and easy to reuse every week.',
      },
      {
        label: 'Research market opportunity for product launch',
        prompt: 'Prepare a market opportunity presentation for a new product launch, covering target market size, customer segments, demand, and a go-to-market plan.',
      },
    ],
  },
  {
    id: 'website',
    pillLabel: 'Build website',
    chipLabel: 'Website',
    icon: 'appWindow',
    placeholder: 'Describe the website you want to build',
    instruction: 'Build a website.',
    samplesVariant: 'rows',
    samples: [
      {
        label: 'Build an online store for a small business',
        prompt: 'Build a simple online store page for a small business, with a product grid, a product detail view, and a cart. Use placeholder products and keep it clean and mobile friendly.',
      },
      {
        label: 'Build a landing page for a product launch',
        prompt: 'Build a landing page for an upcoming product launch, with a hero section, feature highlights, testimonials, an FAQ, and an email signup form.',
      },
      {
        label: 'Build a dashboard website',
        prompt: 'Build a dashboard page that tracks key business metrics, with summary cards, trend charts, and a table of recent activity. Use sample data I can replace.',
      },
      {
        label: 'Build a portfolio website',
        prompt: 'Build a personal portfolio page with a short intro, a projects gallery, and a contact section.',
      },
      {
        label: 'Build a company blog',
        prompt: 'Build a blog home page with a clean article layout, category filters, and a few placeholder posts.',
      },
    ],
  },
  {
    id: 'apps',
    pillLabel: 'Develop apps',
    chipLabel: 'Develop apps',
    chipNoun: 'Apps',
    icon: 'phone',
    placeholder: 'Describe the app you want to build',
    instruction: 'Build an app.',
    samplesVariant: 'rows',
    samples: [
      {
        label: 'Build employee onboarding workflow app',
        prompt: "Build an employee onboarding checklist app where I can add new hires, assign them tasks, and track each person's progress through the checklist.",
      },
      {
        label: 'Build expense reporting and approval app',
        prompt: 'Build an expense tracker app where I can log expenses with categories, see monthly totals, and spot where the money goes.',
      },
      {
        label: 'Build fitness tracking app with check-ins',
        prompt: 'Design a fitness tracking app that supports daily workout logs, check-ins, and progress tracking.',
      },
      {
        label: 'Build study planning and progress tool',
        prompt: 'Design a study planning tool for setting learning goals, breaking them into tasks, and tracking progress.',
      },
      {
        label: 'Build customer feedback collection app',
        prompt: 'Build a feedback collection app with a short survey form and a results view that summarizes the responses.',
      },
    ],
  },
  {
    id: 'spreadsheet',
    pillLabel: 'Spreadsheet',
    chipLabel: 'Spreadsheet',
    icon: 'table',
    placeholder: 'Upload a spreadsheet to analyze or start one from scratch',
    instruction: 'Create or analyze a spreadsheet.',
    samplesVariant: 'rows',
    samples: [
      {
        label: 'Track project tasks across lifecycle elegantly',
        prompt: 'Create a project management table for tracking tasks across the project lifecycle, with an elegant and minimalist visual style.',
      },
      {
        label: 'Compile a North America AI conference calendar',
        prompt: 'Help me collect upcoming AI industry conferences in North America for the rest of the year and compile them into a calendar.',
      },
      {
        label: 'Create acquisition due diligence checklist',
        prompt: 'Create a due diligence checklist spreadsheet for a company acquisition, grouped by workstream with owner and status columns.',
      },
      {
        label: 'Compare top VLM models using Hugging Face data',
        prompt: 'Research the most popular vision language models on Hugging Face and compile them into a comparison table.',
      },
      {
        label: 'Calculate IRR for investment cash flows',
        prompt: 'Build an investment cash flow table with capital calls, exit payouts, and a yearly IRR calculation. Use sample numbers I can replace.',
      },
    ],
  },
  {
    id: 'visualization',
    pillLabel: 'Visualization',
    chipLabel: 'Visualization',
    icon: 'chartColumn',
    placeholder: 'Upload your data and tell Cowork how to visualize it',
    instruction: 'Create a data visualization.',
    samplesVariant: 'cards',
    samples: [
      {
        label: 'Show weekly sales activity via heatmap',
        prompt: 'Create a heatmap of weekly sales activity across regions and product categories, using sample data, and highlight the peaks and the weak spots.',
      },
      {
        label: 'Generate customer churn analysis and insights',
        prompt: 'Create a customer churn analysis showing churn rates by cohort and retention trends, using sample data, and summarize the key takeaways.',
      },
      {
        label: 'Track monthly KPIs across departments',
        prompt: 'Build a KPI dashboard with monthly metrics for sales, marketing, product, and support, with trend charts. Use sample data I can replace.',
      },
      {
        label: 'Analyze competitor landscape across market segments',
        prompt: 'Visualize a competitor landscape comparing five companies on market share, pricing, and growth, using bar and bubble charts with sample data.',
      },
    ],
  },
  {
    id: 'wide-research',
    pillLabel: 'Wide Research',
    chipLabel: 'Wide Research',
    icon: 'telescope',
    placeholder: 'Describe a complex project you want to research in parallel',
    instruction: 'Run wide research on this, breaking it into parallel subtasks.',
    samplesVariant: 'rows',
    samples: [
      {
        label: 'Conduct comprehensive market sizing analysis',
        prompt: 'Conduct a comprehensive market sizing analysis for the AI-powered customer service industry, including TAM/SAM/SOM, growth projections, key market drivers, and competitive landscape mapping.',
      },
      {
        label: 'Conduct deep competitor benchmarking study',
        prompt: 'Conduct a deep competitor benchmarking study comparing top 10 players in the project management software space across features, pricing, market share, customer satisfaction, and go-to-market strategy.',
      },
      {
        label: 'Research emerging technology landscape',
        prompt: 'Research the emerging technology landscape in generative AI, covering key players, use cases, investment trends, regulatory developments, enterprise adoption patterns, and future outlook.',
      },
      {
        label: 'Conduct investment due diligence research',
        prompt: 'Conduct investment due diligence research on a target company, covering financial health, market position, management team, competitive moat, risks, and valuation analysis with comparable transactions.',
      },
      {
        label: 'Research customer personas and journey maps',
        prompt: 'Research and develop detailed customer personas and journey maps for a B2B SaaS product, including pain points, decision criteria, touchpoint analysis, and conversion optimization opportunities.',
      },
    ],
  },
  {
    id: 'games',
    pillLabel: 'Create games',
    chipLabel: 'Create games',
    chipNoun: 'Games',
    icon: 'gamepad',
    placeholder: 'Describe the game you want to create',
    instruction: 'Create a playable game.',
    samplesVariant: 'rows',
    samples: [
      {
        label: 'Firefly memory sequence',
        prompt: 'Make a color memory game: four glowing spots light up in a growing sequence, the player repeats the sequence by clicking them in order, and one mistake ends the run. Style it as fireflies blinking on lily pads across a moonlit pond, each with its own soft chime.',
      },
      {
        label: 'Celestial merge 2048',
        prompt: 'Make a sliding number merge puzzle on a 4x4 grid: swipe to slide all tiles in one direction, matching tiles merge into their sum, and the goal is to reach the highest tile before the board fills up. Style the tiles as celestial bodies that evolve from asteroids to moons, planets, and blazing suns as they merge, set against a starry night sky.',
      },
      {
        label: 'Paper plane tap flyer',
        prompt: 'Make a one-tap flying game: the player taps to keep flying upward against gravity, steering through gaps between obstacles, and the score counts how many obstacles are passed. Style it as a folded paper plane gliding through a hand-drawn notebook world of pencil-sketched pipes and doodle clouds.',
      },
      {
        label: 'Neon falling blocks',
        prompt: 'Make a classic falling-block puzzle game: four-square geometric pieces drop from the top, the player moves and rotates them to fill horizontal lines, completed lines clear and score points, and the speed increases over time. Style it as glowing neon glass blocks on a dark cyberpunk grid, with a satisfying light-burst effect when lines clear.',
      },
      {
        label: 'Classic snake game',
        prompt: 'Make a classic snake game: the snake moves around a grid eating food, grows longer with each bite, and dies if it hits a wall or its own body. Style it as a koi fish gliding through a tranquil Japanese zen garden viewed from above, leaving a gentle ripple trail on the water.',
      },
    ],
  },
];

/** Outgoing message for a selected mode: the user text, then the instruction
    line. Appended (not prepended) because the task title, sidebar preview, and
    search index all derive from the message HEAD — a leading instruction would
    make every task of a mode read identically and bury the user's actual ask. */
export function composeModeMessage(mode, text) {
  if (!mode) return text;
  // A picked sample is already a full prompt — appending the instruction
  // would send a doubled signal ("…zen garden.\n\nCreate a playable game.").
  if (mode.samples.some((s) => s.prompt === text.trim())) return text;
  return `${text}\n\n${mode.instruction}`;
}
