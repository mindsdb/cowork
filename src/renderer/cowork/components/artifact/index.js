import { createElement } from 'react';
import { ArtifactViewer } from './ArtifactViewer';

export { ArtifactViewer } from './ArtifactViewer';

// Temporary stack bridge for the list/publish slice. The real redesigned
// workspace replaces this export later in the stack, after its dependencies land.
export function ArtifactWorkspace({ open, artifact, onClose, onChange, onPublish, onUnpublish }) {
  if (!open || !artifact) return null;
  return createElement(ArtifactViewer, {
    open,
    artifact,
    onClose,
    onChange,
    onPublish,
    onUnpublish,
  });
}
