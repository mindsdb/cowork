/*
 * The setImmediate that JSZip's source calls between chunks. The bundle
 * generator resolves the setimmediate package to this module, because that
 * package also carries a Node branch (process.nextTick) the frame bundle
 * checks refuse. Each callback waits behind a MessageChannel message, so a
 * long inflate still yields to the frame's event loop between chunks.
 */
type ImmediateCallback = (...args: unknown[]) => void;

if (typeof globalThis.setImmediate !== 'function') {
  const queue: Array<() => void> = [];
  const channel = new MessageChannel();
  channel.port1.onmessage = () => queue.shift()?.();
  Object.assign(globalThis, {
    setImmediate(callback: ImmediateCallback, ...args: unknown[]) {
      queue.push(() => callback(...args));
      channel.port2.postMessage(null);
    },
  });
}

export {};
