import type { ConnectorConnection } from '../api';
import type { CodeProject, ProjectConnection } from './api';


/**
 * The project's connection list with `connection` added, or null when the
 * project already lists that account (so callers can skip the save).
 */
export function withProjectConnection(
  project: Pick<CodeProject, 'connections'>,
  provider: ProjectConnection['provider'],
  connection: ConnectorConnection,
): ProjectConnection[] | null {
  const present = project.connections.some((item) => item.provider === provider && item.name === connection.name);
  if (present) return null;
  return [...project.connections, {
    provider,
    name: connection.name,
    label: connection.display_name || connection.user_label || connection.label || connection.name,
  }];
}


/** Where the Connectors view sends the user back to, and what to call it. */
export type ConnectorReturn = { projectId: string; destination: 'task' | 'settings' };

export function connectorReturnLabel(destination: ConnectorReturn['destination']): string {
  return destination === 'settings' ? 'Back to project settings' : 'Back to task';
}
