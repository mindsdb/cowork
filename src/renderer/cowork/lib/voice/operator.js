// The voice call's operator (ENG-4138, prototype). GPT-Live hands each request
// back with no tool calls of its own, so a request goes to the server's
// operator model (POST /voice/operate) with what is on screen; the model picks
// the app's actions, this runs them as the person (`actions`, from App.jsx),
// sends their results back, and repeats until the model answers in words.
//
// `history` is the call's own: it lives for one call, so "move it to Sales"
// after "start a task about Q3" knows what "it" is. Requests overlap (a "stop
// it" comes while Anton is still on the last one), so each runs on its own
// copy and adds its whole exchange to the history when it is done: the model
// never sees a request land between a tool call and its result.

import { voiceOperate } from '../../api';
import { describeArtifacts } from './screenArtifacts';
import { describeWaiting } from './callNeeds';

export const MAX_ROUNDS = 6;
const MAX_HISTORY = 40;
const MAX_RESULT_CHARS = 4000;
// The server refuses a message longer than this (MAX_MESSAGE_CHARS in
// cowork-server's voice operator). A request is everything heard since the
// last one, so a long one keeps its end: what the person said last.
export const MAX_REQUEST_CHARS = 8000;

function fitRequest(request) {
  const text = String(request ?? '');
  return text.length > MAX_REQUEST_CHARS ? `…${text.slice(-(MAX_REQUEST_CHARS - 1))}` : text;
}

function asCall(call) {
  return { id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) } };
}

/**
 * Resolves with what to say. `snapshot()` describes the screen now; it is read
 * every round, so it sees what the previous round's actions changed.
 */
export async function runOperator({ request, history, snapshot, actions, operate = voiceOperate, maxRounds = MAX_ROUNDS }) {
  const exchange = [{ role: 'user', content: fitRequest(request) }];
  const settle = (said) => {
    history.push(...exchange, { role: 'assistant', content: said });
    return said;
  };
  for (let round = 0; round < maxRounds; round += 1) {
    const turn = await operate([...history, ...exchange].slice(-MAX_HISTORY), snapshot());
    const calls = turn?.tool_calls || [];
    if (!calls.length) return settle(String(turn?.content || '').trim() || 'Done.');
    exchange.push({ role: 'assistant', content: turn.content || '', tool_calls: calls.map(asCall) });
    // One at a time: an action can depend on the one before (create, then move).
    for (const call of calls) {
      let result;
      try {
        const run = actions[call.name];
        result = run ? await run(call.arguments || {}) : `There is no action called ${call.name}.`;
      } catch (err) {
        result = `That failed: ${err?.message || err}`;
      }
      exchange.push({ role: 'tool', tool_call_id: call.id, content: String(result ?? 'Done.').slice(0, MAX_RESULT_CHARS) });
    }
  }
  return settle('That took more steps than I can take on a call. Have a look at the screen.');
}

export const isRunning = (task) => (task.messages || []).some((m) => m.role === '_streaming');

/**
 * What the operator is told about the screen: where the person is, an open
 * artifact (`artifacts`, from screenArtifacts.js: its title, type and the
 * start of its text), the call's work still running (`working`, a list),
 * projects, recent tasks and any older task still running.
 */
export function describeScreen({
  route, currentTask, selectedProject, projects, tasks, callTaskId = null, working = null, browserPage = '', artifacts = [], waiting = [], maxTasks = 30,
}) {
  const lines = [];
  if (route === 'task' && currentTask) {
    // Each id comes before the text around it: the server cuts every snapshot
    // line to a fixed length, and a long title must not cut off the id.
    lines.push(`On screen: the task (id ${currentTask.id}) "${currentTask.title || 'Untitled'}" in project "${currentTask.projectName || 'general'}".`);
  } else if (route === 'projects' && selectedProject) {
    lines.push(`On screen: the project "${selectedProject.name}".`);
  } else {
    lines.push('On screen: Home. A request for work starts a new task.');
  }
  // The browser beside Home or a project: a new task from here takes its page
  // along. Only the site's origin, never text the site chose.
  if (browserPage) lines.push(`The browser beside the page is open on a page from ${browserPage}; a new task from here opens it too.`);
  // Before the task list, so the server's cut of a long snapshot keeps it.
  lines.push(...describeArtifacts(artifacts));
  // What Anton waits on the person for, which they can answer on the call.
  lines.push(...describeWaiting(waiting));
  const callTask = callTaskId && (tasks || []).find((t) => t.id === callTaskId);
  if (callTask) lines.push(`The task this call last gave Anton work in (id ${callTask.id})${isRunning(callTask) ? ', running now' : ''}: "${callTask.title || 'Untitled'}".`);
  // The call's own work still running, each in its task (ENG-4631): more work
  // in one of those tasks queues behind it; work for a new task or another
  // task starts beside it.
  const works = (Array.isArray(working) ? working : [working]).filter(Boolean);
  if (works.length) {
    lines.push("Anton is working on the call's requests:");
    works.forEach((work) => {
      const where = (tasks || []).find((t) => t.id === work.taskId);
      lines.push(where ? `- in task ${where.id} ("${where.title || 'Untitled'}"): "${work.request}"` : `- "${work.request}" (starting)`);
    });
    lines.push('More work in one of those tasks queues behind it there. Work for a new task or another task starts at once, beside it.');
  }
  lines.push(`Projects: ${(projects || []).map((p) => `"${p.name}"`).join(', ') || 'none'}.`);
  const recent = (tasks || []).slice(0, maxTasks);
  if (recent.length) {
    lines.push('Recent tasks, newest first:');
    recent.forEach((t) => {
      lines.push(`- id ${t.id}: "${t.title || 'Untitled'}" in "${t.projectName || 'general'}"${isRunning(t) ? ', running now' : ''}`);
    });
  }
  // A running task past that list still counts: the person can ask for it.
  const older = (tasks || []).slice(maxTasks).filter(isRunning);
  if (older.length) {
    lines.push('Also running, older:');
    older.forEach((t) => lines.push(`- id ${t.id}: "${t.title || 'Untitled'}" in "${t.projectName || 'general'}", running now`));
  }
  return lines.join('\n');
}

function stepLine(step) {
  const status = step.status === 'in_progress' ? ' (running)' : step.status === 'failed' || step.status === 'error' ? ' (failed)' : '';
  return `- ${step.label || step.badge || 'Step'}${status}`;
}

/** A task's steps and latest answer, for the operator to talk about. */
export function describeSteps(task, { maxSteps = 25 } = {}) {
  const messages = task?.messages || [];
  const live = messages.find((m) => m.role === '_streaming');
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  const turn = live || last;
  if (!turn) return `"${task?.title || 'This task'}" has no steps yet.`;
  const steps = (turn.steps || []).filter((s) => s.label || s.badge);
  const lines = [live ? 'Running now. Its steps so far:' : 'Its last turn finished. Its steps:'];
  if (steps.length > maxSteps) lines.push(`(${steps.length - maxSteps} earlier steps left out)`);
  steps.slice(-maxSteps).forEach((s) => lines.push(stepLine(s)));
  if (!steps.length) lines.push('- no steps');
  if (live?.currentThought) lines.push(`Thinking: ${String(live.currentThought).slice(0, 300)}`);
  const answer = String(turn.content || '').trim();
  if (answer) lines.push(`${live ? 'Its answer so far' : 'Its answer'}: ${answer.slice(0, 1200)}`);
  return lines.join('\n');
}

// Words in how people name a task ("the one where we talked about pricing")
// that say nothing about which.
const NOT_A_NAME = new Set([
  'the', 'one', 'ones', 'an', 'task', 'tasks', 'chat', 'my', 'our', 'that', 'this', 'about', 'with', 'on', 'of',
  'for', 'in', 'where', 'we', 'talked', 'discussed', 'was', 'were', 'is', 'and', 'it', 'from', 'to', 'you',
]);
const searchTerms = (text) => String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)
  .filter((w) => w.length > 1 && !NOT_A_NAME.has(w));

/**
 * search_tasks (ENG-4631): the tasks that match `query`, best first, from the
 * app's search (`hits`, `/search` results: every task's title, beyond the
 * recent ones the snapshot lists) and the tasks loaded here (`tasks`), which
 * also know which are running. At most `max`, as `{id, title, project, running}`.
 */
export function findTasks({ query, tasks = [], hits = [], max = 8 }) {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const loaded = new Map((tasks || []).map((t) => [String(t.id), t]));
  const found = new Map();
  const add = (id, title, project, score) => {
    const key = String(id);
    const task = loaded.get(key);
    const prior = found.get(key);
    if (prior && prior.score >= score) return;
    found.set(key, {
      id: key,
      title: task?.title || title || 'Untitled',
      project: task?.projectName || project || 'general',
      running: task ? isRunning(task) : false,
      score,
    });
  };
  (hits || []).forEach((hit, i) => {
    if (hit?.type !== 'task' || !hit.id) return;
    // The server's order first: it scored every task's title. Loaded tasks it
    // didn't return come after.
    add(hit.id, hit.title, hit.subtitle && hit.subtitle !== 'Task' ? hit.subtitle : '', 10_000 - i);
  });
  (tasks || []).forEach((t, i) => {
    const words = new Set(searchTerms(`${t.title || ''} ${t.projectName || ''}`));
    const matched = terms.filter((term) => [...words].some((w) => w.startsWith(term))).length;
    // Every word, or most of a longer query; newest first among equals.
    if (!matched || matched < Math.ceil(terms.length / 2)) return;
    add(t.id, t.title, t.projectName, matched * 100 - i / 1000 + (matched === terms.length ? 2000 : 0));
  });
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, max).map(({ score, ...task }) => task);
}

/** What search_tasks tells the operator about what it found. */
export function describeFound(query, found) {
  if (!found.length) return `No task matches "${query}". Ask the user to say it another way, or which project it is in.`;
  return [
    `Tasks matching "${query}", best first:`,
    ...found.map((t) => `- id ${t.id}: "${t.title}" in "${t.project}"${t.running ? ', running now' : ''}`),
  ].join('\n');
}
