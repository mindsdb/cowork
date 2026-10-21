/*
 * The name attribute of the iframe that previews .xlsx, .docx, .pptx and .pdf
 * files. The renderer sets it on the frame, and the desktop main process reads
 * it when Electron creates the frame, so both sides import this one constant.
 */
export const PREVIEW_FRAME_NAME = 'cowork-document-preview';
