// Which artifact cards are docs, and what a doc is outside the app. A doc is
// stored as JSON (`*.cdoc.json`), but to the person it is a document: the
// chat, the library and the rail open it in the doc editor, not as a file.
export function isDocArtifact(artifact) {
  if (!artifact) return false;
  if (artifact.format === 'doc') return true;
  const primary = String(artifact.primary || artifact.path || artifact.file_path || '').toLowerCase();
  return primary.endsWith('.cdoc.json');
}

/**
 * A doc as its rendered page (doc.html), the thing to open outside the app or
 * to publish; null for anything else, or a doc whose page is not known. Handed
 * over as is, its JSON opened in whatever edits .json (Xcode, on the QA Mac,
 * which crashed), and published, it would share the storage, not the page.
 */
export function docPageTarget(artifact) {
  if (!isDocArtifact(artifact) || !artifact.htmlPath) return null;
  const page = artifact.htmlPath;
  // The serve URL (the web build's address for a file) names the doc's own
  // file last; its page sits beside it in the same folder.
  const name = page.split(/[\\/]/).pop();
  const serveUrl = artifact.serveUrl ? artifact.serveUrl.replace(/[^/]+$/, encodeURIComponent(name)) : artifact.serveUrl;
  return { ...artifact, folder: undefined, canonicalPath: undefined, path: page, file_path: page, serveUrl };
}
