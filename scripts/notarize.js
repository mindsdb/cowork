const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== "darwin") return;

  const hasAppleIdAuth =
    process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID;
  const hasApiKeyAuth =
    process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_KEY_ISSUER;

  if (!hasAppleIdAuth && !hasApiKeyAuth) {
    console.warn(
      "Skipping notarization: set APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID or APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_KEY_ISSUER."
    );
    return;
  }

  const appName = packager.appInfo.productFilename;

  const auth = hasApiKeyAuth
    ? {
        appleApiKey: process.env.APPLE_API_KEY,
        appleApiKeyId: process.env.APPLE_API_KEY_ID,
        appleApiIssuer: process.env.APPLE_API_KEY_ISSUER,
      }
    : {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      };

  await notarize({
    tool: "notarytool",
    appBundleId: "com.anton.app",
    appPath: `${appOutDir}/${appName}.app`,
    ...auth,
  });
};
