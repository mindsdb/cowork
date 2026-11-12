/*
 * The browser contract's answer shapes, as strict checks for tests.
 *
 * anton reads each answer into a pydantic model (anton/core/browser/models.py).
 * These checks mirror those models, and refuse keys the model doesn't list, so
 * a renamed field fails here rather than reading as a default in anton. The
 * fixture test runs anton's own response examples through them, which proves
 * the checks match anton; the bridge test runs this host's answers through the
 * same checks, which proves the host matches anton.
 */

type Check = (value: unknown, path: string) => string[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str: Check = (v, p) => (typeof v === 'string' ? [] : [`${p} is not a string`]);
const int: Check = (v, p) => (typeof v === 'number' && Number.isInteger(v) ? [] : [`${p} is not an integer`]);
const bool: Check = (v, p) => (typeof v === 'boolean' ? [] : [`${p} is not a boolean`]);
const literal = (...allowed: unknown[]): Check => (v, p) => (allowed.includes(v) ? [] : [`${p} is not one of ${allowed.join(', ')}`]);
const nullable = (inner: Check): Check => (v, p) => (v === null ? [] : inner(v, p));
const list = (inner: Check): Check => (v, p) =>
  Array.isArray(v) ? v.flatMap((item, i) => inner(item, `${p}[${i}]`)) : [`${p} is not a list`];

function shape(required: Record<string, Check>, optional: Record<string, Check> = {}): Check {
  return (value, path) => {
    if (!isRecord(value)) return [`${path} is not an object`];
    const problems: string[] = [];
    for (const [key, check] of Object.entries(required)) {
      if (!(key in value)) problems.push(`${path}.${key} is missing`);
      else problems.push(...check(value[key], `${path}.${key}`));
    }
    for (const [key, item] of Object.entries(value)) {
      if (key in required) continue;
      const check = optional[key];
      if (!check) problems.push(`${path}.${key} is not in the contract`);
      else problems.push(...check(item, `${path}.${key}`));
    }
    return problems;
  };
}

export const controlShape = shape({
  holder: literal('agent', 'human'),
  reason: str,
  since: int,
  seq: int,
  by: literal('agent', 'person'),
});

export const sessionInfoShape = shape(
  { session_id: str, control: controlShape },
  {
    running: bool, url: nullable(str), title: str, viewers: int, created_at: str, last_active_at: str,
    // The router's: the task's tab budget, and the tabs a recycled session noted.
    max_tabs: nullable(int),
    parked_tabs: list(shape({ url: str }, { title: str })),
  },
);

export const openSessionShape = shape({ session_id: str, resumed: bool, url: nullable(str) });

const elementShape = shape(
  { id: int, role: str, name: str },
  {
    value: nullable(str),
    value_hidden: bool,
    type: str,
    checked: nullable(bool),
    disabled: bool,
    offscreen: bool,
    options: list(str),
  },
);

export const pageShape = shape(
  { url: str, title: str, elements: list(elementShape) },
  {
    text: str,
    truncated: bool,
    scroll: nullable(shape({ y: int, height: int, viewport: int })),
    challenges: list(shape({ host: str, kind: str })),
  },
);

export const actionAnswerShape = shape({ ok: bool, url: str }, { page: nullable(pageShape) });

const tabShape = shape({ id: str, url: str, title: str, active: bool });
export const tabsAnswerShape = shape({ tabs: list(tabShape) });
export const tabAnswerShape = shape({ tab: tabShape });

const siteShape = shape(
  { site: str },
  { account_hint: str, noted_at: str, cookies_present: bool, cookies_expire_at: nullable(str) },
);
export const sitesAnswerShape = shape({ sites: list(siteShape) });
export const siteAnswerShape = shape({ site: siteShape });

const savedTabShape = shape({ name: str, url: str }, { notes: str, saved_at: str });
export const savedTabsAnswerShape = shape({ tabs: list(savedTabShape) });
export const savedTabAnswerShape = shape({ tab: savedTabShape });

export const okAnswerShape = shape({ ok: literal(true) });
/* A refusal. Only the web pod's commit hold (`approval_required`) adds the
   pending step's id, when its approval lapses, and `held`, what the approval
   will run. */
const heldShape = shape({ kind: literal('commit', 'position'), action: str, names: list(str), url: str });
export const errorShape = shape({ error: str }, { message: str, pending_id: str, expires_at: int, held: heldShape });

/** Problems with `value` against `check`, or [] when it fits. */
export function problems(check: Check, value: unknown): string[] {
  return check(value, '$');
}

/** Which shape answers each route, keyed the way the fixtures write `where`. */
export const RESPONSE_SHAPES: Record<string, Check> = {
  'POST /sessions': openSessionShape,
  'GET /sessions/{id}': sessionInfoShape,
  'GET /sessions/{id}/page': pageShape,
  'POST /sessions/{id}/action': actionAnswerShape,
  'POST /sessions/{id}/control': controlShape,
  'GET /sessions/{id}/tabs': tabsAnswerShape,
  'POST /sessions/{id}/tabs': tabAnswerShape,
  'POST /sessions/{id}/tabs/{tab}/activate': tabAnswerShape,
  'DELETE /sessions/{id}/tabs/{tab}': okAnswerShape,
  'GET /sessions/{id}/sites': sitesAnswerShape,
  'POST /sessions/{id}/sites': siteAnswerShape,
  'GET /saved-tabs?project={project}': savedTabsAnswerShape,
  'POST /saved-tabs': savedTabAnswerShape,
  'DELETE /saved-tabs?project={project}&name={name}': okAnswerShape,
};

export interface FixtureExample {
  where: string;
  kind: 'request' | 'response' | 'event' | 'turn_block' | 'constructor' | 'classification';
  status?: number;
  refused?: boolean;
  body: unknown;
}

export interface FixtureFile {
  description: string;
  /** Numbers both hosts hold to, such as saved_tabs.json's per-project cap. */
  limits?: Record<string, number>;
  examples: Record<string, FixtureExample>;
}
