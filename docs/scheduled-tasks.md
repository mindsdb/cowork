# Scheduled Tasks — Phase 1: Local Hardening, Parity & the Execution Seam

**Owner:** [Paul Newsam](mailto:paul@mindsdb.com) · **Status:** Draft · **Target:** ~9–13 weeks through M4 (real task definition); M5 (evals) and M6 (UI) additional, not yet sized in detail
**Linear:** [ENG-703](https://linear.app/mindsdb/issue/ENG-703) (parent) · [ENG-768](https://linear.app/mindsdb/issue/ENG-768) (cleanup)
**Companion doc:** *Phase 2* — local `scheduled-tasks-cloud.md` / [gdoc, tab "Scheduled Tasks P2"](https://docs.google.com/document/d/1h_G64EiLJkGjz-6UXl6KG3tBmNkyUvp4jj2otBvEm9M/edit) — M7, gated on the SaaS effort.
**Engineering detail:** local `scheduled-tasks-technical-plan-v2.md` only — not yet mirrored to Docs (see Supporting Material). This doc is the readable overview; that one has the implementation-level detail this doc intentionally doesn't repeat.
**Milestone lettering matches Linear directly** (M1, M2, M3a/M3b, M4, M5, M6 — see §5). Previous drafts of this doc used a different, non-matching lettering; that's now reconciled.
**Last updated:** 2026-07-20

---

## 1. Why

Today's scheduler is a 30-second poll loop in the app's server process: it dies when the app closes, hot-retries failures with no backoff (already caused a Slack-spamming incident), and has no audit trail. That's not fit for unsupervised use.

The compute-must-be-on constraint isn't going away soon, so Phase 1 makes that constraint safe: reliable retries, one run per occurrence, an explicit missed-run policy, an audit trail, and a trigger/executor split so a future remote executor is additive, not a rewrite. This is a competitive gap, not a lead — Claude Cowork and ChatGPT are already cloud-primary by default (Competitive Analysis) — but this team doesn't own the remote infrastructure, so local-first is still correct; get SaaS sign-off on the interface early (M2), rather than waiting until the end.

## 2. Scope

**In:** retry/backoff + idempotency + missed-run policy + auto-pause + audit trail + fire-time stagger + keep-awake (M1) · a serializable trigger/executor interface, proven via a conformance double (M2) · unattended credentials, server-side OAuth refresh (M3a) · OS-level trigger, launchd/Task Scheduler (M3b) · persisted connector/skill allow-lists, artifact output target, webhook trigger, agent-facing create/edit tool (M4) · lightweight per-run output checks (M5) · a UI that matches the new engine (M6).

**Out:** the cloud execution plane itself, mobile/web, cross-surface UI (all → Phase 2) · deterministic artifact refresh with no agent turn (stays on ENG-780's Lambda substrate).

## 3. Architecture

Split *when* a task fires (**Trigger**) from *where/how* it runs (**Executor**), joined by one idempotent entrypoint, `run-schedule <id> --occurrence <ts>`, that owns dedup, retries, settlement, recording, and notification.

```python
class Trigger(Protocol):
    """Decides WHEN. Never executes, never writes run rows, never retries."""
    async def register(self, schedule: Schedule) -> None: ...
    async def unregister(self, schedule_id: str) -> None: ...
    async def reconcile(self, desired: Sequence[Schedule]) -> None: ...

class Executor(Protocol):
    """Runs the task — exactly one attempt per call; never retries or reschedules."""
    async def run(self, spec: ResolvedSpec, ctx: RunContext) -> RunOutcome: ...
```

`LocalPollDriver` (M1) is the first `Trigger` implementation; M2 proves this same interface survives a remote executor, via a conformance double, before anything else is built on top of it. `LaunchdDriver`/`TaskSchedulerDriver` (M3b) are the second and third `Trigger` implementations, plugging into the interface M2 already proved. `LocalExecutor` is today's only `Executor` — a remote executor (Phase 2, M7) implements the same protocol later. The schedule row stays the single editable object; each run snapshots a resolved spec rather than creating a new entity.

## 4. User stories (acceptance shape)

- **US-1, reliability:** recurring Linear→Slack digest. Fires on cadence, touches only its granted connectors, and a catch-up after an outage posts once per occurrence, never once per missed occurrence.
- **US-2, conversational management:** create/edit/pause a schedule from chat — and from *within* its own unattended run, not just live chat, so a task can reschedule itself without a user present. Artifact output updates in place; several runs a day still produce exactly one run per occurrence.
- **US-3, visible failure:** a failing occurrence backs off to a terminal state and auto-pauses with a notification, never hot-retries; a missed occurrence follows an explicit policy, never silently dropped.

## 5. Milestones

| Milestone | Outcome | Target |
| :---- | :---- | :---- |
| M1 — Dependable + audible (ENG-778) | Backs off + auto-pauses on repeated failure instead of hot-retrying; every run audited | ~4 wks |
| M2 — Trigger/executor split + conformance proof (ENG-777) | `run_occurrence` engine separates when a task fires from how it runs; the same logic is callable by the in-app timer, the OS scheduler (M3b), and later a remote executor (M7) — proven via a conformance double, no live cloud needed | ~3 wks after M1 |
| M3a — Unattended credentials (ENG-828) | Server-side OAuth refresh grant (macOS + Windows); headless runs authenticate with the app closed | parallel with M3b |
| M3b — OS drivers (ENG-779) | Fires via OS-level trigger (launchd/Task Scheduler) even when Cowork isn't running; one run identity per occurrence regardless of trigger | parallel with M3a, both after M2 |
| M4 — Real task definition (ENG-829) | Allow-lists persisted/enforced, artifact output target, webhook trigger, agent create/edit tool (top priority) | ~5–9 wks |
| M5 — Per-run output checks (ENG-830) | Lightweight, alert-only pass/fail judgment per run against a rubric; notifies but never auto-pauses | after M4 |
| M6 — UI (ENG-782) | Builder, trust-at-a-glance task states, run history, and notifications match the new engine | after M4/M5 |

M1 → M2 → (M3a ∥ M3b) → M4 → M5 → M6. M2 needs the SaaS team's sign-off on the interface, not their infrastructure — get it here, not at the end. Everything past M6 (a live remote executor, cross-surface visibility) is Phase 2's M7.

## 6. Parity gaps vs. Claude Code Desktop

The local-parity target is Claude Code Desktop's scheduled tasks, not Claude Cowork (which is cloud-primary by default). Gaps this plan doesn't yet close:

- **Minimum fire interval** undecided (theirs: 1 min) — decide before M4.
- **Missed-run lookback bound** undecided (theirs: 7-day window; `run-latest-once` itself is already decided) — adopt their default, needed before M1.
- **Fire-time stagger** and **keep-computer-awake** are named in scope (§2) but need explicit M1/M3b deliverable lines, not just a mention.
- **Verify:** is their "survives app closed" a true OS-level trigger, or a resident background/menu-bar process? If the latter, our launchd/Task Scheduler approach (M3b) exceeds rather than merely matches parity.

Already handled or deliberately different, not gaps: connector/skill scoping (M4), and the permission model (we use a declared-upfront allow-list instead of their approve-once-then-remember, deliberately, for safety on unattended restarts).

## 7. Open before work starts

- Which recurrence forms ship first, and the overlap policy — *Product*.
- Default missed-run policy (leaning run-latest-once) — *Product/Eng, before M1*.
- Unattended destructive-action stance (leaning deny-and-record) — *Product, before M4*.
- Refresh-token storage: OS credential store vs. vault file — *Eng, resolved by the M3a spike*.
- Where the line falls between this seam and the SaaS effort — *Paul, raise with SaaS now, not at M2's exit*.
- Whether per-org SaaS instances will actually host `cowork-server` — *SaaS team, needed by M2 exit; if no, the executor interface becomes the whole integration surface (Phase 2's problem)*.

Implementation-level risks (SQLite coexistence, Windows logon-type tradeoffs, OAuth-refresh mechanics) are tracked in the v2 technical plan, not duplicated here.

---

## Supporting Material

- Competitive Analysis — local `scheduled-tasks-competitive-analysis.md` / [gdoc, tab "Paul - Competitive Analysis"](https://docs.google.com/document/d/1U6SJ6tv54qWqSpKPN9UMlCBEFSjhZ8_WC2z4PUVJ404/edit)
- Feature Brief / Cleanup Plan / Driver Abstraction — same [gdoc](https://docs.google.com/document/d/1U6SJ6tv54qWqSpKPN9UMlCBEFSjhZ8_WC2z4PUVJ404/edit), tabs "Ian - Feature Brief" / "Paul - Cleanup Plan" / "Jorge - Driver Abstraction"
- Technical Plan v2 — local `scheduled-tasks-technical-plan-v2.md` only; **not present as a tab in either gdoc yet**, implementation detail + Appendix A interface sketch
- Phase 2 companion — local `scheduled-tasks-cloud.md` / [gdoc, tab "Scheduled Tasks P2"](https://docs.google.com/document/d/1h_G64EiLJkGjz-6UXl6KG3tBmNkyUvp4jj2otBvEm9M/edit)
- Linear: ENG-703 (parent) · ENG-778 (M1) · ENG-777 (M2) · ENG-828 (M3a) · ENG-779 (M3b) · ENG-829 (M4) · ENG-830 (M5) · ENG-782 (M6) · ENG-925 (M7, Phase 2). ENG-768 (cleanup, separate parent) is fully reconciled: S2/S3/S4/S6 canceled and absorbed into the M1–M6 tickets above; S1/S5/S7 shipped (Passed QA); S8 folded into ENG-776 (verification suite).
