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
  return String(scope || 'global').toLowerCase();
}

export function scopeToLabel(scope) {
  return scopeToApi(scope) === 'project' ? 'Project' : 'Global';
}

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
    sectionMap.get(key).files.push({
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
  sections.sort((a, b) => {
    if (a.scope === 'Global' && b.scope !== 'Global') return -1;
    if (b.scope === 'Global' && a.scope !== 'Global') return 1;
    return String(a.projectName || '').localeCompare(String(b.projectName || ''));
  });

  for (const section of sections) {
    section.files.sort((a, b) => String(a.category).localeCompare(String(b.category)));
  }

  return { sections };
}

export function countNonEmptyMemory(data) {
  return (data?.sections || [])
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
