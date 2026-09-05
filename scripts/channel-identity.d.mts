export interface ChannelBundleIdentity {
  readonly appId: string;
  readonly productName: string;
  readonly macIcon: string;
  readonly winIcon: string;
  readonly linuxIcon: string;
  /** Debian package name and executable name; both must differ per channel. */
  readonly linuxName: string;
}

export declare function channelIdentity(
  kindRaw: string | null | undefined,
): ChannelBundleIdentity | null;

export declare function linuxBuilderArgs(kindRaw: string | null | undefined): string[];
