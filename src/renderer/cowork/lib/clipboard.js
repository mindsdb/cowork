// Copy-to-clipboard helper with a robust fallback chain.
//
// `navigator.clipboard.writeText()` is the modern API but requires a
// secure context AND user activation — both technically true in
// Electron, but in practice the renderer's effective origin (file://
// / app:// in some configs) makes it return "Document is not focused"
// or fail silently. The legacy `document.execCommand('copy')` always
// works inside Electron because it doesn't require any permissions
// gate. We try modern first, fall back on any failure.
//
// Returns true on success, false if both paths failed.

export async function copyText(value) {
  if (value == null) return false;
  const text = String(value);
  if (!text) return false;

  // Path 1 — modern Clipboard API.
  try {
    if (typeof navigator !== 'undefined'
        && navigator.clipboard
        && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }

  // Path 2 — execCommand via a hidden textarea. Has to be in the DOM
  // and focused for the browser to consider this a user-initiated copy.
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    // Off-screen but selectable; readonly avoids virtual keyboard pop.
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    const sel = document.getSelection();
    const prevRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    // Restore the user's prior selection so we don't disturb anything.
    if (prevRange && sel) {
      try { sel.removeAllRanges(); sel.addRange(prevRange); } catch {}
    }
    return ok;
  } catch {
    return false;
  }
}
