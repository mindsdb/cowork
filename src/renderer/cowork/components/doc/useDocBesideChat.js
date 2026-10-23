// The doc open beside a conversation: which one, how wide, and what the chat
// sends about it.
//
// A doc opens from its card in the chat, or by itself when the agent creates
// one in this conversation (or edits one, unless the person has a doc open or
// closed that one here). What the pane shows rides on the conversation's
// messages as its doc view (lib/docViewContext).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConversationDocs } from './useConversationDocs';
import { askAgentAbout, clearDocView, setDocView } from '../../lib/docViewContext';

export function useDocBesideChat({ taskId, projectId, streaming, onSend }) {
  // {taskId, projectRef, artifactId, title}: tagged with its conversation, so
  // the render that switches conversations neither shows nor reports this
  // doc under the next one.
  const [openDoc, setDoc] = useState(null);
  const doc = openDoc?.taskId === taskId ? openDoc : null;
  const [expanded, setExpanded] = useState(false);
  // null until the person drags the divider (docLayout holds the default).
  const [share, setShare] = useState(null);
  const [resizing, setResizing] = useState(false);
  // Docs the person closed here: the agent editing one again does not reopen it.
  const dismissed = useRef(new Set());

  const docFor = (artifact) => ({
    taskId,
    projectRef: artifact.projectId || projectId || 'local',
    artifactId: artifact.id,
    title: artifact.title || '',
  });
  const open = (artifact) => {
    if (artifact?.id) setDoc(docFor(artifact));
  };
  const close = () => {
    if (doc?.artifactId) dismissed.current.add(doc.artifactId);
    setDoc(null);
    setExpanded(false);
    clearDocView(taskId);
  };
  useEffect(() => {
    // Another conversation: its own doc, not this one's. The pane going away
    // reports nothing, so the doc stops riding on this one's messages here.
    setDoc(null);
    setExpanded(false);
    dismissed.current = new Set();
    return () => clearDocView(taskId);
  }, [taskId]);

  // Only while a turn runs: the agent creates and edits docs inside turns, and
  // an idle chat should hold no stream open.
  useConversationDocs(taskId, {
    enabled: streaming,
    onCreated: (ev) => open({ ...(ev.card || {}), id: ev.artifactId, title: ev.title }),
    // The agent changing a doc (say, asked to from the library) brings it up
    // beside the chat, unless the person already has a doc open or closed this one.
    onUpdated: (ev) => {
      if (!ev.artifactId || dismissed.current.has(ev.artifactId)) return;
      const next = docFor({ ...(ev.card || {}), id: ev.artifactId, title: ev.title });
      // Read at update time: two events can land before the render that shows the first.
      setDoc((cur) => (cur?.taskId === taskId ? cur : next));
    },
  });

  // The request goes with its message (as onSend's options, through the
  // queue if a turn is running), naming the doc it was made in. [] for its
  // files: none of the composer's staged files are its own.
  const askAgent = (ask) => {
    if (!doc) return;
    const { message, docRequest } = askAgentAbout({ artifactId: doc.artifactId, projectId: doc.projectRef }, ask);
    onSend(message, [], { docRequest });
  };

  // Stable per conversation: the pane re-reports its view whenever this
  // changes, and the chat re-renders on every streamed word.
  const onViewChange = useCallback((view) => setDocView(taskId, view), [taskId]);

  return {
    doc,
    open,
    close,
    expanded,
    toggleExpand: () => setExpanded((v) => !v),
    share,
    setShare,
    resizing,
    setResizing,
    onViewChange,
    askAgent: taskId && onSend ? askAgent : undefined,
  };
}
