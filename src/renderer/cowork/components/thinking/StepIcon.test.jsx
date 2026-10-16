import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ICON_MAP, StepIcon } from './StepIcon';
import Ico from '../Icons';

// An icon the adapter emits but this map lacks falls back to the sparkle,
// which looks like a chosen glyph and hides the gap. The AskUser step's
// 'question' had no entry.
// Every `icon:` value lib/responseStreamAdapter.js emits.
const EMITTED = ['code', 'compact', 'cube', 'doc', 'memory', 'question'];

describe('StepIcon', () => {
  it.each(EMITTED)('maps %s', (type) => {
    expect(ICON_MAP).toHaveProperty(type);
  });

  it.each(['question', 'doc', 'compact', 'memory'])('draws %s with its own glyph, not the sparkle', (type) => {
    const html = (node) => render(node).container.innerHTML;
    expect(html(<StepIcon type={type} />)).not.toBe(html(Ico.sparkle(12)));
  });
});
