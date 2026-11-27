// What Home hands the composer to place: the text, an optional range to
// select, and whether to send it as if Send were pressed. The bump makes the
// same text placed twice a new request.
export const composerPrefillHandler = (setPrefill) => (text, select, send) =>
  setPrefill({ text, bump: Date.now(), select, send: Boolean(send) });
