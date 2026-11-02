import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { STEP_ICONS, StepGlyph } from './stepIcons';
import Ico from '../Icons';

// An icon an adapter emits but this map lacks falls back to the sparkle,
// which looks like a chosen glyph and hides the gap.
// Every `icon:` value lib/responseStreamAdapter.js emits. Code Mode's names
// are checked by the compiler: StepLabel.icon is typed as StepIconName.
const COWORK_EMITTED = ['code', 'compact', 'cube', 'doc', 'memory', 'question'];

const html = (node: ReactElement) => render(node).container.innerHTML;

describe('step icons', () => {
  it.each(COWORK_EMITTED)('maps Cowork\'s %s', (name) => {
    expect(STEP_ICONS).toHaveProperty(name);
  });

  it.each(['question', 'doc', 'compact', 'memory', 'web'])('draws %s with its own glyph, not the sparkle', (name) => {
    expect(html(<StepGlyph name={name} size={12} />)).not.toBe(html(<>{Ico.sparkle(12)}</>));
  });

  it('draws the same glyph for a Cowork alias and its Code Mode name', () => {
    expect(html(<StepGlyph name="code" size={14} />)).toBe(html(<StepGlyph name="command" size={14} />));
    expect(html(<StepGlyph name="cube" size={14} />)).toBe(html(<StepGlyph name="tool" size={14} />));
    expect(html(<StepGlyph name="doc" size={14} />)).toBe(html(<StepGlyph name="read" size={14} />));
  });

  it('falls back to the sparkle for an unknown name', () => {
    expect(html(<StepGlyph name="nope" size={12} />)).toBe(html(<>{Ico.sparkle(12)}</>));
  });
});
