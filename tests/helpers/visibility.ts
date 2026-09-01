// Drives document.visibilityState for the polling hooks that pause while the
// window is hidden. happy-dom always reports "visible" and never changes it.
export function setDocumentVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

export function resetDocumentVisibility(): void {
  Reflect.deleteProperty(document, 'visibilityState');
}
