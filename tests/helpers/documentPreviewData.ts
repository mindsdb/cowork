/* The document preview tests' data, from
   src/renderer/cowork/preview/documentPreview.test.yaml. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import type { DocumentPreviewType, PreviewErrorCode } from '../../src/renderer/cowork/preview/contract';
import type { ZipEntryInput, ZipOptions, ZipSizes } from './zipBytes';

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

export interface MalformedToken {
  label: string;
  token: string;
}

/* A zipBytes entry as the data states it: `size` zero bytes in place of its
   data. A directory comment holds bytes a test builds, so the data has none. */
export type ArchiveEntryData = Omit<ZipEntryInput, 'data' | 'centralComment'> & { size: number };

/* zipBytes archive options as the data states them, with `lead` and `prefix`
   as text. */
export type ArchiveOptionsData = Omit<ZipOptions, 'lead' | 'prefix'> & { lead?: string; prefix?: string };

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
  malformedTokens: MalformedToken[];
  unsafeSrcdocScriptText: ForbiddenScriptText[];
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

export const DATA_FILE = path.resolve(__dirname, '../../src/renderer/cowork/preview/documentPreview.test.yaml');

/* The keys each row's model lists. Each is a Record over the model's keys, so
   tsc fails when the model gains a key its list lacks. */
const ACCEPTED_ARCHIVE_KEYS = new Set(Object.keys({
  case: true, entries: true, archive: true, names: true,
} satisfies Record<keyof AcceptedArchiveData, true>));
const ARCHIVE_CASE_KEYS = new Set(Object.keys({
  case: true, entries: true, archive: true,
} satisfies Record<keyof ArchiveCaseData, true>));
const ARCHIVE_OPTIONS_CASE_KEYS = new Set(Object.keys({
  case: true, archive: true,
} satisfies Record<keyof ArchiveOptionsCaseData, true>));
const ARCHIVE_ENTRY_KEYS = new Set(Object.keys({
  name: true, size: true, store: true, externalAttributes: true, centralSizes: true, localName: true,
  localMethod: true, localSizes: true, dataDescriptor: true, zip64Extra: true, unicodePath: true,
  localUnicodePath: true,
} satisfies Record<keyof ArchiveEntryData, true>));
const ZIP_SIZES_KEYS = new Set(Object.keys({
  compressed: true, uncompressed: true,
} satisfies Record<keyof ZipSizes, true>));
const ARCHIVE_OPTION_KEYS = new Set(Object.keys({
  lead: true, prefix: true, statedEntries: true, statedDirectorySize: true, statedDiskNumber: true,
  statedDirectoryDisk: true, endRecordCopy: true,
} satisfies Record<keyof ArchiveOptionsData, true>));
const WRITTEN_FILE_KEYS = new Set(Object.keys({
  name: true, text: true,
} satisfies Record<keyof WrittenFileData, true>));
const JSZIP_OPTION_KEYS = new Set(Object.keys({
  compression: true, streamFiles: true,
} satisfies Record<keyof JSZipWriteOptions, true>));
const DIRECTIVE_KEYS = new Set(Object.keys({
  case: true, head: true, body: true, bodyFile: true, stray: true,
} satisfies Record<keyof HarnessDirectiveData, true>));

function checkKeys(value: object, allowed: ReadonlySet<string>, where: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${where}: unknown keys ${unknown.join(', ')}`);
}

function checkArchiveCases(
  list: string,
  cases: readonly (ArchiveCaseData | ArchiveOptionsCaseData)[],
  allowed: ReadonlySet<string>,
): void {
  for (const row of cases) {
    const where = `archiveGuard.${list} '${row.case}'`;
    checkKeys(row, allowed, where);
    if (row.archive) checkKeys(row.archive, ARCHIVE_OPTION_KEYS, `${where} archive`);
    if (!('entries' in row)) continue;
    row.entries.forEach((entry, index) => {
      const at = `${where} entry ${index + 1}`;
      checkKeys(entry, ARCHIVE_ENTRY_KEYS, at);
      if (entry.centralSizes) checkKeys(entry.centralSizes, ZIP_SIZES_KEYS, `${at} centralSizes`);
      if (entry.localSizes) checkKeys(entry.localSizes, ZIP_SIZES_KEYS, `${at} localSizes`);
    });
  }
}

/*
 * Throws when an archive case, entry, entry's sizes or options, a written
 * archive's file or JSZip options, or a harness directive row holds a key its model doesn't
 * list, the way loadFixtures checks the e2e fixture lists. Each of those keys
 * is optional input, so a misspelt one would drop out quietly and its row
 * would pass while checking nothing.
 */
function checkDocumentPreviewKeys(data: DocumentPreviewData): void {
  checkArchiveCases('accepted', data.archiveGuard.accepted, ACCEPTED_ARCHIVE_KEYS);
  checkArchiveCases('refused', data.archiveGuard.refused, ARCHIVE_CASE_KEYS);
  checkArchiveCases('pastEntryCap', data.archiveGuard.pastEntryCap, ARCHIVE_OPTIONS_CASE_KEYS);
  for (const file of data.archiveGuard.written.files) {
    checkKeys(file, WRITTEN_FILE_KEYS, `archiveGuard.written.files '${file.name}'`);
  }
  data.archiveGuard.written.jszipOptions.forEach((options, index) => {
    checkKeys(options, JSZIP_OPTION_KEYS, `archiveGuard.written.jszipOptions ${index + 1}`);
  });
  for (const row of data.harness.directives) checkKeys(row, DIRECTIVE_KEYS, `harness.directives '${row.case}'`);
}

export function parseDocumentPreviewData(text: string): DocumentPreviewData {
  const data = yaml.load(text) as DocumentPreviewData;
  checkDocumentPreviewKeys(data);
  return data;
}

export function documentPreviewData(): DocumentPreviewData {
  return parseDocumentPreviewData(readFileSync(DATA_FILE, 'utf8'));
}
