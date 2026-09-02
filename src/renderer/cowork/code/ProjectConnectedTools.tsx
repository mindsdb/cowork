import type { ConnectorConnection } from '../api';
import Button from '../components/ui/Button';

function accountLabel(connection: ConnectorConnection): string {
  return connection.display_name || connection.user_label || connection.label || connection.name;
}

export function ProjectConnectedTools({
  connections,
  selected,
  onChange,
  onOpenConnectors,
  canManage,
}: {
  connections: ConnectorConnection[];
  selected: string[];
  onChange: (keys: string[]) => void;
  onOpenConnectors: () => void;
  canManage: boolean;
}) {
  const developerAccounts = connections.filter((connection) => connection.engine === 'github' || connection.engine === 'linear');
  const toggle = (key: string) => onChange(
    selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key],
  );

  return (
    <section className="code-project-section code-project-tools">
      <div className="code-project-section__heading">
        <div><strong>Connectors</strong><span>Connected accounts available to every task in this project</span></div>
        {canManage && <Button size="sm" variant="subtle" onClick={onOpenConnectors}>Manage</Button>}
      </div>
      {developerAccounts.length ? (
        <div className="code-project-connection-list">
          {developerAccounts.map((connection) => {
            const key = `${connection.engine}:${connection.name}`;
            const unavailable = connection.status === 'needs_reconnect' || connection.status === 'missing';
            return (
              <div key={key} className={`code-project-connection${unavailable ? ' is-unavailable' : ''}`}>
                <label>
                  <input type="checkbox" checked={selected.includes(key)} disabled={unavailable} onChange={() => toggle(key)} />
                  <span><strong>{accountLabel(connection)}</strong><small>{connection.engine === 'github' ? 'GitHub' : 'Linear'}</small></span>
                </label>
                {unavailable && <Button size="sm" variant="subtle" onClick={onOpenConnectors}>Reconnect</Button>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="code-project-connected-empty">
          <span>{canManage
            ? 'Connect GitHub or Linear to start tasks from issues and deliver pull requests.'
            : 'Save this project, then add GitHub or Linear.'}</span>
          {canManage && <Button size="sm" variant="subtle" onClick={onOpenConnectors}>Open Connectors</Button>}
        </div>
      )}
    </section>
  );
}
