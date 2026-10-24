// Hand-written declarations for update-metadata.mjs so its tests typecheck
// under `npm run typecheck:test`.
export declare const MAC_MINIMUM_DARWIN_VERSION: string;
export declare function updateMetadataYaml(input: {
  platform: 'mac' | 'windows';
  name: string;
  sha512: string;
  size: number;
  version: string;
  releaseDate: string;
}): string;
