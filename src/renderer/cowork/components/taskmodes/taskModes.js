// Task modes for the home composer (ENG-1594). Each mode is a pill under the
// composer; picking one shows a removable chip in the composer toolbar, swaps
// the placeholder, and surfaces that mode's sample prompts. Picking a sample
// drops its FULL `prompt` into the composer (the short `label` is only the
// list text) — same as Manus. All texts captured from manus.im (2026-08-14),
// brand-adapted where they name the product. Website has no sample prompts on
// Manus (it shows a category flow instead), so those prompts are authored in
// the same style from Manus's website categories.
// The samples that start from the person's own file, notes or inbox, the
// habit tracker, the prospect, competitor and lead-list research, and the
// work samples that write their own realistic sample to work on (a contract,
// a call transcript, a project plan, a report, a bank statement, lecture
// notes) are ours, not Manus's. The work samples lead with the sample on
// purpose: asked for a file first, the free-tier model stops and waits, and a
// first click must still produce something. A sample with `plain: true` sits in a mode its instruction does
// not fit (a weekly update is not a slide deck), and the person is expected to
// add to it, so it is sent as written even then.
//
// `ownData: true` marks a mode whose examples work on sample data or a
// document, so the finished example offers "Do this with my own data". A
// sample can set its own `ownData` to differ from its mode. Games, websites
// and apps make something new and have nothing of the person's to swap in.
//
// `icon` is an Icons.jsx key (resolved dynamically — keep keys in sync with
// that file). `samplesVariant` mirrors Manus: slides + visualization render
// sample cards under a heading, the rest render plain rows. `chipNoun`
// (optional) is the noun the chip's remove aria-label uses when `chipLabel`
// is a verb phrase — "Remove Games mode" reads better than
// "Remove Create games mode".

import { HABIT_TRACKER_PROMPT } from '../onboarding/steps';
import i18n from '../../../lib/i18n';

export const TASK_MODES = [
  {
    id: 'slides',
    ownData: true,
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
      {
        label: "Draft this week's update from last week's",
        prompt: "I'm going to paste last week's update and my rough notes for this week. Draft this week's update in the same format, highlight what changed, and ask me if anything is unclear.",
        plain: true,
      },
      {
        label: 'Turn a report into a presentation',
        prompt: 'Write a realistic sample four-page project report, then turn it into a 10-slide presentation for a 10-minute talk, with a consistent color theme, speaker notes, and a time per slide. Afterwards I\'ll attach my own document.',
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
      {
        label: 'Build a project status page',
        prompt: 'Build a web page with a status update for a website redesign: five milestones with owners and dates, a progress bar at 60%, and a short risks section.',
      },
      {
        label: 'Build a team offsite invitation page',
        prompt: 'Build a web page inviting the team to an offsite on Friday 4 December in Lisbon, with the agenda, travel notes and a packing list.',
      },
      {
        label: 'Build a feature announcement page',
        prompt: "Build a web page announcing a new 'shared calendars' feature, with a headline, three benefits and a short FAQ.",
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
      {
        label: 'Build a quote or invoice generator',
        prompt: 'Build a single-page quote and invoice generator for my business: company details at the top, line items with quantity and price, automatic totals and tax, and a clean printable layout.',
      },
      {
        label: 'Explain an error and suggest a fix',
        prompt: "I'm going to paste an error message or a link to my code. Explain the likely cause in two sentences and propose a fix.",
        plain: true,
      },
      {
        label: 'Build a habit tracker',
        prompt: HABIT_TRACKER_PROMPT,
      },
    ],
  },
  {
    id: 'spreadsheet',
    ownData: true,
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
      {
        label: 'Clean up my spreadsheet and chart it',
        prompt: "I'm going to attach a spreadsheet or CSV. Clean it up (duplicates, blanks, odd dates), tell me what you changed, and chart the main trend.",
      },
      {
        label: 'Pull key terms out of a contract',
        prompt: 'Write a realistic sample vendor services contract, then extract its key terms into a table: parties, start and end dates, renewal and notice period, payment terms, liability cap, termination rights. Flag anything unusual or one-sided. Afterwards I\'ll attach my own contract for the same treatment.',
        plain: true,
      },
      {
        label: 'Turn a bank statement into a spreadsheet',
        prompt: 'Create a realistic sample one-month bank statement, then convert it into an Excel workbook with one transaction per row (date, description, money in, money out, running balance). Check that the totals match the statement and list anything that doesn\'t reconcile. Afterwards I\'ll attach my real statement.',
      },
    ],
  },
  {
    id: 'visualization',
    ownData: true,
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
      {
        label: 'Build a project rollout timeline',
        prompt: 'Build a project rollout timeline as a swimlane Gantt chart grouped by phase, with an owner color per team and a status column. Clicking an item opens its details. Use a sample 12-week project I can replace with mine.',
      },
      {
        label: 'Map a process as a diagram',
        prompt: 'Build a left-to-right process diagram with two swimlanes (a person and an AI agent), steps, diamond checkpoints between steps, and details on hover. Draw every arrow from the actual positions of the shapes it connects, so each arrow starts and ends on a shape. Use a sample process I can replace with mine.',
      },
    ],
  },
  {
    id: 'wide-research',
    ownData: true,
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
      {
        label: 'Summarize a document and draft my reply',
        prompt: "I'm going to attach a document. Summarize it, list what I need to do, and draft a reply I can send.",
        plain: true,
      },
      {
        label: 'Choose a local model that fits my computer',
        prompt: 'Help me choose a local AI model that fits my computer. Ask for my specs, compare two or three options for daily use, coding and documents, and recommend one.',
        plain: true,
      },
      {
        label: 'Review what is on my plate this week',
        prompt: "What's on my plate this week? Look through my recent Gmail and list my main work items with a priority and timing for each. Read only: don't send, delete or change anything.",
        plain: true,
      },
      {
        label: 'Research a prospect and draft outreach',
        prompt: 'Fernhill Freight is a made-up company for this example: a 900-person regional trucking and warehousing business in the US Midwest that is growing an e-commerce fulfillment line. Research what companies like it are dealing with right now, then write a one-page brief for a first conversation with their Head of Revenue Operations: what the company does, what is happening in its industry, likely priorities for this person, and two angles for a conversation. Then draft a short, personalized first email.',
      },
      {
        label: 'Coach me on a deal from a call transcript',
        prompt: 'Write a realistic sample sales call transcript (about a page, with speaker turns), then score the deal on budget, authority, need and timing with a quote as evidence for each, list the risks and open questions, suggest next steps, and draft the follow-up email. Afterwards I\'ll paste a real transcript.',
        plain: true,
      },
      {
        label: 'Turn meeting notes into action items',
        prompt: "I'm going to paste a meeting transcript or rough notes (if I don't, use a realistic sample). Pull out decisions, action items with owners and due dates, and open questions, then draft a short recap email I can send to attendees.",
        plain: true,
      },
      {
        label: 'Map a competitor\'s go-to-market',
        prompt: 'Build a one-page competitor snapshot of Clay from public sources: what it sells and to whom, its top three competitors and how it positions against each, and the signals that someone is ready to buy. Cite a source for each part and save it as a Word document. Then tell me where a newer competitor could win against Clay and where Clay is hard to beat. Afterwards I\'ll describe my company so you can compare us.',
      },
      {
        label: 'Make a study guide from course material',
        prompt: 'Write a realistic sample set of lecture notes on the basics of contract law, then turn them into a study guide: key concepts, definitions in the exact wording from the notes, a glossary, and a 10-question practice quiz with answers. Save it as a document. Afterwards I\'ll attach my own slides.',
        plain: true,
      },
      {
        label: 'Build a ranked lead list',
        prompt: 'Find 15 mid-sized companies in Germany that make industrial machinery and could need 3D-printed prototypes. Return a ranked spreadsheet with company, what they make, size, a fit score from 0 to 100, why they fit, and a source link. Don\'t invent contact details.',
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
        label: 'Classic snake game',
        prompt: 'Make a classic snake game: the snake moves around a grid eating food, grows longer with each bite, and dies if it hits a wall or its own body. Style it as a koi fish gliding through a tranquil Japanese zen garden viewed from above, leaving a gentle ripple trail on the water.',
      },
      {
        label: 'Neon falling blocks',
        prompt: 'Make a classic falling-block puzzle game: four-square geometric pieces drop from the top, the player moves and rotates them to fill horizontal lines, completed lines clear and score points, and the speed increases over time. Style it as glowing neon glass blocks on a dark cyberpunk grid, with a satisfying light-burst effect when lines clear.',
      },
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
    ],
  },
];

/** Outgoing message for a selected mode: the user text, then the instruction
    line. Appended (not prepended) because the task title, sidebar preview, and
    search index all derive from the message HEAD — a leading instruction would
    make every task of a mode read identically and bury the user's actual ask. */
const wordsOf = (text) => new Set(String(text).toLowerCase().match(/[a-z0-9']+/g) || []);

// Whether the text is still the picked example, however it was edited: most of
// the example's words are still in it. Wiping the box and typing something else
// is not an edit of the example.
export function resemblesSample(sample, text) {
  const have = wordsOf(text);
  const want = [...wordsOf(sample.prompt)];
  return want.length > 0 && want.filter((w) => have.has(w)).length / want.length >= 0.5;
}

/** The outgoing message for a selected mode, and what happened to the mode's
    instruction line: `appended`, `replaced_example` (an example was placed and
    the person sent something else instead, so the line would describe a
    request they did not make), or `example` (the text is an example, which
    already says what it wants). `modeLine` is null when no mode applies. */
export function modeMessage(mode, text, pickedSample) {
  if (!mode || !mode.instruction) return { text, modeLine: null };
  // A placed example takes the line only while it is all still there: the
  // person added text before or after it, nothing else. An edit inside it, a
  // paste over it or clearing it makes the text their own request, which can
  // share most of the example's words and still ask for something else. When
  // in doubt it counts as replaced: a request left without the line still
  // says what it wants, while a line under a different request contradicts it.
  if (pickedSample && !pickedSample.plain && !text.includes(pickedSample.prompt)) {
    return { text, modeLine: 'replaced_example' };
  }
  if (pickedSample?.plain && !resemblesSample(pickedSample, text)) {
    return { text, modeLine: 'replaced_example' };
  }
  // A plain example the person picked keeps its own wording however they edit it.
  if (pickedSample?.plain && mode.samples.includes(pickedSample)) return { text, modeLine: 'example' };
  const sent = text.trim();
  // A picked sample is already a full prompt — appending the instruction
  // would send a doubled signal ("…zen garden.\n\nCreate a playable game.").
  if (mode.samples.some((s) => s.prompt === sent)) return { text, modeLine: 'example' };
  // A plain sample keeps its own wording once the person adds to it.
  if (mode.samples.some((s) => s.plain && sent.startsWith(s.prompt))) return { text, modeLine: 'example' };
  return { text: `${text}\n\n${mode.instruction}`, modeLine: 'appended' };
}

export function composeModeMessage(mode, text, pickedSample) {
  return modeMessage(mode, text, pickedSample).text;
}

// What the checklist's "Try an example" row opens on Home: one short list that
// crosses modes, led by the cheap, reliable ones. It is not one of the pills,
// and it has no instruction of its own, so nothing is added to what is sent.
const FEATURED_LABELS = [
  'Classic snake game',
  'Neon falling blocks',
  'Show weekly sales activity via heatmap',
  'Build a habit tracker',
  'Build a quote or invoice generator',
  "Draft this week's update from last week's",
  'Review what is on my plate this week',
];
const ALL_SAMPLES = TASK_MODES.flatMap((m) => m.samples);

export const FEATURED_EXAMPLES_MODE = {
  id: 'examples',
  chipLabel: 'Examples',
  icon: 'sparkle',
  placeholder: 'Pick an example, or describe your own task',
  instruction: '',
  samplesVariant: 'rows',
  samples: FEATURED_LABELS.map((label) => ALL_SAMPLES.find((s) => s.label === label)).filter(Boolean),
};

// What the checklist's "Start with your own work" row opens on Home. Nothing
// is sent until the person gives Cowork something of theirs: a file, pasted
// text or a link. A job is optional. Whatever is sent asks Cowork to start on
// stated assumptions, because a reply that opens with a question is where
// people left.
export const OWN_WORK_START_NOW =
  "Start right away with sensible assumptions and tell me what you assumed. Don't ask me questions first.";
export const OWN_WORK_LEAD =
  "Here's something from my work. Take a useful first step with it and tell me what you did, then suggest two or three things you could do next.";

// A job's label is its message text and, through sampleId, its analytics id;
// what a person reads comes from the chat catalog (ownWork.jobs.<group>.<n>).
const job = (label) => ({ label, prompt: label });
export const OWN_WORK_JOB_GROUPS = [
  {
    id: 'finance',
    jobs: [
      job('Turn these bank statements or invoices into one spreadsheet.'),
      job('Build the next monthly report from these numbers.'),
      job('Check these statements for errors or unusual items.'),
    ],
  },
  {
    id: 'sales',
    jobs: [
      job('Clean up this customer list and flag duplicates.'),
      job('Compare these two price lists and show what changed.'),
      job('Draft follow-up emails from these call notes.'),
    ],
  },
  {
    id: 'operations',
    jobs: [
      job('Turn these meeting notes into decisions and action items.'),
      job('Turn these notes into a one-page brief.'),
      job('Turn this process document into a step-by-step checklist.'),
    ],
  },
  {
    id: 'legal',
    jobs: [
      job('Summarize the key terms and risks in this contract.'),
      job('Summarize this report and pull out the numbers that matter.'),
      job('Read this page and tell me what matters for us.'),
    ],
  },
];

export const OWN_WORK_MODE = {
  id: 'own-work',
  chipLabel: 'Your work',
  icon: 'attach',
  placeholder: 'Paste text or a link, or attach a file',
  instruction: OWN_WORK_START_NOW,
  samplesVariant: 'own-work',
  samples: OWN_WORK_JOB_GROUPS.flatMap((g) => g.jobs),
};

/** The job a draft starts with, or null. */
export function ownWorkJobIn(text) {
  const sent = String(text || '').trim();
  return OWN_WORK_MODE.samples.find((j) => sent.startsWith(j.prompt)) ?? null;
}

/** The job a prompt belongs to, or null. */
export const findOwnWorkJob = (prompt) => OWN_WORK_MODE.samples.find((j) => j.prompt === prompt) ?? null;

const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
// Fewer new words than this, beside an edited job, read as a reworded job.
const MIN_ADDED_WORDS = 3;

/** Whether a draft in the own-work mode carries something of the person's:
    an attachment, or text beyond the job it starts with. When a job was picked
    and then edited, so the draft no longer starts with it, a draft that keeps
    most of the job's words is still that job unless it adds a link or a few
    words the job does not have: shortening or rewording a job gives Cowork
    nothing to work on. A draft that dropped the job is the person's own. */
export function hasOwnMaterial(text, attachmentCount = 0, pickedJob = null) {
  if (attachmentCount > 0) return true;
  const sent = String(text || '').trim();
  const job = ownWorkJobIn(sent);
  if (job) return sent.slice(job.prompt.length).trim().length > 0;
  if (!pickedJob) return sent.length > 0;
  const known = new Set(words(pickedJob.prompt));
  const drafted = words(sent);
  const kept = [...known].filter((w) => drafted.includes(w)).length;
  if (kept * 2 < known.size) return sent.length > 0;
  if (/(?:https?:\/\/|www\.)\S/i.test(sent)) return true;
  return drafted.filter((w) => !known.has(w)).length >= MIN_ADDED_WORDS;
}

/** The message the own-work mode sends: the job, or a generic first step when
    there is none, the start-now instruction, then the person's material. */
export function composeOwnWorkMessage(text) {
  const sent = String(text || '').trim();
  const picked = ownWorkJobIn(sent);
  const lead = picked ? picked.prompt : OWN_WORK_LEAD;
  const material = (picked ? sent.slice(picked.prompt.length) : sent).trim();
  return `${lead} ${OWN_WORK_START_NOW}${material ? `\n\n${material}` : ''}`;
}

/* What a person reads is translated when it is read; the English above stays
   the data. A mode's pill, chip and placeholder text are getters onto the
   chat catalog (taskModes.<mode id>.<field>), so every surface that shows
   them gets the current language without asking. A sample's label doubles as
   its id (console links, the featured list), so it stays English in the data
   and `sampleLabel` translates it for display. `instruction` and `prompt` are
   message text the agent reads, and are never translated. */
const DISPLAY_FIELDS = ['pillLabel', 'chipLabel', 'chipNoun', 'placeholder'];
for (const mode of [...TASK_MODES, FEATURED_EXAMPLES_MODE, OWN_WORK_MODE]) {
  for (const field of DISPLAY_FIELDS) {
    if (!(field in mode)) continue;
    const english = mode[field];
    Object.defineProperty(mode, field, {
      enumerable: true,
      get: () => i18n.t(`taskModes.${mode.id}.${field}`, { ns: 'chat', defaultValue: english }),
    });
  }
}

/** A sample's label in the current language: built-in samples by their mode
    and position, anything else as given. */
export function sampleLabel(sample) {
  for (const mode of TASK_MODES) {
    const index = mode.samples.indexOf(sample);
    if (index >= 0) return i18n.t(`taskModes.${mode.id}.samples.${index}`, { ns: 'chat', defaultValue: sample.label });
  }
  return sample?.label;
}

/** Whether a finished example invites the person's own data in place of
    the sample it made up. The cross-mode Examples list holds the same sample
    objects, so each of its entries answers by the mode it comes from. */
export function exampleTakesOwnData(sample) {
  const mode = TASK_MODES.find((m) => m.samples.includes(sample));
  return Boolean(sample?.ownData ?? mode?.ownData);
}

/** The example a sent message starts from, or null. The message may carry
    the person's additions or the mode's instruction after the prompt. */
export function exampleForMessage(text) {
  const sent = typeof text === 'string' ? text.trim() : '';
  if (!sent) return null;
  for (const mode of TASK_MODES) {
    const sample = mode.samples.find((s) => sent.startsWith(s.prompt));
    if (sample) return sample;
  }
  return null;
}

/** The mode and sample whose prompt is exactly `prompt`, or null. */
export function findSampleByPrompt(prompt) {
  for (const mode of TASK_MODES) {
    const sample = mode.samples.find((s) => s.prompt === prompt);
    if (sample) return { mode, sample };
  }
  return null;
}
