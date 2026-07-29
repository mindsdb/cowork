export interface UpdateCheckSummary {
  ok: boolean;
  offline: boolean;
  updateAvailable: boolean;
  uiUpdateAvailable: boolean;
  serverUpdateAvailable: boolean;
  shellUpdateAvailable: boolean;
  uiVersion?: string;
  serverVersion?: string;
  shellVersion?: string;
  shellDownloadUrl?: string;
}
