// Normalise cowork-server canonical memory list items into the { sections }
// shape the UI expects. Display uses category + project name only.

export function labelCategory(category) {
  const raw = String(category || '').trim();
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function scopeToApi(scope) {
  if (scope === 'Global' || scope === 'global') return 'global';
  if (scope === 'Project' || scope === 'project') return 'project';
  if (scope === 'Deployment' || scope === 'managed') return 'managed';
  return String(scope || 'global').toLowerCase();
}

/* `managed` is the operator's rules for every person on the deployment, which
   nobody changes from Cowork. Any scope the page doesn't know reads as Global. */
const SCOPE_LABELS = { project: 'Project', managed: 'Deployment' };

export function scopeToLabel(scope) {
  return SCOPE_LABELS[scopeToApi(scope)] || 'Global';
}

const SECTION_ORDER = { Global: 0, Deployment: 1, Project: 2 };

export function groupMemoryItems(items, projects) {
  const projectNameById = new Map(
    (projects || []).map((p) => [String(p.id), p.name]),
  );
  const sectionMap = new Map();

  for (const item of items || []) {
    const scopeLabel = scopeToLabel(item.scope);
    const projectId = item.project_id ?? item.projectId ?? null;
    const category = item.category;
    const key = `${scopeToApi(item.scope)}:${projectId || 'global'}`;

    if (!sectionMap.has(key)) {
      sectionMap.set(key, {
        scope: scopeLabel,
        projectName: projectId ? (projectNameById.get(String(projectId)) || null) : null,
        projectId: projectId || null,
        files: [],
      });
    }

    const content = item.content || '';
    const projectName = projectId ? (projectNameById.get(String(projectId)) || null) : null;
    /* Pick server-owned attribution and capability metadata explicitly rather
       than spreading the raw item. Dropping them would make the Memory
       page appear editable even when the API correctly returned
       `canEdit: false`, while spreading everything would carry the raw `scope`
       and `project_id` alongside the normalised ones and let a future server
       field named `path`, `content` or `preview` be masked by the keys below. */
    sectionMap.get(key).files.push({
      attribution: item.attribution ?? null,
      capabilities: item.capabilities ?? null,
      category,
      projectId: projectId || null,
      content,
      preview: content.slice(0, 200),
      scope: scopeLabel,
      projectName,
      path: `${scopeLabel}:${projectId || 'global'}:${category}`,
    });
  }

  const sections = Array.from(sectionMap.values());
  sections.sort((a, b) => (
    (SECTION_ORDER[a.scope] - SECTION_ORDER[b.scope])
    || String(a.projectName || '').localeCompare(String(b.projectName || ''))
  ));

  for (const section of sections) {
    section.files.sort((a, b) => String(a.category).localeCompare(String(b.category)));
  }

  return { sections };
}

/** How many slots hold something learned; the deployment's rules are not. */
export function countNonEmptyMemory(data) {
  return (data?.sections || [])
    .filter((s) => s.scope !== 'Deployment')
    .flatMap((s) => s.files || [])
    .filter((f) => String(f.content || '').trim())
    .length;
}

/** Look up a normalised memory entry by its stable `path` key. */
export function findMemoryEntry(sections, path) {
  if (!path) return null;
  for (const section of sections || []) {
    const match = (section.files || []).find((f) => f.path === path);
    if (match) return match;
  }
  return null;
}

export async function resolveProjectId(projectRef, fetchProjectsFn) {
  if (!projectRef) return null;
  if (typeof projectRef === 'object' && projectRef.id) return projectRef.id;
  const str = String(projectRef);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return str;
  }
  const projects = await fetchProjectsFn();
  const match = projects.find((p) => p.path === str || p.name === str);
  return match?.id || null;
}

export function buildMemoryWritePayload(payload) {
  const scope = scopeToApi(payload.scope);
  const category = payload.category;
  if (!category) throw new Error('Memory category is required.');
  const body = {
    scope,
    category,
    content: payload.content ?? '',
  };
  const projectId = payload.projectId ?? payload.project_id;
  if (scope === 'project') {
    if (!projectId) throw new Error('project_id is required for project-scoped memory.');
    body.project_id = projectId;
  }
  return body;
}

export function buildMemoryDeletePayload(payload) {
  const scope = scopeToApi(payload.scope);
  const category = payload.category;
  if (!category) throw new Error('Memory category is required.');
  const body = { scope, category };
  const projectId = payload.projectId ?? payload.project_id;
  if (scope === 'project') {
    if (!projectId) throw new Error('project_id is required for project-scoped memory.');
    body.project_id = projectId;
  }
  return body;
}
