// An example's answer, written as the markdown a task's answer would be, so
// the column draws it with the same renderer and type scale as chat.

// Every character markdown could read as syntax is escaped, so console copy
// such as "~$420/month … ~$5,000/year" stays text and never turns into
// strikethrough, math, a link or a table cell break.
const SYNTAX = /[\\`*_~|<>[\]#$!]/g;

export function escapeMarkdown(text) {
  return String(text ?? '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(SYNTAX, (ch) => `\\${ch}`)
    // A line that starts like a list item or a numbered step stays a line.
    .replace(/^([-+])(\s)/, '\\$1$2')
    .replace(/^(\d+)([.)])(\s)/, '$1\\$2$3');
}

const tableMarkdown = (block) => {
  const row = (cells) => `| ${cells.map(escapeMarkdown).join(' | ')} |`;
  return [
    row(block.columns),
    `| ${block.columns.map(() => '---').join(' | ')} |`,
    ...block.rows.map((cells) => row(block.columns.map((_, i) => cells[i] ?? ''))),
  ].join('\n');
};

export function answerMarkdown(answer) {
  return (answer?.blocks || []).map((block) => {
    if (block.type === 'heading') return `### ${escapeMarkdown(block.text)}`;
    if (block.type === 'paragraph') return escapeMarkdown(block.text);
    if (block.type === 'list') {
      return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${escapeMarkdown(item)}`).join('\n');
    }
    if (block.type === 'table') return tableMarkdown(block);
    return '';
  }).filter(Boolean).join('\n\n');
}
