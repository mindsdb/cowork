/**
 * Picked or dropped files as message attachments, uploaded when the message
 * is sent. The composer and the next-step buttons both build them here, so a
 * file sent either way reaches the server the same way.
 */
export function localFileAttachments(files) {
  return Array.from(files || []).map((file) => ({
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    source: 'file',
    pendingFile: file,
    name: file.name,
    mime: file.type || undefined,
    size: file.size,
  }));
}
