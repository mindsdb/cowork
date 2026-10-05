// Test-only entry: real collection rows, so Playwright can hit-test their layered controls.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HoverActions, ListGroup, ListItem } from '../../src/renderer/cowork/components/collection';
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
        meta={<HoverActions reveal><button type="button" onClick={record('Gmail disconnect')}>Disconnect</button></HoverActions>} />
      <ListItem title="Slack" onActivate={record('Slack open')} actions={menu('Slack')} revealActions meta="Updated 2h ago" />
      <ListItem title="Notion" onActivate={record('Notion open')} actions={menu('Notion')} meta="Updated 3h ago" />
    </ListGroup>
    {/* Pages stack groups in a grid, whose auto column grows to fit unwrapped text. */}
    <div className="mx-8 grid gap-6">
      <ListGroup aria-label="Long">
        <ListItem title="Review" onActivate={record('Review open')} meta="Skill" description={'Run an extremely strict review. '.repeat(20)} />
      </ListGroup>
    </div>
    <output aria-label="Events">{log.join('|')}</output>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
