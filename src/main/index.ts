// Entry point: the app itself (`app.ts`), or a one-shot headless HTML lint.
//
// A packaged binary always loads its own resources/app.asar and ignores a
// script passed as an argument, so anton's artifact checker cannot
// re-invoke this binary with its own runner the way a bare `electron` allows.
// It asks for lint mode through the environment instead, and the branch has to
// happen here, before a single one of the app's modules is loaded:
// - `require`, not `import` — an `import` would load `app.ts` in lint mode too;
// - a separate file, because a top-level `return` isn't allowed in a module.
if (process.env.ANTON_HTML_LINT_TARGET) {
  (require('./html-lint-host') as typeof import('./html-lint-host')).runHtmlLint();
} else {
  require('./app');
}
