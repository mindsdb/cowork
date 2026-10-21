import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../lib/skillsStore', () => ({ useSkillNames: () => new Set() }));

import { MarkdownContent } from './MarkdownContent';

// ```chartjs and ```chart used to have their own renderers. Both are gone:
// old assistant messages that still carry these fences must render as
// ordinary code blocks, with the config text readable and copyable.
describe('MarkdownCode retired chart fences', () => {
  const CASES = [
    ['chartjs', "{ type: 'bar', data: { labels: ['a'], datasets: [{ data: [1] }] } }"],
    ['chart', '{"type":"bar","x":"month","y":"revenue"}'],
  ];

  it.each(CASES)('renders an assistant ```%s fence as a plain code block', (lang, body) => {
    const { container } = render(
      <MarkdownContent text={`Here it is:\n\n\`\`\`${lang}\n${body}\n\`\`\``} complete isAssistant />,
    );
    const block = container.querySelector('.anton-code-block');
    expect(block).not.toBeNull();
    const code = block.querySelector('code');
    expect(code.textContent).toBe(body);
    expect(code.getAttribute('data-source')).toBe(body);
    expect(block.querySelector('[data-copy-code]')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.textContent).not.toMatch(/ERROR:/);
  });

  it('renders a still-streaming ```chartjs fence as a code block, not a spinner', () => {
    const body = "{ type: 'line' }";
    const { container } = render(
      <MarkdownContent text={`\`\`\`chartjs\n${body}\n\`\`\``} complete={false} isAssistant />,
    );
    expect(container.querySelector('.anton-code-block code').textContent).toBe(body);
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
