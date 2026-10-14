import { requestJson } from './api';

export interface PersonalSkillWrite {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}

export interface PersonalSkill extends PersonalSkillWrite {
  id: string;
  projects: string[];
}

const path = (id: string) => `/skills/personal/${encodeURIComponent(id)}`;

export const personalSkillsApi = {
  get: (id: string) => requestJson<PersonalSkill>(path(id)),
  create: (body: PersonalSkillWrite) => requestJson<PersonalSkill>('/skills/personal', {
    method: 'POST', body: JSON.stringify(body),
  }),
  import: (content: string) => requestJson<PersonalSkill>('/skills/personal/import', {
    method: 'POST', body: JSON.stringify({ content }),
  }),
  update: (id: string, body: PersonalSkillWrite) => requestJson<PersonalSkill>(path(id), {
    method: 'PUT', body: JSON.stringify(body),
  }),
  remove: (id: string) => requestJson<void>(path(id), { method: 'DELETE' }),
};
