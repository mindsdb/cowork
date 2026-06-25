import { createElement } from 'react';
import { ArtifactWorkspaceRedesign } from './redesign/ArtifactWorkspaceRedesign.jsx';
import { RedesignErrorBoundary } from './redesign/RedesignErrorBoundary.jsx';

export { ArtifactViewer } from './ArtifactViewer';

// Redesign-only workspace export for the staging stack. The old fallback
// workspace is intentionally kept out of this branch series.
export function ArtifactWorkspace(props) {
  return createElement(
    RedesignErrorBoundary,
    null,
    createElement(ArtifactWorkspaceRedesign, props),
  );
}
