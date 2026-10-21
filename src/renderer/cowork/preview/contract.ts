export type DocumentPreviewType = 'xlsx' | 'docx' | 'pptx' | 'pdf';

export interface PreviewLimits {
  maxBytes: number;                 // 32 MiB, counted while streaming
  maxInflatedBytes: number;         // 256 MiB
  maxZipEntryInflatedBytes: number; // 64 MiB per entry
  maxZipEntries: number;            // 10,000
  maxSheetRows: number;             // 2,000
  maxSheetColumns: number;          // 200
  maxPdfPages: number;              // 500; past it the summary says truncated: true
  maxPdfCanvasPixels: number;       // 16,777,216 per page canvas; 4,194,304 on touch devices
  maxPdfCanvasesAlive: number;      // 6 page canvases drawn at once
  maxSlides: number;                // 300
  readyTimeoutMs: number;           // 10,000
  progressTimeoutMs: number;        // 20,000
}

/* What `units` counts for each type:
   - xlsx: the sheets shown as tabs.
   - pptx: the slides drawn, at most maxSlides. A larger deck draws the first
     maxSlides slides and reports truncated: true.
   - pdf: the pages laid out, min(numPages, maxPdfPages). Pages draw as they
     scroll into view, with at most maxPdfCanvasesAlive canvases alive, so
     units never counts pages drawn.
   - docx: always 1, the one rendered document. */
export interface RenderSummary { type: DocumentPreviewType; units: number; truncated: boolean }
export type PreviewErrorCode = 'too-large' | 'zip-limit' | 'parse-failed' | 'unsupported' | 'timeout' | 'internal';

export interface GuardedZip {
  names(): readonly string[];
  bytes(name: string): Promise<Uint8Array | null>;
  text(name: string): Promise<string | null>;
}

export interface RendererContext {
  root: HTMLElement;
  limits: PreviewLimits;
  signal: AbortSignal;
  progress(done: number, total: number | null): void;
  openZip(bytes: ArrayBuffer): Promise<GuardedZip>;
  requestAsset(name: string): Promise<Uint8Array | null>;
}

export interface DocumentRenderer {
  type: DocumentPreviewType;
  render(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderSummary>;
}

/* The parent calls load(name) only when names.includes(name) holds exactly.
   Any other name gets bytes: null, with no load and no fetch. */
export interface PreviewAssetProvider { names: readonly string[]; load(name: string): Promise<ArrayBuffer | null> }

/* Frame protocol. The token is 128 bits from crypto.getRandomValues, in
   <meta name="cowork-preview-token"> after the policy meta and before the hashed
   script. The parent accepts one FrameReady per mounted frame and sends one port. */
export interface FrameReady { source: 'cowork-document-preview'; type: 'ready'; token: string }
export interface ParentPort { type: 'port'; token: string }
export type ParentToFrame =
  | { token: string; type: 'document'; previewType: DocumentPreviewType; bytes: ArrayBuffer }
  | { token: string; type: 'asset'; requestId: number; name: string; bytes: ArrayBuffer | null };
export type FrameToParent =
  | { token: string; type: 'progress'; done: number; total: number | null }
  | { token: string; type: 'rendered'; summary: RenderSummary }
  | { token: string; type: 'asset-request'; requestId: number; name: string }
  | { token: string; type: 'error'; code: PreviewErrorCode; detail?: string };
