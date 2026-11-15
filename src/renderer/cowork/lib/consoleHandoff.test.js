import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureConsoleHandoff, takeConsoleHandoff, findSample, sampleId, isUntouchedSample,
} from './consoleHandoff';
import { OWN_WORK_PROMPT } from '../components/onboarding/steps';

const at = (search, pathname = '/') => ({ search, pathname, hash: '' });

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('console handoff', () => {
  // The console links to these ids, from Home and from the Gallery's use cases
  // and features. Renaming a label changes its id and breaks that link, which
  // opens an empty composer.
  it.each([
    ['games', 'classic-snake-game', 'Classic snake game'],
    ['games', 'celestial-merge-2048', 'Celestial merge 2048'],
    ['visualization', 'track-monthly-kpis-across-departments', 'Track monthly KPIs across departments'],
    ['apps', 'build-a-quote-or-invoice-generator', 'Build a quote or invoice generator'],
    ['apps', 'build-study-planning-and-progress-tool', 'Build study planning and progress tool'],
    ['website', 'build-a-landing-page-for-a-product-launch', 'Build a landing page for a product launch'],
    ['spreadsheet', 'clean-up-my-spreadsheet-and-chart-it', 'Clean up my spreadsheet and chart it'],
    ['spreadsheet', 'compile-a-north-america-ai-conference-calendar', 'Compile a North America AI conference calendar'],
    ['wide-research', 'summarize-a-document-and-draft-my-reply', 'Summarize a document and draft my reply'],
    ['website', 'build-a-project-status-page', 'Build a project status page'],
    ['website', 'build-a-team-offsite-invitation-page', 'Build a team offsite invitation page'],
    ['website', 'build-a-feature-announcement-page', 'Build a feature announcement page'],
    ['wide-research', 'research-a-prospect-and-draft-outreach', 'Research a prospect and draft outreach'],
    ['spreadsheet', 'pull-key-terms-out-of-a-contract', 'Pull key terms out of a contract'],
    ['wide-research', 'coach-me-on-a-deal-from-a-call-transcript', 'Coach me on a deal from a call transcript'],
    ['wide-research', 'turn-meeting-notes-into-action-items', 'Turn meeting notes into action items'],
    ['visualization', 'build-a-project-rollout-timeline', 'Build a project rollout timeline'],
    ['visualization', 'map-a-process-as-a-diagram', 'Map a process as a diagram'],
  ])('resolves %s/%s, which the console links to', (mode, id, label) => {
    expect(findSample(mode, id)?.sample.label).toBe(label);
  });

  // The console's Gallery shows each sample's prompt as a copy of this text,
  // and Make your own sends what Cowork holds. Editing a prompt here without
  // the console's copy shows people one prompt and sends another.
  it.each([
    ["games", "celestial-merge-2048", "Make a sliding number merge puzzle on a 4x4 grid: swipe to slide all tiles in one direction, matching tiles merge into their sum, and the goal is to reach the highest tile before the board fills up. Style the tiles as celestial bodies that evolve from asteroids to moons, planets, and blazing suns as they merge, set against a starry night sky."],
    ["games", "classic-snake-game", "Make a classic snake game: the snake moves around a grid eating food, grows longer with each bite, and dies if it hits a wall or its own body. Style it as a koi fish gliding through a tranquil Japanese zen garden viewed from above, leaving a gentle ripple trail on the water."],
    ["apps", "build-a-quote-or-invoice-generator", "Build a single-page quote and invoice generator for my business: company details at the top, line items with quantity and price, automatic totals and tax, and a clean printable layout."],
    ["visualization", "track-monthly-kpis-across-departments", "Build a KPI dashboard with monthly metrics for sales, marketing, product, and support, with trend charts. Use sample data I can replace."],
    ["website", "build-a-landing-page-for-a-product-launch", "Build a landing page for an upcoming product launch, with a hero section, feature highlights, testimonials, an FAQ, and an email signup form."],
    ["apps", "build-study-planning-and-progress-tool", "Design a study planning tool for setting learning goals, breaking them into tasks, and tracking progress."],
    ["spreadsheet", "clean-up-my-spreadsheet-and-chart-it", "I'm going to attach a spreadsheet or CSV. Clean it up (duplicates, blanks, odd dates), tell me what you changed, and chart the main trend."],
    ["wide-research", "summarize-a-document-and-draft-my-reply", "I'm going to attach a document. Summarize it, list what I need to do, and draft a reply I can send."],
    ["spreadsheet", "compile-a-north-america-ai-conference-calendar", "Help me collect upcoming AI industry conferences in North America for the rest of the year and compile them into a calendar."],
    ["wide-research", "research-a-prospect-and-draft-outreach", "Fernhill Freight is a made-up company for this example: a 900-person regional trucking and warehousing business in the US Midwest that is growing an e-commerce fulfillment line. Research what companies like it are dealing with right now, then write a one-page brief for a first conversation with their Head of Revenue Operations: what the company does, what is happening in its industry, likely priorities for this person, and two angles for a conversation. Then draft a short, personalized first email."],
    ["spreadsheet", "pull-key-terms-out-of-a-contract", "Write a realistic sample vendor services contract, then extract its key terms into a table: parties, start and end dates, renewal and notice period, payment terms, liability cap, termination rights. Flag anything unusual or one-sided. Afterwards I'll attach my own contract for the same treatment."],
    ["wide-research", "coach-me-on-a-deal-from-a-call-transcript", "Write a realistic sample sales call transcript (about a page, with speaker turns), then score the deal on budget, authority, need and timing with a quote as evidence for each, list the risks and open questions, suggest next steps, and draft the follow-up email. Afterwards I'll paste a real transcript."],
    ["wide-research", "turn-meeting-notes-into-action-items", "I'm going to paste a meeting transcript or rough notes (if I don't, use a realistic sample). Pull out decisions, action items with owners and due dates, and open questions, then draft a short recap email I can send to attendees."],
    ["visualization", "build-a-project-rollout-timeline", "Build a project rollout timeline as a swimlane Gantt chart grouped by phase, with an owner color per team and a status column. Clicking an item opens its details. Use a sample 12-week project I can replace with mine."],
    ["visualization", "map-a-process-as-a-diagram", "Build a left-to-right process diagram with two swimlanes (a person and an AI agent), steps, diamond checkpoints between steps, and details on hover. Draw every arrow from the actual positions of the shapes it connects, so each arrow starts and ends on a shape. Use a sample process I can replace with mine."],
    ["website", "build-a-project-status-page", "Build a web page with a status update for a website redesign: five milestones with owners and dates, a progress bar at 60%, and a short risks section."],
    ["website", "build-a-team-offsite-invitation-page", "Build a web page inviting the team to an offsite on Friday 4 December in Lisbon, with the agenda, travel notes and a packing list."],
    ["website", "build-a-feature-announcement-page", "Build a web page announcing a new 'shared calendars' feature, with a headline, three benefits and a short FAQ."],
  ])('keeps %s/%s word for word as the console Gallery shows it', (mode, id, prompt) => {
    expect(findSample(mode, id)?.sample.prompt).toBe(prompt);
  });

  it('keeps the console placement it knows, so the task can be credited to it', () => {
    window.history.replaceState(null, '', '/?from=console&mode=games&sample=celestial-merge-2048&placement=gallery');
    captureConsoleHandoff(at('?from=console&mode=games&sample=celestial-merge-2048&placement=gallery'));

    expect(window.location.search).toBe('');
    expect(takeConsoleHandoff()).toMatchObject({ entrySource: 'console', placement: 'gallery' });
  });

  it('drops a placement it does not know instead of storing it', () => {
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game&placement=<script>'));
    expect(window.sessionStorage.getItem('anton.consoleHandoff')).not.toContain('script');
    expect(takeConsoleHandoff().placement).toBeNull();
  });

  it('survives the login round trip: captured before the redirect, taken after it', () => {
    window.history.replaceState(null, '', '/?from=console&mode=games&sample=classic-snake-game');
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game'));
    // Keycloak returns to the bare pathname; capture on that load must not erase the stash.
    captureConsoleHandoff(at(''));

    const handoff = takeConsoleHandoff();
    expect(handoff.entrySource).toBe('console');
    expect(handoff.mode.id).toBe('games');
    expect(sampleId(handoff.sample.label)).toBe('classic-snake-game');
  });

  it('applies once', () => {
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game'));
    expect(takeConsoleHandoff()).not.toBeNull();
    expect(takeConsoleHandoff()).toBeNull();
  });

  it('strips its params from the address bar and keeps any others', () => {
    window.history.replaceState(null, '', '/?from=console&mode=games&sample=classic-snake-game&ci=1');
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game&ci=1'));
    expect(window.location.search).toBe('?ci=1');
  });

  it('degrades an unknown sample to an empty composer instead of storing it', () => {
    captureConsoleHandoff(at('?from=console&mode=games&sample=<script>'));
    expect(window.sessionStorage.getItem('anton.consoleHandoff')).not.toContain('script');
    expect(takeConsoleHandoff()).toEqual({ entrySource: 'console', mode: null, sample: null, start: null, placement: null });
  });

  it('carries the own-work start, which names the first onboarding step and no text', () => {
    captureConsoleHandoff(at('?from=console&start=own-work'));
    expect(takeConsoleHandoff()).toEqual({ entrySource: 'console', mode: null, sample: null, start: 'own-work', placement: null });
  });

  it('drops a start it does not know instead of storing it', () => {
    captureConsoleHandoff(at('?from=console&start=<script>'));
    expect(window.sessionStorage.getItem('anton.consoleHandoff')).not.toContain('script');
    expect(takeConsoleHandoff().start).toBeNull();
  });

  it('prefers a sample over a start when a link names both', () => {
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game&start=own-work'));
    const handoff = takeConsoleHandoff();
    expect(sampleId(handoff.sample.label)).toBe('classic-snake-game');
    expect(handoff.start).toBeNull();
  });

  it('strips the start param from the address bar too', () => {
    window.history.replaceState(null, '', '/?from=console&start=own-work&ci=1');
    captureConsoleHandoff(at('?from=console&start=own-work&ci=1'));
    expect(window.location.search).toBe('?ci=1');
  });

  it('reads a handoff stored without a start, as older tabs wrote it', () => {
    window.sessionStorage.setItem('anton.consoleHandoff', JSON.stringify({
      entrySource: 'console', modeId: null, sampleId: null, at: Date.now(),
    }));
    expect(takeConsoleHandoff()).toEqual({ entrySource: 'console', mode: null, sample: null, start: null, placement: null });
  });

  it('ignores links that are not from the console', () => {
    captureConsoleHandoff(at('?mode=games&sample=classic-snake-game'));
    expect(takeConsoleHandoff()).toBeNull();
  });

  it('expires a handoff abandoned mid-login', () => {
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game'));
    expect(takeConsoleHandoff(window.sessionStorage, Date.now() + 11 * 60 * 1000)).toBeNull();
  });

  it('treats the own-work prompt as text the app placed, not the person\'s own', () => {
    expect(isUntouchedSample(OWN_WORK_PROMPT)).toBe(true);
    expect(isUntouchedSample(`${OWN_WORK_PROMPT} Also my notes.`)).toBe(false);
  });
});
