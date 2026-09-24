// The "not yours" tag on artifact cards, list rows and the preview header
// (ENG-2979). Takes the result of artifactAuthorship(); renders nothing for
// the viewer's own artifacts. The icon goes through Badge's own `icon` slot,
// as the access badges in ArtifactStatus do.

import Ico from '../Icons';
import { Badge, Tooltip } from '../ui';

export function ArtifactAuthorshipBadge({ authorship }) {
  if (!authorship) return null;
  return (
    <Tooltip content={authorship.description}>
      <Badge variant="muted" size="sm" icon={Ico.user(11)}>
        {authorship.label}
      </Badge>
    </Tooltip>
  );
}

export default ArtifactAuthorshipBadge;
