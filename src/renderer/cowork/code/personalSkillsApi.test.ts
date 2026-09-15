import { beforeEach, expect, it, vi } from 'vitest';
import { requestJson } from './api';
import { personalSkillsApi } from './personalSkillsApi';

vi.mock('./api', () => ({ requestJson: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const body = { name: 'Review', description: 'Review changes', instructions: 'Read the diff', enabled: true };

it('uses the Code-specific endpoint for creation and text import', async () => {
  await personalSkillsApi.create(body);
  expect(requestJson).toHaveBeenLastCalledWith('/skills/personal', { method: 'POST', body: JSON.stringify(body) });
  await personalSkillsApi.import('---\nname: review\n---\nInstructions');
  expect(requestJson).toHaveBeenLastCalledWith('/skills/personal/import', { method: 'POST', body: JSON.stringify({ content: '---\nname: review\n---\nInstructions' }) });
});

it('encodes the stable id and uses the canonical request boundary for every operation', async () => {
  await personalSkillsApi.get('review test');
  expect(requestJson).toHaveBeenLastCalledWith('/skills/personal/review%20test');
  await personalSkillsApi.update('review test', body);
  expect(requestJson).toHaveBeenLastCalledWith('/skills/personal/review%20test', { method: 'PUT', body: JSON.stringify(body) });
  await personalSkillsApi.remove('review test');
  expect(requestJson).toHaveBeenLastCalledWith('/skills/personal/review%20test', { method: 'DELETE' });
});
