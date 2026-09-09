import { describe, expect, it } from 'vitest';

import type { ConnectorConnection } from '../api';
import { connectorReturnLabel, withProjectConnection } from './projectConnections';


const account = { engine: 'github', name: 'octo', display_name: 'Octo Cat', status: 'ready' } as unknown as ConnectorConnection;

describe('withProjectConnection', () => {
  it('adds a newly connected account with its display name as the label', () => {
    expect(withProjectConnection({ connections: [] }, 'github', account)).toEqual([
      { provider: 'github', name: 'octo', label: 'Octo Cat' },
    ]);
  });

  it('returns null when the project already lists that account, so nothing is saved twice', () => {
    const project = { connections: [{ provider: 'github' as const, name: 'octo', label: 'Octo Cat' }] };
    expect(withProjectConnection(project, 'github', account)).toBeNull();
    expect(withProjectConnection(project, 'linear', { ...account, engine: 'linear' })).toHaveLength(2);
  });
});

describe('connectorReturnLabel', () => {
  it('names the place the user came from', () => {
    expect(connectorReturnLabel('task')).toBe('Back to task');
    expect(connectorReturnLabel('settings')).toBe('Back to project settings');
  });
});
