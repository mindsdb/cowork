import type { CodingEvent } from './api';


// Codex runs every command through a login shell. The wrapper is the same on
// every row, so showing it only pushes the part that differs off-screen.
const SHELL_WRAPPER = /^\/bin\/(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/;

// Codex echoes the user's own message back as an item. It is not work.
const IGNORED_ITEM_TYPES = new Set(['userMessage']);

type ActionKind = 'edit' | 'command' | 'read' | 'search' | 'list' | 'tool' | 'plan' | 'compact' | 'retry';

const ACTION_ORDER: ActionKind[] = ['edit', 'command', 'read', 'search', 'list', 'tool', 'plan', 'compact', 'retry'];

const ACTION_PHRASE: Record<ActionKind, (count: number) => string> = {
  edit: (count) => `edited ${count} ${count === 1 ? 'file' : 'files'}`,
  command: (count) => `ran ${count} ${count === 1 ? 'command' : 'commands'}`,
  read: (count) => `read ${count} ${count === 1 ? 'file' : 'files'}`,
  search: (count) => `searched ${count} ${count === 1 ? 'time' : 'times'}`,
  list: (count) => `listed ${count} ${count === 1 ? 'folder' : 'folders'}`,
  tool: (count) => `used ${count} ${count === 1 ? 'tool' : 'tools'}`,
  plan: () => 'updated the plan',
  compact: () => 'compacted context',
  retry: (count) => (count === 1 ? 'retried once' : `retried ${count} times`),
};

interface CommandAction {
  type: string;
  command: string;
  name: string;
  path: string;
  query: string;
}


function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}


function commandActions(event: CodingEvent): CommandAction[] {
  const raw = event.data.commandActions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((action): action is Record<string, unknown> => !!action && typeof action === 'object').map((action) => ({
    type: text(action.type),
    command: text(action.command),
    name: text(action.name),
    path: text(action.path),
    query: text(action.query),
  }));
}


export function isIgnoredActivity(event: CodingEvent): boolean {
  return event.type === 'tool' && IGNORED_ITEM_TYPES.has(text(event.data.type));
}


// Compaction drops earlier context, which explains why the agent may re-read
// files afterwards, so group headlines name it rather than count it as a tool.
export function isCompaction(event: CodingEvent): boolean {
  return event.type === 'tool' && text(event.data.type) === 'contextCompaction';
}


export function displayCommand(event: CodingEvent): string {
  const actions = commandActions(event);
  if (actions.length === 1 && actions[0].command) return actions[0].command;
  const raw = (text(event.data.command) || event.title).trim();
  const match = raw.match(SHELL_WRAPPER);
  if (!match) return raw;
  return match[1] === '"' ? match[2].replace(/\\(["\\$`])/g, '$1') : match[2];
}


function actionKinds(event: CodingEvent): ActionKind[] {
  if (event.type === 'file_change') {
    const changes = Array.isArray(event.data.changes) ? event.data.changes.length : 0;
    return Array.from({ length: Math.max(1, changes) }, () => 'edit' as const);
  }
  if (isCompaction(event)) return ['compact'];
  if (event.type === 'tool') return ['tool'];
  if (event.type === 'error') return ['retry'];
  if (isPlanUpdate(event)) return ['plan'];
  if (event.type !== 'command') return [];
  const actions = commandActions(event);
  if (!actions.length || actions.some((action) => !['read', 'search', 'listFiles'].includes(action.type))) return ['command'];
  return actions.map((action) => (action.type === 'read' ? 'read' : action.type === 'search' ? 'search' : 'list'));
}


// Streamed fragments of one item can be split by other events, so the same
// command may appear as separate `started` and `completed` entries. Count
// each item once, by its latest state.
function latestPerItem(events: CodingEvent[]): CodingEvent[] {
  const byItem = new Map<string, CodingEvent>();
  for (const event of events) {
    if (isIgnoredActivity(event)) continue;
    byItem.set(event.item_id || `seq-${event.seq}`, event);
  }
  return [...byItem.values()];
}


function sentence(phrases: string[]): string {
  const joined = new Intl.ListFormat('en', { type: 'conjunction' }).format(phrases);
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}


export function activityHeadline(events: CodingEvent[]): string {
  const counts = new Map<ActionKind, number>();
  // The live status line already names the action in progress, so the
  // headline only counts what has finished.
  const finished = latestPerItem(events).filter((event) => !isLive(event) && actionKinds(event).length);
  for (const event of finished) {
    for (const kind of actionKinds(event)) counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  // One action reads better by name than as a count, e.g. "Read api.ts".
  if (finished.length === 1 && actionKinds(finished[0]).length === 1 && finished[0].type !== 'error') {
    const step = stepLabel(finished[0]);
    return [step.verb, step.target].filter(Boolean).join(' ');
  }
  const phrases = ACTION_ORDER.filter((kind) => counts.get(kind)).map((kind) => ACTION_PHRASE[kind](counts.get(kind) || 0));
  if (phrases.length) return sentence(phrases);
  if (events.some((event) => event.type === 'approval' && event.phase === 'pending')) return 'Asked for approval';
  return events.some((event) => event.type === 'reasoning') ? 'Thought it through' : 'Agent activity';
}


// A plan update always arrives as progress, but each one is complete.
function isLive(event: CodingEvent): boolean {
  return !isPlanUpdate(event) && (event.phase === 'started' || event.phase === 'progress');
}


const STATUS_MAX_LENGTH = 80;


// A summary streams in as text deltas, or arrives whole on the finished
// reasoning item, depending on the model.
export function reasoningSummary(event: CodingEvent): string {
  if (event.text) return event.text;
  const summary = event.data.summary;
  if (!Array.isArray(summary)) return '';
  return summary
    .map((part) => (typeof part === 'string' ? part : part && typeof part === 'object' ? text((part as Record<string, unknown>).text) : ''))
    .join('\n');
}


// GPT summaries open with a bold heading such as "**Checking the docs**", and
// Codex uses that heading as its status line. Claude's summaries are plain
// prose, so they fall back to their first sentence.
export function reasoningHeading(event: CodingEvent): string {
  const summary = reasoningSummary(event).trim();
  const heading = summary.match(/\*\*([^*\n]+)\*\*/);
  if (heading) return heading[1].trim();
  const sentence = summary.split(/(?<=[.!?])\s|\n/)[0]?.trim() || '';
  return sentence.length > STATUS_MAX_LENGTH ? `${sentence.slice(0, STATUS_MAX_LENGTH - 1).trimEnd()}…` : sentence;
}


function presentTense(event: CodingEvent): string {
  if (event.type === 'file_change') {
    const path = text(event.data.path) || event.title;
    return path ? `Editing ${path.split(/[\\/]/).at(-1)}` : 'Editing files';
  }
  if (isCompaction(event)) return 'Compacting context';
  if (event.type === 'tool' && text(event.data.tool)) return `Calling ${text(event.data.tool)}`;
  if (event.type === 'tool') return event.title ? `Using ${event.title}` : 'Using a tool';
  const actions = commandActions(event);
  const [first] = actions;
  if (actions.length === 1 && first.type === 'read') return `Reading ${first.name || first.path.split(/[\\/]/).at(-1) || 'a file'}`;
  if (actions.length === 1 && first.type === 'search') return first.query ? `Searching for ${first.query}` : 'Searching';
  if (actions.length === 1 && first.type === 'listFiles') return 'Listing files';
  return `Running ${displayCommand(event)}`;
}


export function liveStatusLabel(events: CodingEvent[]): string {
  // Codex reports each reconnect attempt, e.g. "Reconnecting... 1/2".
  const latest = events.at(-1);
  if (latest?.type === 'error') return latest.text.replace(/\.\.\./g, '…') || 'Reconnecting…';
  const current = latestPerItem(events);
  for (let index = current.length - 1; index >= 0; index -= 1) {
    const event = current[index];
    if (isLive(event) && ['command', 'tool', 'file_change'].includes(event.type)) return presentTense(event);
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type !== 'reasoning') continue;
    const heading = reasoningHeading(events[index]);
    if (heading) return heading;
  }
  return 'Thinking…';
}


function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}


export type StepIcon = 'read' | 'search' | 'list' | 'command' | 'edit' | 'tool' | 'image' | 'thought' | 'plan' | 'compact' | 'retry' | 'approval';

export interface StepLabel {
  icon: StepIcon;
  verb: string;
  target: string;
}


// One finished step in the past tense, e.g. "Read validation.ts" or
// "Ran npm test". The verb and target are styled apart.
export function stepLabel(event: CodingEvent): StepLabel {
  if (event.type === 'file_change') {
    const changes = fileChanges(event);
    if (changes.length === 1) return { icon: 'edit', ...changeLabel(changes[0]) };
    return { icon: 'edit', verb: 'Edited', target: `${changes.length} files` };
  }
  if (isPlanUpdate(event)) {
    const steps = planSteps(event);
    const done = steps.filter((step) => step.status === 'completed').length;
    return { icon: 'plan', verb: 'Updated the plan', target: steps.length ? `· ${done} of ${steps.length} done` : '' };
  }
  if (event.type === 'reasoning') return { icon: 'thought', verb: '', target: reasoningHeading(event) || 'Thought it through' };
  if (event.type === 'error') {
    const attempt = event.text.match(/\d+\/\d+/)?.[0];
    return { icon: 'retry', verb: 'Retried', target: `after the connection dropped${attempt ? ` (${attempt})` : ''}` };
  }
  if (event.type === 'approval') return { icon: 'approval', verb: 'Asked to run', target: displayCommand({ ...event, data: { command: event.text } }) || event.title };
  if (isCompaction(event)) return { icon: 'compact', verb: 'Compacted context', target: '' };
  if (event.type === 'tool') {
    if (text(event.data.type) === 'imageView') return { icon: 'image', verb: 'Viewed', target: basename(event.title) || 'an image' };
    const tool = text(event.data.tool);
    const server = text(event.data.server);
    if (tool) return { icon: 'tool', verb: 'Called', target: server ? `${server} · ${tool}` : tool };
    return { icon: 'tool', verb: 'Used', target: event.title || 'a tool' };
  }
  const actions = commandActions(event);
  const [first] = actions;
  if (actions.length === 1 && first.type === 'read') return { icon: 'read', verb: 'Read', target: first.name || basename(first.path) || displayCommand(event) };
  if (actions.length === 1 && first.type === 'search') return { icon: 'search', verb: first.query ? 'Searched for' : 'Searched', target: first.query };
  if (actions.length === 1 && first.type === 'listFiles') return { icon: 'list', verb: 'Listed', target: first.path || 'files' };
  return { icon: 'command', verb: 'Ran', target: displayCommand(event) };
}


export function commandOutput(event: CodingEvent): string {
  return (text(event.data.aggregatedOutput) || event.text).replace(/\n+$/, '');
}


export function exitCode(event: CodingEvent): number | null {
  return typeof event.data.exitCode === 'number' ? event.data.exitCode : null;
}


export function stepFailed(event: CodingEvent): boolean {
  if (event.type === 'error') return false;
  const code = exitCode(event);
  return event.phase === 'failed' || (code !== null && code !== 0);
}


export interface FileChange {
  path: string;
  kind: 'add' | 'update' | 'delete';
  patch: string;
  additions: number;
  deletions: number;
}


// Only lines inside a hunk are changes. An added `++counter` reads as
// `+++counter`, so matching the `+++`/`---` file headers by prefix would
// drop it.
function lineCounts(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) inHunk = false;
    else if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && line.startsWith('+')) additions += 1;
    else if (inHunk && line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}


// Codex sends an update as a unified diff, but an added or deleted file as
// its whole content. Both are turned into a patch the diff view can read.
function asPatch(kind: FileChange['kind'], diff: string): string {
  if (kind === 'update' || !diff) return diff;
  const lines = diff.replace(/\n$/, '').split('\n');
  const sign = kind === 'add' ? '+' : '-';
  const header = kind === 'add' ? `@@ -0,0 +1,${lines.length} @@` : `@@ -1,${lines.length} +0,0 @@`;
  return [header, ...lines.map((line) => `${sign}${line}`)].join('\n');
}


export function fileChanges(event: CodingEvent): FileChange[] {
  const raw = Array.isArray(event.data.changes) ? event.data.changes : [];
  const changes = raw
    .filter((change): change is Record<string, unknown> => !!change && typeof change === 'object')
    .map((change) => {
      const rawKind = change.kind && typeof change.kind === 'object' ? text((change.kind as Record<string, unknown>).type) : text(change.kind);
      const kind: FileChange['kind'] = rawKind === 'add' || rawKind === 'delete' ? rawKind : 'update';
      const patch = asPatch(kind, text(change.diff));
      return { path: text(change.path), kind, patch, ...lineCounts(patch) };
    });
  if (changes.length) return changes;
  const path = text(event.data.path) || event.text || event.title;
  return [{ path, kind: 'update', patch: '', additions: 0, deletions: 0 }];
}


export function changeLabel(change: FileChange): { verb: string; target: string } {
  const verb = change.kind === 'add' ? 'Created' : change.kind === 'delete' ? 'Deleted' : 'Edited';
  return { verb, target: basename(change.path) || 'a file' };
}


export interface TurnFileDiff {
  path: string;
  additions: number;
  deletions: number;
}


// Codex keeps one cumulative diff for the turn and resends it as it grows,
// so the latest copy lists every file the turn changed.
export function turnDiffFiles(diff: string): TurnFileDiff[] {
  return diff.split(/^(?=diff --git )/m).filter((section) => section.startsWith('diff --git ')).map((section) => {
    const target = section.match(/^\+\+\+ (?:b\/)?(.+)$/m)?.[1];
    const source = section.match(/^--- (?:a\/)?(.+)$/m)?.[1];
    const header = section.match(/^diff --git a\/(.+?) b\/(.+)$/m)?.[2];
    const path = (target && target !== '/dev/null' ? target : source && source !== '/dev/null' ? source : header) || '';
    return { path, ...lineCounts(section) };
  });
}


export interface PlanStep {
  step: string;
  status: 'completed' | 'in_progress' | 'pending';
}


// Codex keeps a checklist for the turn and resends all of it whenever a step
// moves. A proposed plan from plan mode streams as text instead.
export function isPlanUpdate(event: CodingEvent): boolean {
  return event.type === 'plan' && Array.isArray(event.data.plan);
}


export function planSteps(event: CodingEvent): PlanStep[] {
  const raw = Array.isArray(event.data.plan) ? event.data.plan : [];
  return raw.map((item) => {
    const step = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const status = text(step.status);
    return {
      step: text(step.step) || 'Plan step',
      status: status === 'completed'
        ? 'completed'
        : status === 'inProgress' || status === 'in_progress' || status === 'running' ? 'in_progress' : 'pending',
    };
  });
}


// "Step 2 of 4" for the step being worked on, or the next one to start.
export function planPosition(event: CodingEvent | undefined): string {
  const steps = event ? planSteps(event) : [];
  const current = steps.findIndex((step) => step.status === 'in_progress');
  const index = current >= 0 ? current : steps.findIndex((step) => step.status === 'pending');
  return index >= 0 ? `Step ${index + 1} of ${steps.length}` : '';
}
