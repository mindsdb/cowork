// Model entitlement — which models a subscription tier may select.
//
// The authoritative source is a per-model `locked` flag on the model list
// served by cowork-server (`/settings/recommended-models`), populated by the
// StatSig tier gate (ENG-531; backend change owned by Lucas). Until that flag
// lands, `isFrontierModel` is an interim client heuristic so the free-tier
// treatment can be built and reviewed. When the server flag ships it always
// wins; the heuristic is only consulted when no flag is present.
//
// Tier model access (per the M1/M2 billing scope):
//   Free (Starter): Minds Air (Kimi K2) only.
//   Pro Hub:        frontier models (Opus, Gemini, OpenAI) unlocked.

// Minds Air is the single model a free user may run; everything else in the
// picker (Claude, GPT/OpenAI, Gemini) is a frontier model behind Pro Hub.
const FREE_TIER_MODEL_RE = /kimi|minds[-_ ]?air/i;

// Heuristic frontier check, used only as a fallback before the server flag.
export function isFrontierModel(id) {
  if (!id) return false;
  return !FREE_TIER_MODEL_RE.test(String(id));
}

// Whether `model` is locked for `tier`. A boolean `model.locked` from the
// server always wins; otherwise only the free tier locks frontier models.
// tier: 'free' | 'pro' | null/undefined (unknown tier locks nothing).
export function isModelLocked(model, tier) {
  if (model && typeof model.locked === 'boolean') return model.locked;
  if (tier !== 'free') return false;
  return isFrontierModel(model && model.id);
}

// Order models so selectable (unlocked) ones come first, preserving relative
// order within each group (stable). A no-op when nothing is locked, so it only
// reorders the free-tier list — a free user reaches their model without
// scrolling past locked frontier ones. Returns a new array; input untouched.
export function orderUnlockedFirst(models) {
  return [...models].sort((a, b) => (a.locked === b.locked ? 0 : a.locked ? 1 : -1));
}
