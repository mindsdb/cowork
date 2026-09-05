export type DownloadChannel = 'prod' | 'stable';

export interface DownloadManifest {
  readonly version: string;
  readonly key: string;
  readonly url: string;
  readonly size_bytes: number;
  readonly sha256: string;
  readonly published_at: string;
}

export interface DownloadManifestInput {
  readonly key: string;
  readonly fileName: string;
  readonly channel: string;
  readonly cdnBase: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly publishedAt: string;
}

export declare function installerVersionFromFileName(fileName: string, channel: string): string;

export declare function downloadManifest(input: DownloadManifestInput): DownloadManifest;
