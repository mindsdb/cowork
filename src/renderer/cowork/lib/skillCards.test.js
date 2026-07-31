import { describe, it, expect } from 'vitest';
import { latestSkillCardIndexByKey } from './skillCards';

const skillStep = (slug) => ({ badge: 'Skill', _skillKey: slug, id: `skill-${slug}`, data: { slug } });
const msg = (...slugs) => ({ steps: slugs.map(skillStep) });

describe('latestSkillCardIndexByKey', () => {
  it('maps each skill to the LATEST message that emitted it', () => {
    const messages = [
      msg('a'),       // 0
      { steps: [] },  // 1 — plain turn, no skill
      msg('a'),       // 2 — refined
    ];
    // Earlier copy at index 0 is superseded by index 2.
    expect(latestSkillCardIndexByKey(messages).get('a')).toBe(2);
  });

  it('keeps separate entries for different slugs', () => {
    const latest = latestSkillCardIndexByKey([msg('a'), msg('b'), msg('a')]);
    expect(latest.get('a')).toBe(2);
    expect(latest.get('b')).toBe(1);
  });

  it('ignores non-skill steps and empty/absent input', () => {
    expect(latestSkillCardIndexByKey([]).size).toBe(0);
    expect(latestSkillCardIndexByKey(undefined).size).toBe(0);
    expect(latestSkillCardIndexByKey([{ steps: [{ badge: 'Artifact' }] }]).size).toBe(0);
  });
});
