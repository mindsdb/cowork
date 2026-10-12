// Test-only entry: real collection rows, so Playwright can hit-test their layered controls.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ItemActions, ListGroup, ListItem } from '../../src/renderer/cowork/components/collection';
import '../../src/renderer/cowork/styles/tailwind.css';
import '../../src/renderer/cowork/styles/globals.css';

document.body.setAttribute('data-theme', 'light');

function Fixture() {
  const [log, setLog] = useState<string[]>([]);
  const record = (event: string) => () => setLog((prev) => [...prev, event]);
  const menu = (name: string) => <button type="button" aria-label={`${name} menu`} onClick={record(`${name} menu`)}>⋯</button>;
  return <>
    <ListGroup className="m-8">
      <ListItem title="Gmail" onActivate={record('Gmail open')} actions={menu('Gmail')}
        meta={<ItemActions><button type="button" onClick={record('Gmail disconnect')}>Disconnect</button></ItemActions>} />
      <ListItem title="Slack" onActivate={record('Slack open')} actions={menu('Slack')} meta="Updated 2h ago" />
      <ListItem title="Notion" onActivate={record('Notion open')} actions={menu('Notion')} meta="Updated 3h ago" />
    </ListGroup>
    {/* Pages stack groups in a grid, whose auto column grows to fit unwrapped text. */}
    <div className="mx-8 grid gap-6">
      <ListGroup aria-label="Long">
        <ListItem title="Review" onActivate={record('Review open')} meta="Skill" description={'Run an extremely strict review. '.repeat(20)} />
      </ListGroup>
    </div>
    {/* Phone-width rows: a meta control and a meta with an unbreakable word. */}
    <ListGroup aria-label="Phone" className="m-8">
      <ListItem data-testid="plain-row" title="Plain task" onActivate={record('Plain open')} actions={menu('Plain')}
        meta={<span><button type="button">Plain project</button></span>} />
      <ListItem data-testid="meta-control-row" title="Linked task" onActivate={record('Linked open')} actions={menu('Linked')}
        meta={<ItemActions><button type="button" onClick={record('Linked project')}>Linked project</button></ItemActions>} />
      <ListItem data-testid="long-meta-row" title="Long meta" onActivate={record('Long meta open')} actions={menu('Long meta')}
        meta={<span data-testid="long-meta">{'x'.repeat(120)}</span>} />
    </ListGroup>
    <output aria-label="Events">{log.join('|')}</output>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
