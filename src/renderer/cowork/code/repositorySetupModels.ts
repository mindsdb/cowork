export interface TaskRepositorySetup {
  branch: string | null;
  base_branches: Record<string, string>;
  include_local_changes: boolean;
}

export interface RepositoryStatus {
  resource_id: string;
  available: boolean;
  local: boolean;
  branch: string | null;
  branches: string[];
  changes: string[];
  change_count: number;
  detail: string;
}

export const emptyRepositorySetup = (): TaskRepositorySetup => ({
  branch: null,
  base_branches: {},
  include_local_changes: false,
});

// Git remains authoritative; this catches common mistakes before submitting.
export function branchNameIssue(value: string): string {
  if (!value) return '';
  return value.length > 255 ||
    value === 'HEAD' ||
    value === '@' ||
    value.startsWith('-') ||
    /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(value) ||
    value.includes('..') ||
    value.includes('@{') ||
    value.endsWith('.') ||
    value.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))
    ? 'Use a Git branch name such as feat/repo-status.'
    : '';
}
