# Code Mode task-control testing

Recorded 18 September 2026. This is an **evidence-only branch; do not merge it**.
The production PRs contain no demo game, video, QA page, runtime data or credentials.

[Watch the narrated Plan-mode → Tic-Tac-Tetris test](./mindshub-plan-tic-tac-tetris.mp4) (2m 46s).

The recording uses the production Code Mode components in an isolated QA shell,
connected to the real local server and Codex. It is not a packaged-installer test
and agent responses are not mocked. Build waiting time is edited out.

The test starts a new project in Plan mode, answers a structured question,
reviews the plan, explicitly chooses **Build from plan**, inspects the resulting
11-file diff, then opens and renames a Code Mode terminal. The generated game's
13 tests pass before its server starts. Two independent browsers create/join a
room and play a match, ending at top-out with O winning 9–4.

Additional checks: responsive menu placement at 1440px, 1024px and 390px;
keyboard dismissal/focus restoration; preserved drafts; attachment selection;
plan read-only enforcement; stop/restart while waiting for answers; stale plan
approval rejection; failed mode-change rollback; private-answer redaction;
notification opt-in, account-change cleanup, deduplication and click routing.

The OS notification banner itself and Windows installer behaviour are not
certified by this recording. They remain explicit manual QA checks in the PR.
