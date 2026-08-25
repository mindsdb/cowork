import type { ComponentType } from 'react';

export type ArtifactViewerArtifact = Record<string, unknown>;

export interface ArtifactViewerProps {
  open: boolean;
  artifact: ArtifactViewerArtifact | null;
  onClose: () => void;
  onChange?: (artifact: ArtifactViewerArtifact) => void;
  onDelete?: (path: string) => void;
  onAddressWithAgent?: (prompt: string, conversationId: string) => Promise<unknown>;
  conversationId?: string | null;
}

export const ArtifactViewer: ComponentType<ArtifactViewerProps>;
