export interface UpdateCheckSummary {
  ok: boolean;
  offline: boolean;
  updateAvailable: boolean;
  uiUpdateAvailable: boolean;
  serverUpdateAvailable: boolean;
  shellUpdateAvailable: boolean;
  uiVersion?: string;
  serverVersion?: string;
  // Which component serverVersion describes: PyPI updates may be Anton-only. Absent on git and
  // older main-process replies; callers default to cowork-server.
  serverComponent?: 'cowork-server' | 'anton-agent';
  shellVersion?: string;
  shellDownloadUrl?: string;
}
