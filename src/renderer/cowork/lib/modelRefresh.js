/**
 * How long data from a model picker's on-open refresh counts as fresh.
 *
 * Re-opening inside this window skips the round trip and opens immediately; it only
 * has to be short next to the ~5-minute cache it stands in for on the server.
 *
 * Shared by both pickers — the Settings dropdown and the composer's model menu — so
 * they cannot disagree about how often opening a menu is allowed to cost a request.
 */
export const MODEL_REFRESH_TTL_MS = 5000;
