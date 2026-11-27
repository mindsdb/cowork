// The page a built-in connector's web sign-in lands on; see signInFinish.js.
import { signInFinishPage } from './signInFinish';

export const OAUTH_FINISH_PATH = '/oauth/finish';

const page = signInFinishPage(OAUTH_FINISH_PATH, 'anton.oauthCompletion');

export const isOAuthFinishPage = page.isPage;
export const captureOAuthCompletion = page.capture;
export const takeOAuthCompletion = page.take;
