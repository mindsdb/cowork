import { PREVIEW_FRAME_NAME } from '../shared/document-preview';

/*
 * The main process's half of the document preview frame's isolation.
 *
 * The preview frame is an in-page srcdoc frame, and every guard it carries
 * runs inside the frame's own process. On desktop the main process backs
 * those up in two ways:
 *
 * - It marks the preview frame when Electron creates it. At `frame-created`
 *   the frame already has the name attribute the renderer gives it
 *   (PREVIEW_FRAME_NAME) and has run no script. The mark is the frame's
 *   frameTreeNodeId, which Electron fixes when it creates the frame and keeps
 *   when the frame renames itself, changes process or navigates.
 *   mayCarryServerToken answers false for a marked frame, for any frame inside
 *   it, and for a request with no frame, and the server-token listener
 *   (server-token-listener.ts, which app.ts registers) then adds no token to
 *   those requests.
 * - It cancels every navigation that a marked frame, or a frame inside one,
 *   starts, whichever frame it targets, the main frame included. It also
 *   cancels a subframe's navigation when the frame is missing, sits at
 *   about:srcdoc directly under the main frame, or sits inside a marked frame.
 *   None of these decisions reads a frame's name, so a frame that renames
 *   itself is still held. A cancelled navigation opens nothing anywhere else
 *   either.
 *
 * The about:srcdoc rule holds the srcdoc frames the Cowork page itself mounts:
 * the preview frame, the HTML comparison panes and the visual editor. It
 * leaves alone a srcdoc frame further down, such as one inside a page loaded
 * by URL (an HTML artifact, or the task's own app in Code mode's preview),
 * which navigates as it did before this guard. A frame inside the preview
 * frame is still held, by the mark.
 *
 * Electron reports a navigation here only when it loads a URL. about: URLs
 * (about:blank, and the parent replacing a frame's srcdoc), javascript: URLs
 * and same-document navigations never reach the guard, so the about:srcdoc
 * early return matters only if a later Electron reports them. A frame that
 * goes to about:blank keeps its mark and gets no token. The initiator rule
 * trusts the initiator the renderer reports, so a renderer that leaves it out
 * isn't caught here.
 *
 * Electron throws when a property of a frame whose render frame is gone is
 * read. Each such read here fails closed: an unreadable frame is marked, gets
 * no token, and may not navigate to a URL that loads.
 */

/* The parts of Electron's WebFrameMain the guard reads. */
export interface GuardedFrame {
  readonly frameTreeNodeId: number;
  readonly name: string;
  readonly url: string;
  readonly parent: GuardedFrame | null;
}

/* The parts of Electron's will-frame-navigate event the guard reads. */
export interface FrameNavigation {
  readonly url: string;
  readonly isMainFrame: boolean;
  readonly frame: GuardedFrame | null;
  readonly initiator?: GuardedFrame | null;
  preventDefault(): void;
}

/* The part of Electron's frame-created details the guard reads. */
export interface FrameCreatedDetails {
  readonly frame: GuardedFrame | null;
}

/* The two WebContents events the guard listens to. Electron's WebContents fits it. */
export interface GuardedContents {
  on(event: 'frame-created', listener: (event: unknown, details: FrameCreatedDetails) => void): unknown;
  on(event: 'will-frame-navigate', listener: (event: FrameNavigation) => void): unknown;
}

export interface DocumentPreviewGuard {
  /* Whether a loopback request from this frame may carry the server's token. */
  mayCarryServerToken(frame: GuardedFrame | null | undefined): boolean;
}

/* about:srcdoc, with or without the fragment an in-page link adds to it. */
const SRCDOC_URL = /^about:srcdoc(?:[?#]|$)/;

function isPreviewFrame(frame: GuardedFrame): boolean {
  try {
    return frame.name === PREVIEW_FRAME_NAME;
  } catch {
    return true;
  }
}

/* Whether the frame sits at about:srcdoc directly under the main frame. A
   frame whose address or parent chain it can't read counts as one. */
function isTopSrcdocFrame(frame: GuardedFrame): boolean {
  try {
    return SRCDOC_URL.test(frame.url) && !frame.parent?.parent;
  } catch {
    return true;
  }
}

export function guardDocumentPreviewFrames(contents: GuardedContents): DocumentPreviewGuard {
  const previewFrameIds = new Set<number>();

  /* Whether this frame or one of its ancestors is a marked preview frame.
     A parent chain it can't read counts as inside one. */
  const isInPreview = (frame: GuardedFrame): boolean => {
    try {
      for (let current: GuardedFrame | null = frame; current; current = current.parent) {
        if (previewFrameIds.has(current.frameTreeNodeId)) return true;
      }
      return false;
    } catch {
      return true;
    }
  };

  contents.on('frame-created', (_event, { frame }) => {
    if (frame && isPreviewFrame(frame)) previewFrameIds.add(frame.frameTreeNodeId);
  });

  /* Whether a marked frame, or a frame inside one, started this navigation.
     An initiator it can't read counts as one. */
  const startedInPreview = (event: FrameNavigation): boolean => {
    try {
      const { initiator } = event;
      return !!initiator && isInPreview(initiator);
    } catch {
      return true;
    }
  };

  /* event.frame comes from the frame host Chromium creates for the
     navigation. Electron maps it back to the WebFrameMain that the
     frame-created handler above made when it read the frame, so frame.url is
     the frame's current address. Without that read, frame.url would be '' and
     the srcdoc rule would never fire. */
  contents.on('will-frame-navigate', (event) => {
    if (startedInPreview(event)) {
      event.preventDefault();
      return;
    }
    if (event.isMainFrame || event.url === 'about:srcdoc') return;
    if (!event.frame || isTopSrcdocFrame(event.frame) || isInPreview(event.frame)) event.preventDefault();
  });

  return {
    mayCarryServerToken: (frame) => !!frame && !isInPreview(frame),
  };
}
