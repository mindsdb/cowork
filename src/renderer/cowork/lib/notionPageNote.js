// The header the page note starts with. It is appended to the user's message
// for the agent and stored with it, so a reloaded message is cut here before
// it is shown, copied or put back in the composer.
export const NOTION_PAGE_NOTE_HEADER = '[Notion pages added for this message — Anton-only context, do not echo back]';

export function stripNotionPageNote(content) {
  if (typeof content !== 'string') return content;
  const at = content.indexOf(`\n\n${NOTION_PAGE_NOTE_HEADER}`);
  return at === -1 ? content : content.slice(0, at);
}

// The server titles a conversation with the first 80 characters of the sent
// text, so the note can follow the question there, often cut off partway.
export function stripNotionPageNoteFromTitle(title) {
  if (typeof title !== 'string') return title;
  for (const match of title.matchAll(/\s+\[/g)) {
    const tail = title.slice(match.index).trimStart();
    if (NOTION_PAGE_NOTE_HEADER.startsWith(tail) || tail.startsWith(NOTION_PAGE_NOTE_HEADER)) {
      return title.slice(0, match.index);
    }
  }
  return title;
}

export function withoutNotionPageNotes(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (m?.role !== 'user') return m;
    const content = stripNotionPageNote(m.content);
    return content === m.content ? m : { ...m, content };
  });
}
