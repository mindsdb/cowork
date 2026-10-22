/* The document preview tests' data, from
   src/renderer/cowork/preview/documentPreview.test.yaml. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import type { DocumentPreviewType, PreviewErrorCode } from '../../src/renderer/cowork/preview/contract';

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

export interface DocumentPreviewData {
  documentArtifacts: DocumentArtifactData[];
  forbiddenSandboxKeywords: string[];
  forbiddenScriptText: ForbiddenScriptText[];
  allowedScriptText: string[];
  reasonCodes: PreviewErrorCode[];
  windowSizeReads: string[];
}

const DATA_FILE = path.resolve(__dirname, '../../src/renderer/cowork/preview/documentPreview.test.yaml');

export function documentPreviewData(): DocumentPreviewData {
  return yaml.load(readFileSync(DATA_FILE, 'utf8')) as DocumentPreviewData;
}
