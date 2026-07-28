// Hand-written declarations for channel-identity.mjs so the drift test in
// src/main/channels.test.ts can import it under `npm run typecheck:test`.
export interface ChannelBundleIdentity {
  readonly appId: string;
  readonly productName: string;
  readonly macIcon: string;
  readonly winIcon: string;
}

export declare function channelIdentity(
  kindRaw: string | null | undefined,
): ChannelBundleIdentity | null;
