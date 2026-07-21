# Scheduled Tasks — Phase 2: Cloud Execution & Cross-Surface

**Owner:** [Paul Newsam](mailto:paul@mindsdb.com) · **Status:** Draft, directional · **Target:** Not yet scheduled — paced to the multi-tenant SaaS effort's timeline
**Linear:** [ENG-703](https://linear.app/mindsdb/issue/ENG-703) (parent). This phase's milestone is **M7 — [ENG-925](https://linear.app/mindsdb/issue/ENG-925)**, created 2026-07-20. ENG-830 ("M5") and ENG-782 ("M6") are unrelated tickets that belong to Phase 1 (evals and UI, respectively) — the milestone lettering across both docs and Linear is now fully reconciled; see the Phase 1 doc's §5 and Supporting Material.
**Companion doc:** *Phase 1* — local `scheduled-tasks.md` / [gdoc, tab "Scheduled Tasks P1"](https://docs.google.com/document/d/1h_G64EiLJkGjz-6UXl6KG3tBmNkyUvp4jj2otBvEm9M/edit). Phase 2 assumes Phase 1's M2 conformance double is green and the SaaS team has signed off on the `Trigger`/`Executor` interface it defines.
**Last updated:** 2026-07-20 — split out of the single-doc plan; milestone renumbered M5 → M7 to stop colliding with ENG-830.

---

## 1. Context

Phase 1 builds and proves a seam: `Trigger` decides *when*, `Executor` decides *where/how*, and a headless `run-schedule <id> --occurrence <ts>` joins them. It does this entirely with local implementations — a poll loop, then OS-level drivers, then a conformance double standing in for a remote executor. None of that requires the multi-tenant SaaS effort to exist.

Phase 2 begins once it does. The SaaS team's current direction, **Topology A**, is a per-org instance running `cowork-server` (or an equivalent) that's always on: "a desktop that never sleeps." Per Phase 1's design, that instance consumes the local engine wholesale, reusing `LocalPollDriver` and `LocalExecutor` as-is, and swaps only the credential layer — the multi-tenant vault implements the same `DataVault` protocol `LocalDataVault` does today. Because it never sleeps, it also never needs Phase 1's OS-level drivers (launchd, Task Scheduler); those exist specifically to compensate for a process that dies when a laptop closes, which a per-org instance doesn't do by design.

This phase is scoped to what happens once that instance exists: connecting it, making schedules visible across surfaces, and being honest about the reliability ceiling that topology actually delivers versus what a fully robust architecture would.

## 2. Scope — M7: Cross-surface visibility

**Included**

* Attaching the per-org instance as a live `Executor` (and, if needed, `Trigger`) implementation behind Phase 1's interfaces — no redefinition of the spec, per the M2 conformance proof.
* A schedule created on any surface — desktop, web, or the future mobile app — becomes visible and manageable from the others, since all three read and write the same per-org backend rather than a device-local store.
* Local-only resources (a specific folder, a local MCP server, a signed-in local browser profile) continue to route through the desktop app as a bridge when the remote executor needs them, matching the pattern Claude Cowork's own architecture already uses for the same problem.
* Wiring the multi-tenant vault's unattended OAuth refresh in as the live `DataVault` implementation, once the SaaS team ships it.

**Not included**

* Anything in §5 below. That's vision, not committed scope, until the open questions in §6 resolve.
* Rebuilding or redesigning the `Trigger`/`Executor` interfaces themselves. If Phase 1's M2 conformance proof holds, this phase only adds implementations, it doesn't change the contract.

## 3. What Topology A buys this phase for free

"Guaranteed to fire regardless of which surface it was scheduled from" mostly falls out of Topology A directly, rather than requiring separate cross-surface engineering. Once the per-org instance is the source of truth, a schedule's existence and next-fire-time stop being tied to any specific device the instant the create-call lands on that backend — desktop, web, and mobile are just three clients of the same account-scoped API. The cross-surface story here is closer to "make sure all three surfaces point at the same backend" than "build a synchronization layer," provided none of them are also allowed to write to a device-local store as a fallback.

## 4. The reliability ceiling of Topology A — named explicitly

Topology A is a real improvement over today, laptop-closed no longer breaks anything, but it is not the most robust architecture available, and this document shouldn't let that read as settled. A per-org instance is still one process per organization: if it crashes, gets redeployed, or is evicted from its node, that org's schedules stop firing until reconciliation-on-boot catches up. That's a bounded gap (Phase 1's orphan-reap-on-boot logic bounds it), not a zero one. It's also not elastic — one org's scheduled-task load is capped by that one instance's capacity, with no horizontal scale-out within an org.

This is a deliberate, reasonable tradeoff for this stage: it avoids this team duplicating the SaaS team's build, and Phase 1's contract rules (self-contained serializable spec, engine-as-library, credentials only through `DataVault`, UTC/IANA discipline, notification as a sink) keep the door open to something stronger later without a rewrite. But "stronger later" is a real gap today, not a hypothetical, and should be tracked as one rather than assumed away.

## 5. Vision — the fully robust architecture (not yet scoped)

If "a schedule will always run reliably" ever needs to mean SLA-grade rather than "meaningfully better than a laptop," here's the shape that gets there. None of this is scheduled; it's recorded so the option isn't lost and so a future phase doesn't have to re-derive it.

* **A horizontally redundant trigger**, not a single per-org poll loop: a fleet of scheduler workers claiming due schedules via a lease (`SELECT ... FOR UPDATE SKIP LOCKED` or equivalent), or a managed equivalent like AWS EventBridge Scheduler or a Temporal-style timer service. No single node's downtime causes a missed fire.
* **An elastic, multi-tenant executor pool** for anything that can run against cloud-reachable resources, rather than one instance's fixed capacity per org.
* **Idempotency at the side-effect boundary, not just the run-row boundary.** Occurrence-keyed dedup on the run row (Phase 1, already designed) doesn't guarantee the Slack post itself is deduped if a crash happens between "posted" and "recorded success." Genuinely robust delivery needs an idempotency key on the connector call itself.
* **Step-level checkpointing for mixed local/cloud tasks.** This is the same idea as the differentiation opportunities already flagged in the Competitive Analysis (a portable task with per-step execution location, graceful degradation) — a task with one cloud-runnable step and one local-only step shouldn't block entirely on the local step being reachable; it should checkpoint past what it can do now and resume the rest when the device reconnects.
* **A preflight portability check**, telling a user at creation time "this task can run remotely except for X, here's the substitute," which requires a remote executor to check portability against — gated on this phase existing at all.
* **Multi-AZ or otherwise replicated storage** for the schedule source of truth, so the backend itself isn't a single-region failure domain. Probably the last thing worth building, since it's the smallest marginal gain relative to effort, but it's the actual ceiling.

All of this is **Topology B** territory (a central cloud scheduler plus container/Lambda executors) — Phase 1 explicitly names it as a possible later instantiation of the same two interfaces and deliberately doesn't design its wire protocol now. Nothing above requires touching the `Trigger`/`Executor` contract; it's new implementations of it.

One thing that does **not** belong here: an EventBridge-style trigger for agent-task schedules specifically. That combination already exists in the codebase's plans, just for a different, deliberately unintegrated substrate — ENG-780's artifact refresh (`EventBridgeTrigger` + `ArtifactInvokeExecutor`), which has no standing process at all between fires. Topology A's per-org instance doesn't have that problem; building a cloud trigger for it would duplicate a working in-process poll loop to solve an availability gap that topology doesn't have. It would only become worth revisiting if the open question in §6 resolves to "Topology A collapses into B."

## 6. Open questions

| Type | Item | Direction or next step |
| :---- | :---- | :---- |
| Open question | Whether per-org instances will actually host `cowork-server` (or an equivalent embedding this engine) | Owner: SaaS team. Needed by Phase 1's M2 exit review. If no, Topology A collapses into B and the executor interface becomes the entire integration surface — this document's scope changes substantially if that happens. |
| Open question | Multi-tenant vault's unattended-refresh timeline | Owner: SaaS team. Blocks any connector-touching schedule from succeeding under Topology A regardless of how solid the scheduling side is. |
| Open question | Whether the reliability ceiling in §4 ever needs to be raised | Owner: Product. Depends on whether "this will run" ever needs to be a contractual/SLA-grade guarantee (e.g. for a paid tier) rather than a best-effort one. Not urgent; worth revisiting once Topology A has been live long enough to have an actual incident rate. |
| Dependency | Phase 1's M2 conformance proof and SaaS sign-off on the interface | This phase doesn't start meaningfully before that lands — attaching a real executor to an unproven interface risks discovering contract gaps in production instead of in CI. |

## Supporting Material

* **Phase 1** — local `scheduled-tasks.md` / [gdoc, tab "Scheduled Tasks P1"](https://docs.google.com/document/d/1h_G64EiLJkGjz-6UXl6KG3tBmNkyUvp4jj2otBvEm9M/edit). The seam this phase attaches to; M1–M6.
* **Competitive Analysis** — local `scheduled-tasks-competitive-analysis.md` / [gdoc, tab "Paul - Competitive Analysis"](https://docs.google.com/document/d/1U6SJ6tv54qWqSpKPN9UMlCBEFSjhZ8_WC2z4PUVJ404/edit). Source for the Cowork cloud-primary architecture notes in §1 and §4.
* **Technical Plan v2**, §5.12 specifically — local `scheduled-tasks-technical-plan-v2.md` only; **not present as a tab in either gdoc yet**. Original Topology A/B framing and the SaaS-consumption contract rules this doc builds on.
