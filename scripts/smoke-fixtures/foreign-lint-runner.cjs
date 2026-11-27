// The setup smokes name this script in ANTON_HTML_LINT_RUNNER whenever they
// lint pages with the installed app. A packaged build runs the lint runner
// bundled in its app.asar and never this script, so a lint whose output holds
// this line, or that ends with status 3, ran a script the environment named.
process.stdout.write('foreign-lint-runner-ran\n');
process.exit(3);
