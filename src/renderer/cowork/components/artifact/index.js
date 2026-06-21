import { createElement } from 'react';
import { ArtifactWorkspace as LegacyArtifactWorkspace } from './ArtifactWorkspace';
import {
  ArtifactWorkspaceRedesign,
  shouldUseRedesign,
} from './redesign/ArtifactWorkspaceRedesign.jsx';
import { RedesignErrorBoundary } from './redesign/RedesignErrorBoundary.jsx';

export { ArtifactViewer } from './ArtifactViewer';

// Flag-gated switch. On the direction-2 branch the redesign is ON by default
// (opt OUT with localStorage `anton:artifact-workspace-direction-2` = 'false').
// The redesign is wrapped in an error boundary so a runtime error shows a
// readable panel instead of white-screening; the large ArtifactWorkspace.jsx is
// untouched. (createElement keeps this barrel JSX-free, matching the tree.)
export function ArtifactWorkspace(props) {
  if (shouldUseRedesign(props)) {
    return createElement(
      RedesignErrorBoundary,
      null,
      createElement(ArtifactWorkspaceRedesign, props),
    );
  }
  return createElement(LegacyArtifactWorkspace, props);
}
