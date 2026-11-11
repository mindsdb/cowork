/** Counts one overlay as open. Returns the call that counts it closed (once). */
export function raiseNativeOverlay(): () => void;
/** True while any overlay is open. */
export function useNativeOverlayOpen(): boolean;
/** Counts the calling overlay as open while `open` is true. */
export function useNativeOverlay(open: boolean): void;
