export type CoworkSkill = {
  label: string;
  description?: string;
  enabled?: boolean;
  projects?: string[];
  project?: string;
  [key: string]: unknown;
};

export function reloadSkills(): Promise<void>;
export function useSkills(): {
  skills: CoworkSkill[] | null;
  reload: typeof reloadSkills;
};
export function useSkillNames(): Set<string>;
export function saveSkillAndSync(payload: unknown, isEdit?: boolean): Promise<unknown>;
export function deleteSkillAndSync(label: string): Promise<unknown>;
