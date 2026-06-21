import { createElement } from 'react';
import { ArtifactWorkspace as LegacyArtifactWorkspace } from './ArtifactWorkspace';
import {
  ArtifactWorkspaceRedesign,
  shouldUseRedesign,
} from './redesign/ArtifactWorkspaceRedesign.jsx';

export { ArtifactViewer } from './ArtifactViewer';

// Flag-gated switch. The exported `ArtifactWorkspace` keeps the legacy component
// as the default; it renders the redesigned workspace only when the per-machine
// localStorage flag (`anton:artifact-workspace-direction-2`) is on. Default OFF
// → existing behavior is unchanged. This is the ONLY change to the switch point;
// the large ArtifactWorkspace.jsx is untouched. (createElement keeps this barrel
// JSX-free, matching the rest of the .js modules in this tree.)
export function ArtifactWorkspace(props) {
  const Component = shouldUseRedesign(props)
    ? ArtifactWorkspaceRedesign
    : LegacyArtifactWorkspace;
  return createElement(Component, props);
}
