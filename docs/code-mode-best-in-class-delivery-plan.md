# MindsHub Code Mode — Best-in-Class Local Delivery Plan

| | |
|---|---|
| **Status** | In delivery v2 |
| **Last updated** | 2026-08-31 |
| **Applies to** | `cowork` and `cowork-server` |
| **Scope** | Local desktop coding on macOS and Windows; no cloud execution, hosted delegation, mobile control, or cloud workspace management |

## 1. Purpose

This is the delivery plan for taking MindsHub Code Mode from a strong agentic workflow product to a best-in-class local coding experience.

It is written to be executable milestone by milestone. An agent should be able to receive this document plus a milestone identifier in a `/goal` prompt, inspect the current implementation, implement the milestone, and self-verify it without having to reinterpret the product direction.

The plan builds on Code Mode's existing strengths:

- First-class Code Projects spanning multiple local repositories.
- Parallel tasks in isolated workspaces.
- GitHub and Linear issue/PR origins and status updates.
- Cross-repository delivery, review, CI handling, and source handoff.
- Shared, versioned team skills and engineering workflows.
- A capable multi-turn task composer, approval flow, and multi-terminal experience.
- Agent-neutral contracts, with Codex as the only supported engine in this programme.

The central gap is not another project-management layer or an IDE. It is the local workstation loop around the agent: seeing and supplying code context, running and visually verifying the application, precisely reviewing changes, and understanding parallel agent work.

### Delivery progress in this branch

- **M0 foundation:** versioned Codex capabilities, canonical resource identity, bounded event rendering, optimistic approvals, and cross-layer compatibility are in place.
- **M1 Files:** project-wide browsing/search, bounded file reads, exact line selection, and immutable prompt references are implemented.
- **M2 Run and Preview:** versioned project run actions start in managed named terminals and feed a secure, responsive preview surface.
- **M3 Review:** multi-repository diffs now expose staged state, selectable diff lines, file-level stage/unstage/discard, and precise Codex review notes. Hunk-level Git mutation remains a later precision slice.
- **M4 Parallel work:** Codex collaboration items normalize into visible child-work cards; task-level parallelism and attention grouping remain available in the sidebar.
- **M7–M9 foundations:** project setup/validation/environment configuration, multi-terminal restore, extension inventory, advanced runtime controls, pinning, archiving, task organization, and recovery predate this pass and are retained. The remaining acceptance work is recorded explicitly rather than being hidden by this status summary.

## 2. North star

MindsHub Code Mode should be the best place for an engineering team to give an AI coding agent a real project, let it work across every relevant repository, understand what it is doing, verify the result, and deliver the work safely.

The intended synthesis is:

- **MindsHub:** multi-repository projects, team workflows, shared skills, and issue-to-delivery coordination.
- **Claude Code Desktop:** clear workspace composition, live previews, visible parallel work, and low-friction day-to-day usability.
- **Codex Desktop:** rigorous worktree lifecycle, Git state, review scopes, and precise change control.
- **OpenCode Desktop:** provider/agent flexibility, session mechanics, extensibility, and granular policies.

Success is not feature-count parity. Success is a coherent experience in which each capability appears at the moment the user needs it, without turning Code Mode into a traditional IDE or exposing implementation detail for its own sake.

## 3. Product and engineering principles

### 3.1 User experience

1. **The conversation remains primary.** Files, review, terminal, preview, tasks, and other work surfaces support the conversation; they do not permanently crowd it.
2. **Progressive disclosure over control panels.** Show the current choice compactly. Explain and expose alternatives when the user opens the relevant picker or pane.
3. **No IDE cosplay.** Do not build IntelliSense, a debugger, a package manager, a full Git client, or editor chrome that users already have elsewhere. Build the context, verification, and review surfaces that make an agentic workflow complete.
4. **No safety theatre.** Enforce real boundaries, disclose consequential actions at the decision point, and avoid redundant warnings or confirmation checkboxes.
5. **Everything useful is selectable and copyable.** Paths, commands, errors, diffs, messages, identifiers, branch names, URLs, and task output must support normal text selection and copy.
6. **Optimistic local interaction.** Typing, tab changes, pane changes, approvals, queuing, and stopping should feel immediate even when the sidecar or engine is busy.
7. **One application language.** Reuse Cowork tokens, components, interaction patterns, spacing, focus treatment, and model selection. Code Mode may be recognisably technical without looking like another product.
8. **Keyboard complete, pointer excellent.** Every primary flow must be operable by keyboard without compromising polished pointer interactions.
9. **Accessible by construction.** Focus order, semantics, labels, contrast, reduced motion, screen-reader announcements, and scalable type are acceptance criteria, not cleanup.
10. **macOS and Windows are first-class.** Platform differences should be intentional and tested, especially paths, shells, process handling, worktrees, ports, and keyboard shortcuts.

### 3.2 Architecture

1. **Agent-neutral product contracts.** The renderer consumes normalized capabilities and events rather than Codex-specific wire formats. Codex remains the only selectable coding agent in this programme.
2. **Capability negotiation, not fake parity.** Hide or adapt unsupported controls; never show a control that an engine cannot honour.
3. **Harness and inference are separate choices.** Codex is the only supported coding harness in this programme; MindsHub Inference provides its model catalogue, routing, entitlement, and usage path by default. The boundary remains explicit so a separately approved future adapter can reuse the same inference path without changing product surfaces or silently bypassing MindsHub Inference.
4. **Backward-compatible cross-repository delivery.** Land server contracts before renderer dependencies and preserve compatibility with an older/newer counterpart during rollout.
5. **Local-first and loopback-only.** Preview servers, terminals, file access, and diagnostics remain local unless a later explicitly scoped project changes that.
6. **No renderer filesystem shortcuts.** Electron host access continues through the established platform abstraction. The server or main process owns privileged filesystem and process operations.
7. **Explicit project-relative identity.** A file is identified by project/repository identity plus a relative path, never by an ambiguous display string.
8. **Durable task truth.** Terminal tabs, pane state, reviews, comments, subagent status, previews, and queued instructions survive navigation and safe restarts where users would reasonably expect them to.
9. **Bounded data.** Large repositories, long tasks, large diffs, noisy processes, and binary files must not degrade the entire renderer.
10. **Observable failures.** User-facing errors state what failed and how to recover. Diagnostics retain correlation and detail without leaking tokens, secrets, environment variables, or source contents unnecessarily.
11. **Small reviewable delivery units.** No milestone should arrive as one huge change. API contracts, server behavior, client state, and visible UX should be independently reviewable wherever compatibility allows.

## 4. Scope boundaries

### Included

- Local repositories and folders.
- Code Projects with one or many repositories.
- No-project tasks with a selected folder.
- Isolated task workspaces and worktrees.
- macOS and Windows desktop behavior.
- Local terminals, processes, project actions, previews, and visual verification.
- Git review and local source handoff.
- GitHub and Linear context already connected to Code Mode.
- Codex as the supported coding engine, behind contracts that do not prevent a later adapter.
- Skills, MCP servers, plugins, hooks, and engine-native extension inventory/configuration where locally available.
- Local/OS notifications and a Code Mode activity centre.

### Explicitly excluded

- Cloud-hosted coding tasks or workspace compute.
- Mobile/web remote control or dispatch.
- Hosted schedules and unattended cloud automation.
- Shared cloud filesystem or cloud IDE infrastructure.
- Slack integration in this programme.
- A general-purpose source-code IDE, debugger, LSP implementation, package manager, or Git hosting product.
- Replacing GitHub, Linear, users' editors, or local developer tools.
- Claude Code, OpenCode, or any other additional coding-agent adapter in this programme.

## 5. Target experience

A developer can:

1. Start from a Code Project, a local folder, a GitHub issue/PR, or a Linear issue.
2. Use Codex with a chosen MindsHub model, permission mode, and optional skill/workflow.
3. Let the task run in an isolated local workspace while starting other tasks in parallel.
4. Open a referenced file, search across all project repositories, and add a file, folder, symbol, or selected lines to the task without leaving Code Mode.
5. See project actions and detected development servers, run the application, and inspect it in a secure embedded preview.
6. See plans, subagents, background commands, approvals, and task state without reading a raw event log.
7. Review changes by repository and Git scope, comment on individual lines, stage or revert precise hunks, and ask the agent to address comments.
8. Validate the work, produce commits and pull requests across all affected repositories, follow checks and review comments, and apply or merge deliberately.
9. Reopen the task later with its layout, terminals, review state, previews, and task history intact.

## 6. Roadmap at a glance

| Milestone | Outcome | Competitive bar | Priority | Relative size | Depends on |
|---|---|---|---|---|---|
| **M0** | Capability, performance, and verification foundation | Prevent Codex-only UI and regressions | Required foundation | M | Existing Code Mode |
| **M1** | Contextual Files workspace | Claude/OpenCode-level file context without building an IDE | Highest | XL | M0 |
| **M2** | Project Actions and Live Preview | Claude-level local run-and-see loop | Highest | XL | M0, M1 path identity |
| **M3** | Precision Review and Git Control | Codex-level review scopes and hunk control | Highest | XL | M0, M1 file surface |
| **M4** | Visible Parallel Work | Claude-level subagent/task visibility with MindsHub parallel projects | Highest | L | M0 |
| **M5** | Additional engine adapters | Deferred outside this programme | Deferred | — | User feedback and a separate product decision |
| **M6** | Multi-engine conformance | Deferred outside this programme | Deferred | — | M5 in a future programme |
| **M7** | Reproducible Local Environments | Codex-level setup/actions/restore and Windows parity | Medium-high | L | M2 |
| **M8** | Unified Extensions and Advanced Permissions | Best-in-class local usability and policy depth | Medium-high | XL | M7 |
| **M9** | Activity, Notifications, and Best-in-Class Polish | Codex attention management and cohesive final UX | Medium-high | L | M1–M8 |

- **Best-in-class core release:** M0–M4.
- **Mature Codex-powered local platform release:** M0–M4 and M7–M9.

Milestones are sequential where contracts depend on one another, but reviewable slices inside a milestone should be stacked rather than accumulated into a single large branch or PR.

M5 and M6 are retained below only as future architectural notes. They must not be executed as part of this delivery. Agent-neutral seams remain a quality requirement, but product validation is intentionally focused on one excellent Codex experience.

## 7. Common milestone delivery contract

Every milestone must satisfy this contract in addition to its specific acceptance criteria.

### 7.1 Before implementation

- Read the applicable repository instructions and current implementation; do not implement from this document alone.
- Rebase or merge the current feature work onto the latest `staging` in both repositories before making milestone changes.
- Record the pre-change branch SHAs and the paired `cowork`/`cowork-server` compatibility point.
- Identify existing user changes and preserve them.
- Produce a short implementation map naming the contracts, state owners, components, services, migrations, and tests that will change.
- Confirm which slices can be backward-compatible and define the safe deployment order.
- Capture a real baseline for affected journeys, including responsiveness and failure states.
- For a visible milestone, map the complete normal/loading/empty/error/recovery interaction before coding and identify the existing Cowork primitives it will reuse.
- Revalidate only the relevant competitor benchmark against current official behavior; copy the useful interaction principle, not branding or incidental layout.

### 7.2 During implementation

- Prefer pure decision logic and small domain modules over adding more conditions to large route/view files.
- Keep transport models, engine adapter models, domain state, and renderer view state distinct.
- Add regression tests with bug fixes and behavior tests with new logic.
- Reuse existing UI primitives and tokens. A new primitive requires a documented, cross-surface need.
- Keep incomplete UX behind a local capability or feature flag until the complete journey works.
- Preserve task history and tolerate missing/new fields when server and renderer versions differ.
- Avoid schema changes unless durable state genuinely requires them. Migrations must be additive, reversible where practical, and covered by upgrade tests.

### 7.3 Required automated verification

For affected code, at minimum:

- `cowork`: unit/component tests, TypeScript checks, Cowork purity check, renderer production build, and relevant Electron E2E coverage.
- `cowork-server`: unit tests, focused integration tests, Python syntax/type/lint checks available in the repository, and migration upgrade coverage if applicable.
- Contract fixtures replayed against every registered engine adapter.
- macOS and Windows CI for platform-sensitive code.
- No lowering of coverage thresholds or removal/weakening of unrelated tests.

### 7.4 Required human verification

- Exercise the complete milestone journey in a packaged or production-equivalent desktop build—not only a mocked web renderer.
- Verify dark and light themes where Code Mode supports them.
- Verify keyboard-only use, focus restoration, text selection/copy, empty/loading/error states, and recovery after navigation.
- Test with at least one single-repository folder, one multi-repository project, one non-Git folder, and one repository with a large diff/history where relevant.
- Test under CPU load and while another Code task is running.
- Test or obtain evidence from both macOS and Windows before calling a cross-platform milestone complete.
- Capture screenshots or a short video and a concise evidence log with exact builds/SHAs.

### 7.5 Quality gate

A milestone is not complete until:

- The thermo-nuclear maintainability review rates the total changed implementation **A or better**, with no unresolved high-severity findings.
- No newly introduced giant component/service acts as a dumping ground for multiple domains.
- Conditional complexity and platform/engine branching live behind explicit abstractions.
- The UI has received a critical visual/usability pass in real rendered states.
- Existing Cowork mode is unchanged except for intentional reuse of shared primitives; its core smoke tests still pass.
- The two repository branches point to a documented, mutually compatible pair of commits based on current `staging`.

### 7.6 Responsiveness budgets

Measure locally in a representative long task rather than relying only on synthetic tests:

- Text input echo and local control response: **under 50 ms p95**.
- Approval choice disappears or enters an explicit pending state: **under 100 ms**.
- Switching an already-loaded task, tab, or pane: **under 100 ms p95**.
- No long server request may block typing, scrolling, task switching, or local menu interaction.
- Long lists and event histories must remain virtualized or bounded.
- Any operation expected to exceed 300 ms shows stable, non-layout-shifting progress.

## 8. Milestone details

## M0 — Capability, performance, and verification foundation

### Outcome

Create the contracts and safeguards that allow Files, Preview, Review, and child work to be built once at the product layer without hard-coding Codex wire behavior into the renderer.

### User value

Most of M0 is intentionally invisible, but it prevents later features from changing shape if a separately approved coding agent is introduced. It does not expose or implement another agent. It also addresses existing sensitivity to slow restoration, delayed approvals, and large task histories before new surfaces add load.

### UX contract

- Existing Code Mode behavior remains visually and functionally stable.
- Unsupported engine capabilities are omitted or clearly unavailable; they never fail only after being clicked.
- Existing task loading, typing, approvals, task switching, and timeline scrolling meet the responsiveness budgets.
- Loading indicators do not resize or move the primary composer/workspace.

### Engineering scope

1. **Versioned capability manifest**
   - Normalize capabilities for files, editable files, references, preview, project actions, review scopes, Git mutations, subagents, background work, runtime controls, extensions, environment lifecycle, and session mechanics.
   - Support capability metadata where a boolean is insufficient—for example supported review scopes or permission categories.
   - Persist the capability snapshot used by a task so a restored task can explain unavailable historical controls.
2. **Normalized event envelopes**
   - Define stable event types for files, selections, processes, previews, review comments, Git mutations, child work, questions, approvals, usage, and engine diagnostics.
   - Preserve opaque engine payloads only for diagnostics; renderer logic must not depend on them.
3. **Project resource identity**
   - Introduce repository ID + normalized relative path as the canonical file identity.
   - Define Windows drive/case behavior, symlink handling, non-Git folders, deleted files, and renamed repositories.
4. **Async state and performance hardening**
   - Isolate composer state from event-stream updates.
   - Batch timeline updates and avoid recomputing project/session lists for each event.
   - Make approvals optimistic with a visible pending/retry state.
   - Instrument local timings and correlation IDs without source or secret leakage.
5. **Adapter conformance harness**
   - Golden fixtures for start, restore, turn, queue, steer, stop, approval, command, file change, diff, child work, usage, failure, and completion.
   - Tests prove that capability declarations match observed behavior.

### Reviewable delivery slices

1. Add versioned contracts and compatibility tests in `cowork-server` without changing visible behavior.
2. Add client types, tolerant decoders, and capability selectors in `cowork`.
3. Introduce canonical project-resource identity and path-security tests.
4. Move high-frequency timeline/composer decisions into isolated state modules and add performance fixtures.
5. Add adapter conformance fixtures for the existing Codex engine.
6. Add local diagnostics/evidence capture and document the paired-version protocol.

### Acceptance criteria

- Every existing Code Mode control is driven by product state or declared engine capability.
- Unknown capabilities/events are safely ignored and retained for diagnostics where appropriate.
- A new engine fixture can be registered without importing its SDK types into renderer components.
- Restoring a task created with an older capability schema succeeds.
- A 1,000-event task with six tasks active meets the responsiveness budgets.
- Approval selection is immediately acknowledged and cannot be submitted twice.
- Canonical file identity round-trips on macOS and Windows and rejects traversal/symlink escape.
- Existing Code Mode and Cowork test suites remain green.

### Milestone demo

Run two tasks in parallel, rapidly switch between them, type and queue a follow-up while events stream, approve a command, restart the app, and restore both tasks without visible lag or lost state.

### `/goal` execution seed

> Execute M0 from `docs/code-mode-best-in-class-delivery-plan.md`. Treat its common delivery contract and M0 acceptance criteria as binding. Preserve existing UX, implement the capability/event/resource foundations in small backward-compatible slices across `cowork-server` and `cowork`, and finish only after the conformance, performance, packaged-app, cross-platform, and A-quality gates pass.

## M1 — Contextual Files workspace

### Outcome

Let users inspect, search, reference, and make small edits to project files directly in the task, without turning Code Mode into an IDE.

### User value

The user can understand what the agent is discussing, supply precise context, and make or request a small correction without repeatedly opening Finder, Explorer, or another editor.

### UX contract

- Add a **Files** work surface available from the task header and from clickable file references in activity/review.
- The surface is optional and dismissible. Opening it reduces available conversation width elegantly rather than covering or permanently shrinking the task.
- A multi-repository project starts with a quiet repository grouping. Single-folder tasks do not show redundant repository hierarchy.
- Provide Quick Open and search across file names and text, with clear repository scope.
- Files open in lightweight tabs. Text is selectable; source can be copied.
- Users can add a file, folder, symbol result, or selected line range to the composer as structured context.
- Small text edits can be made and saved atomically. The UI clearly shows modified-on-disk conflicts.
- Binary, generated, huge, ignored, inaccessible, and deleted files receive useful specialized states rather than broken generic previews.
- Keyboard shortcuts follow platform conventions and never collide with existing global task shortcuts.

### Engineering scope

1. **Secure file APIs**
   - List children lazily, stat resources, read bounded text/ranges, search names/content, save with expected-version checking, and reveal/open externally.
   - Enforce task/project roots after symlink resolution.
   - Stream or page large results; never return an entire large repository tree.
2. **Search/index strategy**
   - Prefer bounded native search (`rg` where available) with cancellation and result limits.
   - Degrade clearly when tools are unavailable.
   - Ignore known heavy/generated directories by default while allowing explicit inclusion.
3. **File surface state**
   - Repository tree, tabs, active file, selection, scroll position, and panel width persist per task.
   - External filesystem changes update the visible state without overwriting unsaved user edits.
4. **Context references**
   - Structured reference schema includes repository, relative path, optional line range, content version/hash, and display label.
   - Engine adapters receive references through normalized task input, translating to native syntax only at the adapter boundary.
5. **Lightweight editor**
   - Syntax highlighting, find, line numbers, selection, copy, and atomic save.
   - No autocomplete, refactoring, debugging, extension host, or language server in this milestone.

### Reviewable delivery slices

1. Server resource-list/read APIs with root-boundary, Windows-path, symlink, binary, and size tests.
2. Lazy multi-repository file tree and empty/loading/error states.
3. File tabs, text viewer, external-change handling, and persisted layout state.
4. Quick Open plus cancellable filename/content search.
5. Structured composer references for files, folders, and line selections.
6. Atomic lightweight editing with conflict detection and regression tests.
7. Click-through from timeline, review, error, and terminal file references.
8. Accessibility, performance, dark/light, and packaged-app refinement.

### Acceptance criteria

- A user can open a file mentioned by the agent in one action.
- Quick Open finds a file across a three-repository project and identifies its repository unambiguously.
- Selecting lines and choosing **Add to task** produces a structured, removable composer chip and the engine receives the correct immutable context.
- A safe text edit can be saved; a concurrent on-disk change is never silently overwritten.
- A repository with at least 100,000 files does not freeze the renderer or eagerly materialize the full tree.
- Search is cancellable and bounded; navigating away does not leave orphaned work.
- Path traversal and symlink escape tests pass on macOS and Windows.
- File panes restore correctly after task switching and app restart.

### Milestone demo

Open a three-repository Code Project, quick-open a server file, add selected lines to a follow-up, inspect a file cited by the agent, make one small edit, and return to the conversation with the exact context preserved.

### `/goal` execution seed

> Execute M1 from `docs/code-mode-best-in-class-delivery-plan.md` after confirming M0 is complete. Build the optional contextual Files workspace, structured references, search, tabs, and safe lightweight edits. Do not build an IDE. Deliver in the listed reviewable slices and satisfy every security, performance, packaged-app, Windows/macOS, UX, and A-quality acceptance gate.

## M2 — Project Actions and Live Preview

### Outcome

Create a complete local run-and-see loop: start the application using a project-defined action, discover its local endpoint, inspect it in Code Mode, and let the agent perform bounded visual verification.

### User value

The user can see whether the thing being built actually works. The agent can verify rendered behavior rather than declaring success from tests alone.

### UX contract

- Add compact **Run** and **Preview** entry points to an active task. Do not show an empty preview pane when the project has nothing previewable.
- A project can define named actions such as **Run app**, **Tests**, **Lint**, or **Storybook**. Common actions may be suggested from repository metadata but require user confirmation before being saved as project defaults.
- Running actions appear as named background processes, distinct from interactive terminal tabs.
- A detected HTTP server offers **Open preview** with the relevant port and repository/action identity.
- The embedded preview supports reload, back/forward, open externally, viewport presets, address display, screenshots, and a concise console/network error summary.
- The agent can request screenshots and bounded page interaction only when the engine and permission mode support it.
- Preview and process state persist across normal navigation; failures are recoverable without restarting the whole task.
- The experience is equally coherent for a simple HTML file, a single server, and multiple project services.

### Engineering scope

1. **Project action model**
   - Name, repository, command, working directory, environment references, port bindings, readiness rule, restart policy, and visibility.
   - Separate stored project configuration from task-local process instances.
2. **Process supervisor**
   - Start/stop/restart, output ring buffer, exit state, process-tree cleanup, port collision handling, and app-restart recovery rules.
   - Windows Job Object/process-tree behavior and macOS process-group behavior must be tested.
3. **Server readiness and port mapping**
   - Reuse allocated project port names.
   - Detect loopback URLs from structured readiness checks and bounded output parsing.
   - Never expose a preview server beyond loopback by default.
4. **Secure preview host**
   - Isolate preview content from Electron privileges and Code Mode authentication state.
   - No Node integration, no arbitrary bridge access, clear navigation boundaries, and explicit external navigation handling.
5. **Visual verification contract**
   - Normalized screenshot, viewport, click/type, DOM/query, console-error, and navigation events where an engine supports them.
   - Permission enforcement remains at the product layer, including for child agents.

### Reviewable delivery slices

1. Additive project-action contracts, persistence, validation, and backwards-compatible APIs.
2. Cross-platform background-process supervisor with output bounds and cleanup tests.
3. Project Settings action editor using existing controls and strong defaults.
4. Task-level Run/process surface and named process status.
5. Secure embedded preview for loopback HTTP and static supported files.
6. Viewports, console/error summary, screenshots, and open-externally controls.
7. Agent-neutral visual interaction contract and Codex adapter implementation.
8. Multi-service, recovery, accessibility, and packaged-app verification.

### Acceptance criteria

- A user can configure or accept a suggested **Run app** action, start it, and open the working application without manually copying a port.
- Two tasks can run services using the same configured port name without colliding.
- Stop/restart terminates the complete process tree on macOS and Windows.
- Preview content cannot access Electron APIs, task credentials, or another task's preview state.
- The user and agent can capture a screenshot at desktop and mobile viewports.
- A server crash produces a concise recoverable state with retained logs.
- Long-running output is bounded and does not slow typing or task switching.
- Static HTML, a typical frontend dev server, and a full-stack two-service project are verified end to end.

### Milestone demo

Ask the agent to modify a small full-stack application, run the configured services, open the preview, verify desktop and mobile states, detect and fix one visual/runtime error, and show the final working application alongside the task.

### `/goal` execution seed

> Execute M2 from `docs/code-mode-best-in-class-delivery-plan.md` after M0 and the M1 resource identity are complete. Deliver project actions, cross-platform background processes, secure local previews, and agent-neutral visual verification. Keep previews loopback-only and sandboxed. Complete all listed end-to-end, security, recovery, performance, UX, and A-quality gates.

## M3 — Precision Review and Git Control

### Outcome

Make Code Mode the most trustworthy place to understand and shape the agent's changes across one or many repositories before delivery.

### User value

The user can answer: what changed, when, in which repository, relative to what, what has been staged, what the agent changed during its last turn, and what still needs attention. They can act at file, hunk, or line level without dropping to another Git client.

### UX contract

- Review opens as a first-class work surface and remembers task-specific state.
- Provide scopes when meaningful: **Working tree**, **Staged**, **Commit**, **Branch**, and **Last turn**.
- In a multi-repository project, show **All repositories** plus a repository selector and per-repository state.
- The file list communicates status and additions/deletions without overwhelming the diff.
- Users can stage, unstage, discard/revert, and restore by file or hunk. Destructive actions identify exactly what will change and offer recovery where technically possible.
- Users can attach an inline comment to a diff line/range and send all comments as one structured follow-up to the agent.
- `/review` produces structured findings with severity, file/range, rationale, and status—not only prose in the transcript.
- GitHub PR comments and local review comments use a coherent visual language while retaining their origin.
- Binary, renamed, deleted, conflicted, submodule, generated, and oversized diffs have intentional states.

### Engineering scope

1. **Repository state service**
   - Normalized Git status, refs, merge bases, staged/unstaged changes, commits, branch range, and turn boundaries per repository.
   - Non-Git project folders degrade gracefully.
2. **Diff service**
   - Structured files/hunks/lines with stable anchors where possible.
   - Pagination/virtualization and safe fallback for very large or unsupported diffs.
3. **Git mutations**
   - Stage/unstage/revert file and hunk with precondition checks.
   - Create a recoverable task-local snapshot before destructive worktree mutation.
   - Reject stale mutations when the underlying file/index changed.
4. **Review comments**
   - Durable task-local comment threads anchored to repository/path/diff position and source version.
   - Structured conversion into an engine follow-up.
5. **Structured AI review**
   - Normalize engine findings into severity, confidence, location, category, explanation, and suggested action.
   - Track open, addressed, dismissed, and outdated states.
6. **Delivery continuity**
   - Existing draft PR, checks, review-thread, source handoff, and automation flows remain intact and use the new repository/diff state rather than parallel logic.

### Reviewable delivery slices

1. Read-only repository-state and review-scope APIs plus contract fixtures.
2. Structured virtualized diff surface with repository and scope navigation.
3. Stage/unstage at file level with stale-state protection.
4. Hunk-level stage/unstage/revert plus task-local recovery snapshot.
5. Durable inline local comments and send-to-agent flow.
6. Structured `/review` findings and lifecycle.
7. Unify local review, GitHub comments, PR delivery, and source handoff state.
8. Large/binary/conflict/non-Git states and final UX/accessibility refinement.

### Acceptance criteria

- A three-repository task can be reviewed as one change set or repository by repository.
- Every supported scope accurately matches command-line Git ground truth in automated fixtures.
- Stage/unstage/revert works at file and hunk level and refuses stale operations safely.
- A revert creates a recoverable local snapshot and communicates recovery without alarmist copy.
- Several inline comments can be sent as one agent instruction with exact repository/path/range context.
- Structured AI findings link to the relevant diff and update when addressed or made obsolete.
- Existing PR/CI automation continues to work and has no duplicate diff/repository implementation.
- Large diffs remain navigable and do not block composer input or task switching.

### Milestone demo

Complete a multi-repository task, switch among Last turn/Working tree/Branch scopes, comment on two lines, ask the agent to fix them, stage selected hunks, inspect a structured review, and create the existing draft PR set with the selected changes.

### `/goal` execution seed

> Execute M3 from `docs/code-mode-best-in-class-delivery-plan.md` after M0 and M1. Build Codex-depth local review across multi-repository projects: scopes, structured diffs, precise Git mutations, recoverable destructive actions, inline comments, and structured AI findings. Reuse this state in existing PR/CI and handoff flows. Satisfy all correctness, stale-state, large-diff, UX, packaged-app, and A-quality gates.

## M4 — Visible Parallel Work

### Outcome

Make parallel and delegated agent work understandable and controllable without exposing a stream of internal implementation noise.

### User value

The user knows which tasks and workers are active, what each is doing, which one needs attention, and what each changed. They can investigate or redirect one thread of work without derailing the main conversation.

### UX contract

- The existing task remains the primary unit in the sidebar and activity centre.
- Within a task, show a compact **Work** surface only when child work, background commands, or side investigations exist.
- Each worker has a human-readable purpose, state, elapsed time, current concise activity, parent, and result.
- Selecting a worker reveals its conversation/activity and affected files without injecting all detail into the main timeline.
- Users can stop a worker, answer its question, or redirect it when the engine supports those actions.
- Add a lightweight **side investigation** that can inspect context and return a result without mutating the main task unless explicitly promoted.
- Main-task completion summarizes child results and unresolved failures.
- Attention states propagate: a hidden child waiting for approval makes the parent visibly need attention.

### Engineering scope

1. **Normalized work graph**
   - Parent/child relationship, type, capability, state, purpose, timestamps, result summary, affected resources, and attention state.
   - Support engines that report only flat activity by representing it honestly rather than fabricating child agents.
2. **Child lifecycle controls**
   - Start where supported, observe, send input, approve, steer, stop, retry, and promote output.
   - Parent permission ceiling applies to all descendants.
3. **Side investigations**
   - Read-only by default, isolated context, bounded history, explicit promotion into the main task.
4. **Activity compression**
   - Summaries and view modes keep routine tool noise collapsed while making errors, questions, plans, and results easy to find.
5. **Restoration**
   - Restore the graph and attention states after navigation/restart, reconciling with the live engine when possible.

### Reviewable delivery slices

1. Work-graph contracts, storage, and tolerant event reconciliation.
2. Read-only Work surface and nested attention propagation for current Codex events.
3. Worker detail view with activity, resources, output, and restoration.
4. Supported stop/input/approval/steer controls with capability gating.
5. Read-only side investigations and explicit result promotion.
6. Main-timeline summarization and Normal/Expanded activity preferences.
7. Stress, accessibility, restart, and multi-task UX refinement.

### Acceptance criteria

- A task with several children/background processes remains understandable without expanding every event.
- The user can identify a worker's purpose, state, files, result, and whether it needs attention.
- Waiting/failure state reaches the parent and the global task list immediately.
- Unsupported controls never appear for engines that cannot honour them.
- Child permissions cannot exceed the parent task's current permission mode.
- A side investigation cannot mutate files or silently join main context by default.
- Restarting the app restores the work graph without duplicate workers or lost questions.
- Ten active workers across several tasks do not violate responsiveness budgets.

### Milestone demo

Run two project tasks concurrently; in one, delegate separate frontend and backend investigations, inspect each worker, answer one question, stop or redirect another, promote a side investigation, and show the resulting consolidated task summary.

### `/goal` execution seed

> Execute M4 from `docs/code-mode-best-in-class-delivery-plan.md` after M0. Build an agent-neutral Work surface for child agents, background work, attention propagation, lifecycle controls, and read-only side investigations. Preserve a quiet main timeline, enforce parent permission ceilings, restore state reliably, and complete all stress, UX, cross-platform, and A-quality gates.

## Deferred product decision — additional coding agents

M5 and M6 are intentionally unplanned. Code Mode supports Codex only while the team gathers user feedback. Do not add, expose, advertise, or test Claude Code, OpenCode, or another coding agent as part of this programme.

Shared product contracts should remain capability-based and free of unnecessary Codex-specific assumptions, but that is an architecture constraint—not a second-agent deliverable. A future agent may be considered only through a separate product decision and delivery plan.

## M7 — Reproducible Local Environments

### Outcome

Make a Code Project predictable to start, validate, preserve, and hand back on macOS and Windows.

### UX contract

- Project Settings gains a concise **Environment** section for setup, actions, variables, named ports, task isolation, and retention.
- A task indicates which environment/workspace it is using without exposing UUID paths as primary labels.
- Setup progress is visible below stable task chrome and never moves the composer.
- Users can rerun setup, see concise failures, and open full copyable logs.
- Before cleanup or destructive handoff, Code Mode creates a recoverable local snapshot when technically possible.
- Users can keep, archive, restore, or remove completed task workspaces with clear disk-usage implications.

### Engineering scope

- Versioned setup scripts or command steps, with per-platform overrides only when needed.
- Reusable actions from M2 promoted into versionable project configuration.
- Worktree include rules for necessary ignored local files without copying secrets by default.
- Setup result caching keyed by relevant configuration/revision, with explicit invalidation.
- Snapshot/restore metadata and retention policy.
- Robust source-to-workspace and workspace-to-source handoff across repository sets.
- Windows filesystem, Git, shell, process, and long-path behavior.

### Reviewable delivery slices

1. Additive environment schema and compatibility plan.
2. Setup runner, logs, cancellation, caching, and failure recovery.
3. Project Settings environment editor with platform-aware validation.
4. Worktree include rules and secret-safe copy policy.
5. Snapshot/restore and retention lifecycle.
6. Multi-repository handoff hardening and conflict recovery.
7. macOS/Windows packaged verification and documentation.

### Acceptance criteria

- A fresh isolated task can prepare and run a documented project on macOS and Windows from stored project configuration.
- Setup cancellation/failed steps leave the workspace recoverable and retryable.
- Secrets are not copied into task workspaces by inference.
- Snapshot/restore recovers a deliberately discarded local change.
- Workspace cleanup never removes source folders or unresolved user work.
- Multi-repository handoff accurately reports and resolves per-repository conflicts.
- Internal UUID paths are available for diagnostics but not presented as user-facing workspace names.

### Milestone demo

Create two isolated tasks from one project, prepare and run both with allocated ports, deliberately fail and retry setup, archive one workspace, restore it, and hand changes back across repositories.

### `/goal` execution seed

> Execute M7 from `docs/code-mode-best-in-class-delivery-plan.md`. Build reproducible local project setup, reusable actions, safe worktree includes, snapshot/restore, retention, and multi-repository handoff on macOS and Windows. Preserve secrets and source work, keep progress stable and understandable, and complete every recovery and A-quality gate.

## M8 — Unified Extensions and Advanced Permissions

### Outcome

Give teams one coherent place to understand and control the local capabilities available to Codex, while retaining the current simple permission experience and a product contract that can accommodate another engine later.

### UX contract

- Replace read-only extension inventory with a first-class **Extensions** experience covering Skills, MCP, Plugins, Hooks, Apps/Connectors, and engine-native items.
- Users can search, inspect source/configuration, understand scope, enable/disable, refresh/update, and diagnose an extension.
- Distinguish clearly between MindsHub/team, user, project, and engine-native ownership without flooding each row with metadata.
- Preserve the four primary permission choices. Add **Advanced permissions** inside the open picker/settings, not as permanent composer clutter.
- Advanced rules support command patterns, read/write paths, external directories, network hosts, tools/connectors, and per-agent overrides where the engine can enforce them.
- Show effective permission and extension capability for the selected engine; never imply a rule is enforced when it is not.

### Engineering scope

- Normalized extension inventory, scope, lifecycle, health, source, version, and capability contracts.
- A Codex configuration translator with safe backup/rollback behind an agent-neutral extension contract.
- Transactional enable/disable/update where configuration files are changed.
- Normalized policy model with capability-aware compilation into each engine.
- Product-layer enforcement for operations controlled by MindsHub itself, regardless of engine.
- Effective-policy evaluator and explanation output for approvals/denials.

### Reviewable delivery slices

1. Read-only normalized inventory across Codex and existing team skills.
2. Extension detail/health/source UX and scope model.
3. Safe enable/disable/update for one extension class at a time, starting with MCP and skills.
4. Primary permission presets expressed as normalized policy.
5. Advanced policy editor and effective-policy explanation.
6. Codex policy compilation, unsupported-rule handling, and rollback.
7. Security review, configuration-corruption recovery, and UX refinement.

### Acceptance criteria

- A user can tell what is installed, where it came from, which projects/engines can use it, and whether it is healthy.
- Extension changes cannot corrupt existing engine configuration; failed writes restore the prior state.
- The same primary permission picker remains compact and understandable.
- Advanced rules are testable before saving and display their effective engine support.
- A denied path/host/command cannot be reached through a child agent, preview interaction, terminal helper, or alternate engine path.
- A future engine cannot silently weaken an explicitly saved policy; unsupported rules must block or require an explicit compatible adjustment before that engine is exposed.

### Milestone demo

Inspect a team skill and a Codex-native extension, enable a project-scoped MCP server, set a command/path/network policy, and show consistent enforcement and useful denial explanations.

### `/goal` execution seed

> Execute M8 from `docs/code-mode-best-in-class-delivery-plan.md` for the current Codex-only product. Build a unified, safe Extensions experience and advanced capability-aware permission policies while preserving the compact four-mode picker and agent-neutral contracts. Implement transactional configuration, honest enforcement, rollback, child-work coverage, and all security, UX, and A-quality gates. Do not add another selectable coding agent.

## M9 — Activity, Notifications, and Best-in-Class Polish

### Outcome

Make many concurrent tasks calm to manage and complete the cross-surface usability, accessibility, performance, and design refinement needed for a best-in-class release.

### UX contract

- Add an **Activity** view that groups tasks by Running, Needs attention, Failed, Completed unread, and Recent.
- Surface waiting approvals/questions, child-worker attention, process failures, PR checks, and review requests without requiring the user to open every task.
- Native notifications are optional and configurable by event type; clicking one opens the exact task and context.
- Sidebar status remains concise and agrees with Activity state.
- Add task/session mechanics with clear user value: rename, archive, duplicate/fork where safely supported, and export a portable human-readable task record without secrets.
- Complete visual and interaction polish across Files, Preview, Review, Work, Terminal, Projects, Connectors, Skills, and task composition.

### Engineering scope

- One derived attention-state model shared by sidebar, Activity, notifications, and task header.
- Durable unread state and exact-context deep links.
- OS notification bridge and per-event settings.
- Bounded task export with optional events/diffs and automatic secret redaction.
- Final performance profiling, accessibility audit, failure-state consistency, and design-system consolidation.
- Remove superseded feature flags, dead paths, duplicate adapters, and temporary compatibility code only after supported upgrade windows are proven.

### Reviewable delivery slices

1. Derived attention model and state-reconciliation tests.
2. Activity view with filters, grouping, and navigation.
3. Native notifications and settings.
4. Rename/archive/fork-or-duplicate/export mechanics according to engine capability.
5. Cross-surface accessibility and keyboard pass.
6. Long-task/many-task performance hardening.
7. Final visual-cohesion pass and removal of proven-obsolete compatibility code.
8. Full release candidate verification and evidence package.

### Acceptance criteria

- A user managing at least ten tasks can immediately find everything requiring attention.
- Sidebar, task header, Activity view, and notifications never disagree about actionable state.
- Notification clicks open the exact approval/question/failure/review context.
- Disabling a notification category is respected immediately.
- Exported task records are useful for review and contain no credentials or secret environment values.
- All primary Code Mode journeys are keyboard operable and pass the agreed accessibility checks.
- Long-running and many-task responsiveness budgets pass under realistic host load.
- The final thermo-nuclear review is **A or better across the complete Code Mode implementation**, not just M9's diff.

### Milestone demo

Run several concurrent tasks, resolve an approval from Activity, open a failed background process from a native notification, inspect a completed unread task, archive/export it, and show the polished full journey in dark and light modes.

### `/goal` execution seed

> Execute M9 from `docs/code-mode-best-in-class-delivery-plan.md` after M1–M8. Deliver unified attention state, Activity, native notifications, valuable session mechanics, and final cross-surface performance/accessibility/design polish. Verify the complete Code Mode product under load on macOS and Windows and achieve an A-or-better thermo-nuclear review of the entire implementation.

## 9. Starting implementation map

This is a navigation aid, not permission to extend the nearest large file. Each milestone must confirm the current implementation and extract appropriate domain boundaries before adding substantial behavior.

### `cowork` renderer and desktop shell

| Current area | Starting point | Expected direction |
|---|---|---|
| Code task composition/orchestration | `src/renderer/cowork/code/CodeView.tsx`, `NewTaskPanel.tsx`, `CodeComposer.tsx` | Keep view orchestration thin; move Files/Preview/Review/Work domain state into dedicated modules |
| Timeline and activity | `src/renderer/cowork/code/EventTimeline.tsx` and related activity components | Consume normalized bounded events; do not turn the timeline into the UI for every new domain |
| Existing review/delivery | `src/renderer/cowork/code/ReviewPanel.tsx`, `DraftPullRequestSection.tsx`, `DeliveryAutomationMonitor.tsx` | Reuse one repository/diff/review state model across local and GitHub delivery |
| Terminal | `src/renderer/cowork/code/TaskTerminal.tsx` | Preserve the established multi-tab terminal and share process primitives rather than merging terminal and project-action UX |
| Runtime controls | `src/renderer/cowork/code/RuntimeControlsModal.tsx` | Drive engine differences through capability/policy selectors |
| Skills/extensions | `src/renderer/cowork/code/CodeSkillsView.tsx`, `SkillDetailModal.tsx`, `ExtensionsModal.tsx` | Evolve inventory into normalized management without weakening the first-class Skills experience |
| Projects/connectors | `src/renderer/cowork/code/CodeProjectsView.tsx`, `ProjectSettingsModal.tsx`, `CodeConnectorsView.tsx` | Add environment/actions progressively; keep account authentication shared with Cowork |
| Privileged desktop access | `src/renderer/platform/host.ts`, main-process IPC/preload modules | Continue the existing platform boundary; never access Electron bridges directly from Cowork renderer modules |

### `cowork-server` coding domain

| Current area | Starting point | Expected direction |
|---|---|---|
| Engine contracts and sessions | `cowork/coding/contracts.py` | Versioned product capabilities/events; no engine SDK types in public APIs |
| Engine registration | `cowork/coding/engines/registry.py` and engine modules | Codex-only delivery behind a versioned, future-compatible contract |
| Projects | `cowork/coding/project_models.py` and project API/service modules | Additive resource/action/environment configuration with migration coverage |
| Isolated workspaces/handoff | `cowork/coding/project_workspaces.py`, `project_tasks.py` | Extend existing multi-repository truth rather than creating a second worktree lifecycle |
| PR/CI delivery | `cowork/coding/delivery_automation.py` and integration modules | Consume normalized review/repository state and preserve existing automation behavior |
| Skills | `cowork/coding/skill_library.py` and built-in/team skill modules | Remain the normalized team layer above engine-native skills |
| GitHub/Linear | `cowork/coding/integrations.py` and related routes/services | Preserve one connected-account model; no new Code-only credential store |
| Shell/process support | `cowork/coding/shells.py` and task-terminal services | Share low-level cross-platform process primitives while keeping interactive terminals and managed project actions separate |

Before each milestone, use repository search to confirm renamed/moved modules and list the actual affected files in the milestone evidence. This plan intentionally avoids prescribing class/function names that would encourage premature implementation.

## 10. Cross-milestone architecture map

The exact names may change after inspecting the current code, but the ownership boundaries should not.

| Domain | Product responsibility | Engine adapter responsibility | Renderer responsibility |
|---|---|---|---|
| Inference | MindsHub model catalogue, routing, entitlement, usage, and task selection | Configure the harness to consume the selected MindsHub model through its supported protocol | Reuse the Cowork model picker and show honest availability/credit state |
| Resources | Root validation, canonical identity, read/search/write rules | Translate native file references/events | Files tree, tabs, selections, references |
| Processes | Cross-platform lifecycle, ports, logs, cleanup | Report/launch engine-native processes where applicable | Run controls, process list, logs |
| Preview | Secure loopback host, viewport/screenshot actions | Translate supported computer/browser actions | Preview chrome and visual states |
| Review | Git truth, diffs, scopes, mutations, comments | Translate AI findings and engine turn boundaries | Review navigation, diffs, comments, actions |
| Work graph | Durable parent/child/background state | Translate native subagents/tasks | Work surface and attention state |
| Environments | Setup/actions/snapshots/retention | Add engine-specific setup requirements | Project settings and task status |
| Extensions | Inventory, scope, transactional config, health | Read/write native configuration | Search/detail/manage UX |
| Permissions | Product policy and enforcement ceiling | Compile native policy and report support | Simple picker plus advanced editor |
| Activity | Derived attention and unread truth | Emit normalized actionable events | Sidebar, Activity, notifications |

No renderer component should switch on `engine === "codex"` to decide product behavior. Codex branding and explicitly native diagnostics are valid exceptions; capability and state differences are not.

## 11. Data migration and compatibility strategy

- All new persisted fields begin optional with deterministic defaults.
- Server responses include schema/capability versions; clients tolerate unknown fields and event types.
- Renderer releases must continue to operate with the immediately previous compatible server while staged rollout occurs.
- For cross-repository changes, prefer this order:
  1. Server contract and storage support, unused by the current client.
  2. Server behavior behind capability/version negotiation.
  3. Renderer read-only support.
  4. Renderer mutation controls.
  5. Removal of old behavior only after the supported upgrade window and explicit verification.
- Event migrations should preserve the original durable record and derive new views where possible rather than rewriting task history destructively.
- Existing tasks with Codex-specific historical details must continue to render as contracts evolve.
- Migrations are tested from the schema currently on `staging`, not only from fresh databases.

## 12. Security and trust checklist

Every applicable milestone must demonstrate:

- Canonical root checks after symlink resolution.
- No path traversal, cross-project reads, or Windows case/drive escape.
- Atomic writes with stale-version protection.
- Preview isolation from Electron APIs, task auth, filesystem, and other previews.
- Loopback binding by default and explicit handling of external navigation.
- Complete process-tree termination and bounded logs.
- Parent permission ceilings for all child work.
- No credentials in events, exports, diagnostics, screenshots, environment summaries, or extension views.
- Transactional configuration changes with backup/rollback.
- Git mutations verify expected repository/index/worktree state.
- Destructive local operations have an actual recovery mechanism where one is promised.

## 13. Release verification matrix

Each milestone evidence file should record pass/fail/not-applicable for the following matrix.

| Dimension | Required coverage |
|---|---|
| Project shape | No project; one repository; three repositories; non-Git folder |
| Repository state | Clean; dirty; no commits; detached HEAD; branch divergence; conflict where relevant |
| Platform | Current supported macOS; current supported Windows; Git Bash/PowerShell differences where relevant |
| Task lifecycle | New; running; queued message; steering; approval; stopped; failed; completed; restored |
| Concurrency | Two tasks minimum; stress case with six tasks; child/background load where relevant |
| Scale | Long history; large repository; large diff; noisy process; binary/large file states |
| Permissions | Read only; Ask first; Workspace auto; Full access; advanced rules after M8 |
| Engine | Codex; declared unsupported capability paths; no additional agents in this programme |
| Inference | Selected MindsHub model reaches each supported harness; availability, credit, usage, and error behavior remain coherent |
| UX | Keyboard; pointer; selectable text; focus restoration; dark/light; reduced motion |
| Failure | Missing binary; auth expired; sidecar restart; engine crash; network loss; stale local state |
| Delivery | Review; validate; commit; draft PR; checks/comments; source handoff where applicable |

## 14. Milestone evidence format

For each milestone, create a concise evidence document containing:

1. Milestone and exact acceptance criteria.
2. `cowork` and `cowork-server` base/final SHAs and branch names.
3. Small delivery slices/commits and why each is independently reviewable.
4. Automated commands and results.
5. Manual journeys, platform/build used, and results.
6. Performance measurements against the budgets.
7. Screenshots/video links for normal, loading, empty, error, and recovery states.
8. Security/adversarial cases.
9. Thermo-nuclear review findings, fixes, and final grade.
10. Known limitations explicitly deferred to a later milestone.

Claims such as “works on Windows,” “restores correctly,” or “does not affect Cowork” require corresponding evidence rather than inference from code.

## 15. Converting a milestone into a `/goal` prompt

Use this pattern and replace the milestone identifier. The milestone section and common contract remain the detailed authority, keeping the prompt short enough for constrained clients.

```text
/goal Execute Milestone <M# — title> from
docs/code-mode-best-in-class-delivery-plan.md across the current cowork and
cowork-server feature branches, built cleanly on today's staging.

Treat the plan's scope, product principles, milestone UX/engineering scope,
reviewable slices, acceptance criteria, common delivery contract, security
checklist, and evidence format as binding. Inspect the current implementation
before deciding exact code changes. Keep server/client changes backwards
compatible and split the work into small reviewable commits.

Implement and self-verify the complete milestone. Test real packaged desktop
journeys, not only mocked UI; cover macOS and Windows where the feature is
platform-sensitive; preserve Cowork mode; keep all useful text copyable; avoid
IDE creep and safety theatre. Run the thermo-nuclear code-quality review on the
full changed implementation, fix its findings, and do not finish below grade A.

Do not merge or open PRs unless separately instructed. Finish with the evidence
document, exact compatible SHAs, tests and human-verification results, remaining
limitations, and a concise demo of the completed user journey.
```

## 16. Final programme definition of done

The programme is complete when:

- M0–M4 and M7–M9 acceptance criteria and evidence exist; deferred M5/M6 are not required.
- Codex can complete representative real development work through the Code Mode product model while the contracts remain suitable for future adapters.
- A multi-repository task can move from issue context to isolated implementation, preview, review, CI/PR handling, and source handoff without requiring an IDE for the agent workflow.
- Every unsupported Codex capability is handled through explicit capability negotiation.
- macOS and Windows release journeys have been verified from fresh installs and restored existing state.
- Performance budgets hold under long histories and concurrent tasks.
- Cowork mode remains stable and coherent with the shared application shell.
- The complete Code Mode implementation receives an A-or-better thermo-nuclear review with no unresolved high-severity issues.

At that point MindsHub Code Mode should not merely match individual competitor checklists. It should combine a best-in-class local agent workstation with a multi-repository, team-workflow system that the competing desktop products do not currently integrate as deeply.
