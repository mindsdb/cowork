import { useState } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import { BrowserFrame } from './BrowserFrame';

/* The browser pane before the agent has opened a page in the task: the same
   frame, a blank page with a line asking where to go, and a box that sends it
   to the agent, who opens the browser and does it. The real pane takes over as
   soon as the turn's Browser step arrives (ChatView). */

export const BLANK_LINES = [
  { title: 'Blank page. Big plans?', subtitle: 'Tell me what to look up and I’ll take it from here.' },
  { title: 'The whole internet, and nowhere to be.', subtitle: 'Point me somewhere worth the trip.' },
  { title: 'Fresh tab energy.', subtitle: 'What are we searching for today?' },
  { title: 'Quiet in here. Suspiciously quiet.', subtitle: 'Give me a site or a search and I’ll get going.' },
];

// One line per task, so it doesn't change every time the pane opens.
export function blankLineFor(key = '') {
  let hash = 0;
  for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return BLANK_LINES[hash % BLANK_LINES.length];
}

const LOOKS_LIKE_LINK = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

/** What the agent is asked for what the person typed: open a link, or search. */
export function browserRequestFor(text) {
  const wanted = text.trim();
  return LOOKS_LIKE_LINK.test(wanted)
    ? `Open ${wanted} in the browser.`
    : `Search the web in the browser for: ${wanted}`;
}

/**
 * @param {{ taskKey?: string, agentLabel?: string, browserOn?: boolean,
 *   onSend?: (text: string) => void, onClose: () => void }} props
 */
export default function BlankBrowserPanel({ taskKey = '', agentLabel = 'Anton', browserOn = true, onSend, onClose }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const line = blankLineFor(taskKey);
  const canSend = browserOn && !!onSend;

  const submit = (event) => {
    event.preventDefault();
    if (!canSend || !text.trim()) return;
    onSend(browserRequestFor(text));
    setSent(true);
  };

  return (
    <BrowserFrame hint={sent ? `${agentLabel} is opening the browser…` : 'Nothing open yet'} onClose={onClose}>
      <div className="browser-panel__blank">
        <span className="browser-panel__blank-mark" aria-hidden="true">{Ico.globe(20)}</span>
        <h2 className="browser-panel__blank-title">{line.title}</h2>
        <p className="browser-panel__blank-subtitle">
          {browserOn ? line.subtitle : `The browser is off for this task. Turn it on from the + menu and ${agentLabel} can browse.`}
        </p>
        <form className="browser-panel__blank-form" onSubmit={submit}>
          <input
            type="text"
            className="browser-panel__blank-input"
            placeholder="Search, or paste a link"
            aria-label="What to look up"
            value={text}
            disabled={!canSend || sent}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <Button type="submit" size="sm" variant="primary" disabled={!canSend || sent || !text.trim()}>
            {sent ? 'On it…' : 'Go'}
          </Button>
        </form>
      </div>
    </BrowserFrame>
  );
}
