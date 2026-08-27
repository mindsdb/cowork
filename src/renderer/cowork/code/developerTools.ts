import type { ConnectorConnection } from '../api';
import type { ProjectConnection, SourceContext } from './api';

export type DeveloperProvider = 'github' | 'linear';

export interface DeveloperSourceTarget {
  provider: DeveloperProvider;
  kind: 'issue' | 'pull_request';
  url: string;
}

const PROVIDER_LABELS: Record<DeveloperProvider, string> = {
  github: 'GitHub',
  linear: 'Linear',
};

export function developerProviderLabel(provider: DeveloperProvider): string {
  return PROVIDER_LABELS[provider];
}

export function sourceProviderLabel(provider: SourceContext['provider']): string {
  return provider === 'github' ? 'GitHub' : provider === 'linear' ? 'Linear' : 'Slack';
}

export function developerConnections(connections: ProjectConnection[]): ProjectConnection[] {
  return connections.filter((connection) => connection.provider === 'github' || connection.provider === 'linear');
}

export function availableDeveloperConnections(connections: ConnectorConnection[]): ProjectConnection[] {
  const seen = new Set<string>();
  return connections.flatMap((connection) => {
    if ((connection.engine !== 'github' && connection.engine !== 'linear') || connection.status === 'needs_reconnect') {
      return [];
    }
    const key = `${connection.engine}:${connection.name}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      provider: connection.engine,
      name: connection.name,
      label: connection.display_name || connection.user_label || connection.label || connection.name,
    }];
  });
}

export function parseDeveloperSourceUrl(value: string): DeveloperSourceTarget | null {
  const candidate = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'linear.app' && !host.endsWith('.linear.app')) {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 4 && ['issues', 'pull'].includes(parts[2]) && /^\d+$/.test(parts[3])) {
      return { provider: 'github', kind: parts[2] === 'pull' ? 'pull_request' : 'issue', url: parsed.href };
    }
    return null;
  }
  if (host === 'linear.app' || host.endsWith('.linear.app')) {
    // Linear's API returns canonical browser links with a human-readable slug
    // after the issue identifier (for example, /issue/ENG-289/fix-scheduler).
    // Pasted links without the slug remain valid too, so identify the issue by
    // shape rather than assuming it is the final path segment.
    const identifier = parsed.pathname
      .split('/')
      .filter(Boolean)
      .find((part) => /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(part)) || '';
    if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(identifier)) {
      return { provider: 'linear', kind: 'issue', url: parsed.href };
    }
  }
  return null;
}

export function sourceContextLabel(context: SourceContext): string {
  return context.external_id || context.title || sourceProviderLabel(context.provider);
}

export function sourceContextMeta(context: SourceContext): string {
  return [
    context.state,
    context.comments?.length ? `${context.comments.length} ${context.comments.length === 1 ? 'comment' : 'comments'}` : '',
    context.attachments?.length ? `${context.attachments.length} ${context.attachments.length === 1 ? 'attachment' : 'attachments'}` : '',
  ].filter(Boolean).join(' · ');
}

export function connectionForSource(
  connections: ProjectConnection[],
  target: DeveloperSourceTarget,
  requestedName = '',
): ProjectConnection | null {
  const matching = developerConnections(connections).filter((connection) => connection.provider === target.provider);
  if (requestedName) return matching.find((connection) => connection.name === requestedName) || null;
  return matching.length === 1 ? matching[0] : null;
}
