/*
 * The shared document viewer's script for one type (mountDocumentViewer.tsx).
 * scripts/document-viewer.mjs builds it once per type, resolving
 * virtual:document-viewer-bundle to that type's generated renderer bundle.
 */
import bundle from 'virtual:document-viewer-bundle';

import { MOUNT_SELECTOR, mountDocumentViewer } from './mountDocumentViewer';

const element = document.querySelector<HTMLElement>(MOUNT_SELECTOR);
if (element) void mountDocumentViewer(element, { bundle });
