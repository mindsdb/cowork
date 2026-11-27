/** Whether the signed-in person may share an artifact with everyone in their
    active organization, as Desktop main reads it from auth for the Share panel. */
export interface ArtifactSharePermission {
  /** The sidecar publishes with the session token, not a key the person pasted. */
  sessionCredential: boolean;
  /** auth answered with the caller's standing in the organization. */
  known: boolean;
  canShareArtifactsOrg: boolean;
}
