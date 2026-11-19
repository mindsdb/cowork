// A per-render token is a trust boundary: the parent accepts a frame's
// postMessage only when it matches, so the artifact's own scripts must not be
// able to guess it. Same ladder as `allocateConversationId` in api.js —
// randomUUID is gated to secure contexts, getRandomValues is not, and
// Math.random is the last resort for an environment with no crypto at all
// (not a real Electron/browser case).
export function createFrameToken() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
  if (bytes) return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
