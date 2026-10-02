import type { ConnectorConnection } from '../api';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';

function accountLabel(connection: ConnectorConnection): string {
  return connection.display_name || connection.user_label || connection.label || connection.name;
}

export function ProjectConnectedTools({
  connections,
  selected,
  onChange,
  onOpenConnectors,
  required = [],
}: {
  connections: ConnectorConnection[];
  selected: string[];
  onChange: (keys: string[]) => void;
  onOpenConnectors: () => void;
  required?: string[];
}) {
  const developerAccounts = connections.filter((connection) => connection.engine === 'github' || connection.engine === 'linear');
  const toggle = (key: string) => onChange(
    selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key],
  );

  return (
    <section className="code-project-field code-project-tools" aria-labelledby="code-project-connectors-label">
      <span id="code-project-connectors-label" className="code-project-label">Connectors <span className="code-project-optional">(optional)</span></span>
      {developerAccounts.length ? (
        <div className="code-project-list">
          {developerAccounts.map((connection) => {
            const key = `${connection.engine}:${connection.name}`;
            const unavailable = connection.status === 'needs_reconnect' || connection.status === 'missing';
            const label = accountLabel(connection);
            return (
              <div key={key} className={`code-project-connection${unavailable ? ' is-unavailable' : ''}`}>
                <label>
                  <Checkbox size="sm" checked={selected.includes(key)} disabled={unavailable || (required.includes(key) && selected.includes(key))} onCheckedChange={() => toggle(key)} aria-label={label} />
                  <span className="code-project-connection__text"><strong>{label}</strong><small>{connection.engine === 'github' ? 'GitHub' : 'Linear'}{required.includes(key) ? ' · Used by a repository' : ''}</small></span>
                </label>
                {unavailable && <Button size="sm" variant="subtle" onClick={onOpenConnectors}>Reconnect</Button>}
              </div>
            );
          })}
          <div className="code-project-list__actions">
            <Button size="sm" variant="subtle" onClick={onOpenConnectors}>{Ico.link(13)} Manage connectors</Button>
          </div>
        </div>
      ) : (
        <div className="code-project-list code-project-connected-empty">
          <span>Connect GitHub or Linear to start tasks from issues and deliver pull requests.</span>
          <Button size="sm" variant="subtle" onClick={onOpenConnectors}>Open Connectors</Button>
        </div>
      )}
    </section>
  );
}
