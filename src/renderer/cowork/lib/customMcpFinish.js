// The page a custom MCP sign-in lands on; see signInFinish.js.
import { signInFinishPage } from './signInFinish';

export const CUSTOM_MCP_FINISH_PATH = '/custom-mcp/finish';

const page = signInFinishPage(CUSTOM_MCP_FINISH_PATH, 'anton.customMcpCompletion');

export const isCustomMcpFinishPage = page.isPage;
export const captureCustomMcpCompletion = page.capture;
export const takeCustomMcpCompletion = page.take;
