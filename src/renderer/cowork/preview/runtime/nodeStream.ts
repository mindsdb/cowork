/*
 * Node's stream module in the frame bundles: nothing. The bundle generator
 * resolves `stream` to this module. JSZip requires it only through
 * readable-stream for Node stream output, which the frame never asks for, and
 * its support check reads `Readable` inside a try/catch, so with nothing here
 * it turns Node streams off.
 */
export {};
