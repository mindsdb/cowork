// The doc preview's "Ask for a change" bar: the artifact viewer's quick edit
// bar (QuickEditBar), with every message going to the doc's chat. A doc is
// changed by the agent's doc tools, not by the quick edit route, so the bar
// sends the message the way "Edit with agent" does (`onAskAgent`), with the
// tab on screen as its context.
import { QuickEditBar } from '../artifact/quickEdit/QuickEditBar';
import { useQuickEdit } from '../artifact/quickEdit/useQuickEdit';
import { parseQuickEditPrompt } from '../../lib/quickEditPrompt';
import '../artifact/artifactWorkspace.css';

/**
 * @param {{
 *   artifact: object,
 *   tabId?: string | null,
 *   onAskAgent: (ask: object) => unknown,
 * }} props
 */
export default function DocAskBar({ artifact, tabId = null, onAskAgent }) {
  const controller = useQuickEdit(artifact, {
    enabled: true,
    direct: false,
    headRevisionId: null,
    resolveConversation: async () => null,
    continueInChat: async (chatPrompt, images) => {
      // The bar names the artifact after the message; the doc request already
      // says which doc it is about, so the agent gets the person's words.
      const request = parseQuickEditPrompt(chatPrompt)?.text ?? chatPrompt;
      const started = await onAskAgent({ blockIds: [], request, tabId, attachments: images });
      return started !== false;
    },
    onApplied: () => {},
  });
  return <QuickEditBar controller={controller} />;
}
