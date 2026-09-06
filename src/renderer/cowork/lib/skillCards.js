// Show only the latest turn's card per skill slug; refinements re-emit the same skill across turns.

/**
 * Scan messages in chronological order (append the live streaming message last)
 * and return, per skill key, the index of the last message containing it. The
 * renderer shows a Skill step only when its message index matches.
 *
 * Keyed by `_skillKey` (the slug), NOT `step.id`: each turn starts from a fresh
 * stream state so every turn's step shares the id `skill-<slug>` — ids are not
 * unique across messages, slugs are.
 *
 * @param {Array<{steps?: Array}>} messages
 * @returns {Map<string, number>} skill key → latest message index
 */
export function latestSkillCardIndexByKey(messages) {
  const latest = new Map();
  (messages || []).forEach((m, i) => {
    (m?.steps || []).forEach((s) => {
      if (s?.badge !== 'Skill') return;
      const key = s._skillKey || s.data?.slug || s.id;
      if (key) latest.set(key, i);
    });
  });
  return latest;
}
