/*
 * The checks both sides of the frame protocol run on every message. Each
 * reader returns the typed message only when its shape is right and it carries
 * this frame's token, and null otherwise, so a caller drops anything else
 * without looking at it further. The parent checks the token, never
 * event.source.
 */
import type {
  DocumentPreviewType,
  FrameReady,
  FrameToParent,
  ParentPort,
  ParentToFrame,
  RenderSummary,
} from '../contract';
import { isFrameErrorCode } from './errors';

/* The meta buildPreviewSrcdoc writes the token into, and the frame removes. */
export const PREVIEW_TOKEN_META_NAME = 'cowork-preview-token';

/* 128 bits, as 32 lowercase hex characters. */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/* Every DocumentPreviewType. A Record rather than a list, so tsc fails here when
   the union gains or loses a type. */
const DOCUMENT_PREVIEW_TYPES: Readonly<Record<DocumentPreviewType, true>> = { xlsx: true, docx: true, pptx: true, pdf: true };

/* Longer asset names are refused unread; real names are short file names. */
export const MAX_ASSET_NAME_LENGTH = 256;

/* An error's detail is a debugging aid, so it is capped and never shown. */
export const MAX_ERROR_DETAIL_LENGTH = 200;

export function newPreviewToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isPreviewToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export function isDocumentPreviewType(value: unknown): value is DocumentPreviewType {
  return typeof value === 'string' && Object.hasOwn(DOCUMENT_PREVIEW_TYPES, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRequestId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isAssetName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ASSET_NAME_LENGTH;
}

export function readRenderSummary(value: unknown): RenderSummary | null {
  if (!isRecord(value)) return null;
  const { type, units, truncated } = value;
  if (!isDocumentPreviewType(type) || !isCount(units) || !Number.isInteger(units) || typeof truncated !== 'boolean') {
    return null;
  }
  return { type, units, truncated };
}

export function readFrameReady(data: unknown, token: string): FrameReady | null {
  if (!isRecord(data) || data.source !== 'cowork-document-preview' || data.type !== 'ready' || data.token !== token) {
    return null;
  }
  return { source: 'cowork-document-preview', type: 'ready', token };
}

export function readParentPort(data: unknown, token: string): ParentPort | null {
  if (!isRecord(data) || data.type !== 'port' || data.token !== token) return null;
  return { type: 'port', token };
}

export function readParentToFrame(data: unknown, token: string): ParentToFrame | null {
  if (!isRecord(data) || data.token !== token) return null;
  if (data.type === 'document' && isDocumentPreviewType(data.previewType) && data.bytes instanceof ArrayBuffer) {
    return { token, type: 'document', previewType: data.previewType, bytes: data.bytes };
  }
  if (data.type === 'asset' && isRequestId(data.requestId) && isAssetName(data.name)
    && (data.bytes === null || data.bytes instanceof ArrayBuffer)) {
    return { token, type: 'asset', requestId: data.requestId, name: data.name, bytes: data.bytes };
  }
  return null;
}

export function readFrameToParent(data: unknown, token: string): FrameToParent | null {
  if (!isRecord(data) || data.token !== token) return null;
  switch (data.type) {
    case 'progress':
      return isCount(data.done) && (data.total === null || isCount(data.total))
        ? { token, type: 'progress', done: data.done, total: data.total }
        : null;
    case 'rendered': {
      const summary = readRenderSummary(data.summary);
      return summary ? { token, type: 'rendered', summary } : null;
    }
    case 'asset-request':
      return isRequestId(data.requestId) && isAssetName(data.name)
        ? { token, type: 'asset-request', requestId: data.requestId, name: data.name }
        : null;
    case 'error': {
      if (!isFrameErrorCode(data.code)) return null;
      const detail = typeof data.detail === 'string' ? data.detail.slice(0, MAX_ERROR_DETAIL_LENGTH) : undefined;
      return { token, type: 'error', code: data.code, ...(detail === undefined ? {} : { detail }) };
    }
    default:
      return null;
  }
}
