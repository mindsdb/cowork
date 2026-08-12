export interface UpdateCheckSummary {
  ok: boolean;
  offline: boolean;
  updateAvailable: boolean;
  uiUpdateAvailable: boolean;
  serverUpdateAvailable: boolean;
  shellUpdateAvailable: boolean;
  uiVersion?: string;
  serverVersion?: string;
  // Which backend component `serverVersion` describes when a server update is
  // available. On the PyPI channel a server update can be an anton-only release
  // (ENG-1094), so the UI labels it "Agent" instead of "Server". Absent (⇒
  // treat as cowork-server) on the git channel and older main-process replies.
  serverComponent?: 'cowork-server' | 'anton-agent';
  shellVersion?: string;
  shellDownloadUrl?: string;
}
