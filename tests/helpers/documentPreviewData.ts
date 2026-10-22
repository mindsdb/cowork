/* The document preview tests' data, from
   src/renderer/cowork/preview/documentPreview.test.yaml. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import type { DocumentPreviewType, PreviewErrorCode } from '../../src/renderer/cowork/preview/contract';
import type { ZipEntryInput } from './zipBytes';

export interface DocumentArtifactData {
  type: DocumentPreviewType;
  id: string;
  title: string;
  path: string;
  draftUrl: string;
}

export interface ForbiddenScriptText {
  label: string;
  text: string;
}

/* A zipBytes entry as the data states it: `size` zero bytes in place of its
   data. */
export type ArchiveEntryData = Omit<ZipEntryInput, 'data'> & { size: number };

/* zipBytes archive options as the data states them, with `lead` as text. */
export interface ArchiveOptionsData {
  lead?: string;
  endRecordCopy?: number;
}

export interface ArchiveCaseData {
  case: string;
  entries: ArchiveEntryData[];
  archive?: ArchiveOptionsData;
}

export interface AcceptedArchiveData extends ArchiveCaseData {
  names: string[];
}

export interface DocumentPreviewData {
  documentArtifacts: DocumentArtifactData[];
  forbiddenSandboxKeywords: string[];
  forbiddenScriptText: ForbiddenScriptText[];
  allowedScriptText: string[];
  reasonCodes: PreviewErrorCode[];
  windowSizeReads: string[];
  archiveGuard: { accepted: AcceptedArchiveData[]; refused: ArchiveCaseData[] };
}

const DATA_FILE = path.resolve(__dirname, '../../src/renderer/cowork/preview/documentPreview.test.yaml');

export function documentPreviewData(): DocumentPreviewData {
  return yaml.load(readFileSync(DATA_FILE, 'utf8')) as DocumentPreviewData;
}
