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

/* A build.config.mjs source the bundle generator refuses, and its error. */
export interface RefusedBuildConfig {
  label: string;
  source: string;
  error: string;
}

/* A zipBytes entry as the data states it: `size` zero bytes in place of its
   data. */
export type ArchiveEntryData = Omit<ZipEntryInput, 'data'> & { size: number };

/* zipBytes archive options as the data states them, with `lead` and `prefix`
   as text. */
export interface ArchiveOptionsData {
  lead?: string;
  prefix?: string;
  statedEntries?: number;
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

/* Archive options alone, for a case whose entries the test builds. */
export interface ArchiveOptionsCaseData {
  case: string;
  archive: ArchiveOptionsData;
}

/* One sheet for SheetJS's XLSX.write: its name and its rows of cells. */
export interface WrittenSheetData {
  sheet: string;
  rows: (string | number)[][];
}

/* One JSZip entry: a file with its text, or a folder when `text` is absent. */
export interface WrittenFileData {
  name: string;
  text?: string;
}

export interface JSZipWriteOptions {
  compression: 'STORE' | 'DEFLATE';
  streamFiles: boolean;
}

/* Archives real zip writers make at test time. */
export interface WrittenArchivesData {
  workbook: WrittenSheetData[];
  workbookCompression: boolean[];
  files: WrittenFileData[];
  jszipOptions: JSZipWriteOptions[];
}

/* What each strayRequests rule set says of a request: it breaks the rules,
   it passes them, or it is not an http(s) request and so never counts. */
export type RequestVerdict = 'stray' | 'allowed' | 'ignored';

export interface HarnessRequestData {
  url: string;
  hostile: RequestVerdict;
  clean: RequestVerdict;
}

/* Markup a renderer could leave in the preview frame's head or body, and the
   outer HTML strayFrameDirectives reports for it. `bodyFile` names a file in
   the navigation fixture set whose markup is the body. */
export interface HarnessDirectiveData {
  case: string;
  head?: string;
  body?: string;
  bodyFile?: string;
  stray: string[];
}

export interface HarnessData {
  origin: string;
  set: 'navigation';
  file: string;
  requests: HarnessRequestData[];
  directives: HarnessDirectiveData[];
}

export interface DocumentPreviewData {
  documentArtifacts: DocumentArtifactData[];
  forbiddenSandboxKeywords: string[];
  forbiddenScriptText: ForbiddenScriptText[];
  allowedScriptText: string[];
  bundleNodeEnvs: string[];
  refusedBuildConfigs: RefusedBuildConfig[];
  reasonCodes: PreviewErrorCode[];
  windowSizeReads: string[];
  archiveGuard: {
    accepted: AcceptedArchiveData[];
    refused: ArchiveCaseData[];
    pastEntryCap: ArchiveOptionsCaseData[];
    written: WrittenArchivesData;
  };
  harness: HarnessData;
}

const DATA_FILE = path.resolve(__dirname, '../../src/renderer/cowork/preview/documentPreview.test.yaml');

export function documentPreviewData(): DocumentPreviewData {
  return yaml.load(readFileSync(DATA_FILE, 'utf8')) as DocumentPreviewData;
}
