# Code Mode Resource and Execution UX Coverage

This is the rendering and interaction contract for the control-plane evolution of Code Mode. It keeps infrastructure concepts behind familiar product language and preserves the existing Cowork visual system.

## Product thesis

Code Mode should feel like one continuous coding workspace. Users choose what the agent can work on and, only when it matters, where it runs. Repository portability and computer availability are explained at the point of decision rather than exposed as a separate infrastructure dashboard.

Rejected direction: a persistent runtime or fleet-management surface. It would promote implementation details over the user's task and make the local-first product feel administrative.

## Primary surfaces

### Projects

- Empty project: clear first action to add a repository or local folder.
- Repository resource:
  - local checkout with portable remote source;
  - local checkout without a remote source;
  - remote source with no checkout on this computer;
  - default branch shown only when useful.
- Local folder resource:
  - available on this computer;
  - bound to a different online computer;
  - bound to an offline computer.
- Mixed multi-resource project: rows remain compact and scannable.
- Add, remove, reorder, duplicate, unavailable, loading, and error states.
- Execution settings are progressively disclosed and do not permanently assign a project to a computer.

### New task

- No project with a local folder.
- Project with one resource: all resources implied; no redundant scope control.
- Project with multiple resources:
  - all resources selected by default;
  - user narrows to a valid subset;
  - user restores all resources.
- Execution availability:
  - one eligible computer: selected automatically and hidden;
  - multiple eligible computers: compact computer picker appears;
  - no eligible computer because a required local folder is offline;
  - no eligible computer because all runtimes are offline;
  - loading and retryable error states.
- Starting, disabled, and validation states do not move the composer.

### Running task

- Preparing workspace, queued, running, awaiting approval, reconnecting, completed, failed, and cancelled.
- Computer name is secondary metadata, not the page title.
- A stale or offline runtime produces a concise recovery action.
- Steering, queued follow-ups, approvals, terminal tabs, review, diffs, delivery, GitHub/Linear context, and skills remain available.

## Responsive and theme matrix

- Dark and light themes.
- Standard desktop at 1440 x 900.
- Compact desktop at 1100 x 720.
- Sidebar open and collapsed.
- Long project, resource, computer, branch, and Windows path names truncate without hiding the differentiating detail.
- Menus stay within the viewport and preserve keyboard navigation and visible focus.

## Verification duties

- Render and inspect Projects and New Task in both themes.
- Exercise all-resource and subset-resource task creation.
- Exercise automatic selection, explicit selection, and no-eligible-computer states.
- Verify a remote repository-only run and an owner-bound local-folder run.
- Verify no-project local execution remains intact.
- Confirm labels say repository, folder, computer, and task; avoid control-plane, lease, fencing, or execution-plane jargon.

## Verified implementation evidence

- Dark and light desktop renders were inspected in the live Electron app for New Task, Project Settings, owner-bound local folders, and running remote tasks.
- Single-resource local-folder projects suppress redundant resource/computer controls; multi-resource projects show compact scope and computer controls without moving the composer.
- Menus are mutually exclusive, dismiss on outside click and Escape, and do not overlap one another.
- Local concurrent all-resource/subset-resource runs, no-project folder runs, repeated remote turns, approvals, steering, cancellation, multiple terminals, Git operations, and workspace release were exercised end to end.
- An expired lease becomes **Ready to resume** with a direct Restore action; stale-epoch events are rejected.
- Repository-only remote execution and an owner-bound local-folder constraint were both exercised; remote tasks never expose the local-only “Apply to source” action.
- Multi-repository delivery produced one independent result per repository, including clear per-repository failure when GitHub was intentionally unavailable.
- GitHub/Linear grants were verified as short-lived, exact-resource scoped, revocable, and persisted only as token hashes.
