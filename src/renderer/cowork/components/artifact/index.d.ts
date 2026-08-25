import type { ComponentType } from 'react';

export interface ArtifactCapabilities {
  role?: 'owner' | 'editor' | 'reviewer' | 'viewer';
  canPreview?: boolean;
  canComment?: boolean;
  canEdit?: boolean;
  canAddressWithAgent?: boolean;
  canResolveComments?: boolean;
}

export interface ArtifactViewerArtifact {
  id?: string;
  stableId?: string;
  artifactKey?: string;
  slug?: string;
  projectId?: string;
  projectName?: string;
  title?: string;
  name?: string;
  description?: string;
  type?: string;
  kind?: string;
  ext?: string;
  primary?: string;
  path?: string;
  file_path?: string;
  canonicalPath?: string;
  displayPath?: string;
  folder?: string;
  draftUrl?: string;
  serveUrl?: string;
  actionDisabledReason?: string;
  mtime?: number;
  modified?: boolean;
  publishedUrl?: string;
  accessMode?: string;
  accessEmails?: string[];
  updated?: string;
  live?: boolean;
  fileCount?: number;
  capabilities?: ArtifactCapabilities;
}

export interface ArtifactRepairThreadEntry {
  author?: {
    user_id?: string | null;
    email?: string | null;
  } | null;
  text: string;
  createdAt?: string | null;
}

export interface ArtifactAgentRepair {
  id: string;
  artifactId: string;
  path: string;
  baseRevisionId: string;
  baseContentHash: string;
  commentThreadId: string;
  selector?: string | null;
  thread: ArtifactRepairThreadEntry[];
  conversationId: string;
  status: 'queued' | 'ready' | 'accepted' | 'rejected' | 'cancelled';
  revisionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactAgentRepairRequest {
  artifact: ArtifactViewerArtifact;
  prompt: string;
  repair: ArtifactAgentRepair;
  conversationId: string;
}

export interface ArtifactViewerProps {
  open: boolean;
  artifact: ArtifactViewerArtifact | null;
  onClose: () => void;
  onChange?: (artifact: ArtifactViewerArtifact) => void;
  onDelete?: (path: string) => void;
  onAddressWithAgent?: (request: ArtifactAgentRepairRequest) => Promise<boolean | void>;
  conversationId?: string | null;
}

export const ArtifactViewer: ComponentType<ArtifactViewerProps>;
