/* Cross-repository wire fixture: cowork-server's
 * tests/test_stream_continuation_boundary.py::test_a_handback_gives_back_the_answer_the_boundary_set_aside
 * owns the reset -> narration -> tool -> restore sequence. Its Python producer
 * cannot be imported here. Synthetic figures pin UTF-16 positions in that
 * sequence, including repeated values in narration the live UI removes. */
export const RESTORED_ANSWER = '📦 Site S1 holds 250 units; site S2 may need 99 units.';
export const RESTORED_NARRATION = '\n\nI will recheck 250 units and 99 requested units.';
export const RESTORED_DIAGNOSIS = '\n\nThe 250-unit count stands, up from 240; I cannot confirm the 12-unit adjustment.';
export const RESTORED_SAVED_TEXT = RESTORED_ANSWER + RESTORED_NARRATION + RESTORED_DIAGNOSIS;
export const RESTORED_LIVE_TEXT = RESTORED_ANSWER + RESTORED_DIAGNOSIS;

const traced = (text, origin, offset) => {
  const start = RESTORED_SAVED_TEXT.indexOf(text, offset);
  return {
    start, end: start + text.length, text, origin,
    sources: origin === 'step' ? [{ tool_use_id: 'toolu_stock', page: null }] : [],
  };
};

export const restoredFigureEvents = (conversationId = 'conv-a') => [
  { type: 'response.created', response: { id: 'r1' }, conversation_id: conversationId },
  { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'toolu_stock' },
  { type: 'response.output_text.delta', delta: RESTORED_ANSWER },
  { type: 'response.answer_reset', item_id: 'msg-1' },
  { type: 'response.output_text.delta', delta: RESTORED_NARRATION },
  { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'toolu_recheck' },
  { type: 'response.answer_restore', text: RESTORED_ANSWER },
  { type: 'response.output_text.delta', delta: RESTORED_DIAGNOSIS },
  {
    type: 'response.figure_sources',
    project_id: 'proj-1',
    steps: [{ tool_use_id: 'toolu_stock', kind: 'file', label: 'stock.csv', path: 'data/stock.csv', attachment_id: null, url: null, queries: [], requests: [] }],
    figures: [
      traced('250', 'step', 0),
      traced('99', 'none', 0),
      traced('250', 'step', RESTORED_ANSWER.length),
      traced('99', 'none', RESTORED_ANSWER.length),
      traced('250', 'step', RESTORED_ANSWER.length + RESTORED_NARRATION.length),
      traced('240', 'earlier_answer', RESTORED_ANSWER.length + RESTORED_NARRATION.length),
      traced('12', 'none', RESTORED_ANSWER.length + RESTORED_NARRATION.length),
    ],
  },
  {
    type: 'response.completed',
    assistant_message_id: 'a1',
    response: { id: 'r1', status: 'completed', output: [{ id: 'msg-1', status: 'completed', content: [{ type: 'output_text', text: RESTORED_SAVED_TEXT }] }] },
  },
];
