import type { CodingEvent } from './api';


// Codex runs every command through a login shell. The wrapper is the same on
// every row, so showing it only pushes the part that differs off-screen.
const SHELL_WRAPPER = /^\/bin\/(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/;

// Items Codex reports that are not work the user asked about: its echo of the
// user's own message, and housekeeping such as context compaction.
const IGNORED_ITEM_TYPES = new Set(['userMessage', 'contextCompaction']);

type ActionKind = 'edit' | 'command' | 'read' | 'search' | 'list' | 'tool';

const ACTION_ORDER: ActionKind[] = ['edit', 'command', 'read', 'search', 'list', 'tool'];

const ACTION_PHRASE: Record<ActionKind, (count: number) => string> = {
  edit: (count) => `edited ${count} ${count === 1 ? 'file' : 'files'}`,
  command: (count) => `ran ${count} ${count === 1 ? 'command' : 'commands'}`,
  read: (count) => `read ${count} ${count === 1 ? 'file' : 'files'}`,
  search: (count) => `searched ${count} ${count === 1 ? 'time' : 'times'}`,
  list: (count) => `listed ${count} ${count === 1 ? 'folder' : 'folders'}`,
  tool: (count) => `used ${count} ${count === 1 ? 'tool' : 'tools'}`,
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
  if (event.type === 'tool') return ['tool'];
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
  for (const event of latestPerItem(events)) {
    if (isLive(event)) continue;
    for (const kind of actionKinds(event)) counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  const phrases = ACTION_ORDER.filter((kind) => counts.get(kind)).map((kind) => ACTION_PHRASE[kind](counts.get(kind) || 0));
  if (phrases.length) return sentence(phrases);
  if (events.some((event) => event.type === 'approval' && event.phase === 'pending')) return 'Asked for approval';
  return events.some((event) => event.type === 'reasoning') ? 'Thought it through' : 'Agent activity';
}


function isLive(event: CodingEvent): boolean {
  return event.phase === 'started' || event.phase === 'progress';
}


// Reasoning summaries open with a bold heading such as "**Checking the docs**".
// Codex uses that heading as its status line; it is the model's own plain
// description of what it is doing.
function reasoningHeading(event: CodingEvent): string {
  const match = event.text.match(/\*\*([^*\n]+)\*\*/);
  return match ? match[1].trim() : '';
}


function presentTense(event: CodingEvent): string {
  if (event.type === 'file_change') {
    const path = text(event.data.path) || event.title;
    return path ? `Editing ${path.split(/[\\/]/).at(-1)}` : 'Editing files';
  }
  if (event.type === 'tool') return event.title ? `Using ${event.title}` : 'Using a tool';
  const actions = commandActions(event);
  const [first] = actions;
  if (actions.length === 1 && first.type === 'read') return `Reading ${first.name || first.path.split(/[\\/]/).at(-1) || 'a file'}`;
  if (actions.length === 1 && first.type === 'search') return first.query ? `Searching for ${first.query}` : 'Searching';
  if (actions.length === 1 && first.type === 'listFiles') return 'Listing files';
  return `Running ${displayCommand(event)}`;
}


export function liveStatusLabel(events: CodingEvent[]): string {
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


export function approvalOutcome(event: CodingEvent): string {
  const decision = text(event.data.decision);
  if (decision === 'approve_session') return 'Approved for this task';
  if (decision === 'deny') return 'Denied';
  return event.text || 'Approved';
}
