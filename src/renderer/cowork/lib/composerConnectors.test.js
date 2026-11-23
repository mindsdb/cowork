import { describe, expect, it } from 'vitest';

import { composerConnectorList } from './composerConnectors';
import { toggleConnectionMute } from './connectionMutes';
import { toCustomConnectionRows } from './customConnect';

const OAUTH = { engine: 'gmail', name: 'Work mail' };
const DATABASE = { engine: 'postgres', name: 'Sales', status: 'connected' };

describe('the composer connection toggles', () => {
  it('offer a verified custom connection beside OAuth and databases', () => {
    const customs = toCustomConnectionRows([
      { id: 7, connector_id: 'acme_quotes', name: 'Acme Quotes', status: 'verified' },
    ]);

    const list = composerConnectorList([OAUTH], [DATABASE], customs);

    expect(list.map((c) => [c.engine, c.name])).toEqual([
      ['gmail', 'Work mail'], ['postgres', 'Sales'], ['acme_quotes', 'Acme Quotes'],
    ]);
  });

  it('leave out a custom connection or database that is not verified', () => {
    const customs = toCustomConnectionRows([
      { id: 7, connector_id: 'acme_rates', name: 'Rates', status: 'pending' },
      { id: 8, connector_id: 'acme_rates', name: 'Rates old', status: 'failed' },
    ]);

    const list = composerConnectorList([], [{ ...DATABASE, status: 'pending' }], customs);

    expect(list).toEqual([]);
  });

  it('mute a custom connection by the connector id and name the server filters on', () => {
    const [quotes] = toCustomConnectionRows([
      { id: 7, connector_id: 'acme_quotes', name: 'Acme Quotes', status: 'verified' },
    ]);

    expect(toggleConnectionMute([], quotes, false)).toEqual([{ engine: 'acme_quotes', name: 'Acme Quotes' }]);
  });

  it('take missing lists as empty', () => {
    expect(composerConnectorList(undefined, null, 'nope')).toEqual([]);
  });
});
