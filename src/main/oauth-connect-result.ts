import type { OAuthConnectResult } from './oauth-service';

/** Whether a code exchange returned every token the connector's spec needs
 * to be saved. A refreshing connector needs a refresh_token unless its spec
 * sets refresh_token_optional (Notion sometimes omits it). */
export function hasRequiredTokens(
  result: OAuthConnectResult,
  oauthBlock: { supports_refresh?: boolean; refresh_token_optional?: boolean },
): boolean {
  if (!result.ok || !result.access_token) return false;
  const needsRefreshToken = oauthBlock.supports_refresh !== false && oauthBlock.refresh_token_optional !== true;
  return !needsRefreshToken || Boolean(result.refresh_token);
}
