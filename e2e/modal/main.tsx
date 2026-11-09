// Test-only entry: the real Modal, closed by an effect of the commit that opened it.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal } from '../../src/renderer/cowork/components/ui/Modal';
import '../../src/renderer/cowork/styles/tailwind.css';
import '../../src/renderer/cowork/styles/globals.css';

document.body.setAttribute('data-theme', 'light');

function Fixture() {
  const [open, setOpen] = useState(false);
  const [opens, setOpens] = useState(0);
  const [clicks, setClicks] = useState(0);
  useEffect(() => { if (opens) setOpen(false); }, [opens]);
  return <>
    <button type="button" onClick={() => { setOpen(true); setOpens((n) => n + 1); }}>Open</button>
    <button type="button" onClick={() => setClicks((n) => n + 1)}>Clicked {clicks}</button>
    <Modal open={open} onClose={() => setOpen(false)} ariaLabel="Probe"><p>Body</p></Modal>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
