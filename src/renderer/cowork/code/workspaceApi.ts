import { requestJson } from './api';


export interface WorkspaceResource {
  id: string;
  name: string;
  kind: 'repository' | 'folder';
}

export interface WorkspaceEntry {
  resource_id: string;
  resource_name: string;
  path: string;
  name: string;
  kind: 'file' | 'directory';
  size?: number | null;
}

export interface WorkspaceEntryPage {
  resource_id: string;
  path: string;
  items: WorkspaceEntry[];
  truncated: boolean;
}

export interface WorkspaceFileContent {
  resource_id: string;
  resource_name: string;
  path: string;
  name: string;
  content: string;
  content_hash: string;
  line_count: number;
  line_start: number;
  line_end: number;
  truncated: boolean;
}

export interface WorkspaceSearchMatch {
  resource_id: string;
  resource_name: string;
  path: string;
  name: string;
  line?: number | null;
  preview: string;
  match_kind: 'path' | 'content';
}

export interface WorkspaceSearchPage {
  items: WorkspaceSearchMatch[];
  truncated: boolean;
}

const sessionPath = (sessionId: string, suffix: string) => (
  `/sessions/${encodeURIComponent(sessionId)}/workspace/${suffix}`
);

export const workspaceApi = {
  resources: (sessionId: string) => requestJson<{ items: WorkspaceResource[] }>(
    sessionPath(sessionId, 'resources'),
  ),
  entries: (sessionId: string, resourceId: string, path = '') => requestJson<WorkspaceEntryPage>(
    `${sessionPath(sessionId, 'entries')}?resourceId=${encodeURIComponent(resourceId)}&path=${encodeURIComponent(path)}`,
  ),
  file: (
    sessionId: string,
    resourceId: string,
    path: string,
    lineStart?: number | null,
    lineEnd?: number | null,
  ) => {
    const params = new URLSearchParams({ resourceId, path });
    if (lineStart) params.set('lineStart', String(lineStart));
    if (lineEnd) params.set('lineEnd', String(lineEnd));
    return requestJson<WorkspaceFileContent>(`${sessionPath(sessionId, 'file')}?${params}`);
  },
  search: (sessionId: string, query: string, resourceId?: string | null) => {
    const params = new URLSearchParams({ query });
    if (resourceId) params.set('resourceId', resourceId);
    return requestJson<WorkspaceSearchPage>(`${sessionPath(sessionId, 'search')}?${params}`);
  },
};
