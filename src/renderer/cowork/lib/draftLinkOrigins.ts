/*
 * Origins of the draft-preview hosts, where the web preview frame and "open in
 * a browser tab" load a signed draft link: production, staging and dev, all
 * listed because one build serves every environment. index-web.html lists the
 * same three in frame-src and child-src, and shellCsp.test.ts keeps the two
 * equal.
 */
export const DRAFT_LINK_ORIGINS: readonly string[] = [
  'https://draft.mindshub.co',
  'https://draft-staging.mindshub.co',
  'https://draft-dev.mindshub.co',
];
