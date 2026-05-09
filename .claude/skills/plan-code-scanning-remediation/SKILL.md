---
name: plan-code-scanning-remediation
description: plan safe, idempotent remediation work for GitHub code scanning alerts (CodeQL, SAST). use when asked to triage CodeQL alerts, code scanning findings, fix SAST issues, or group code scanning vulnerabilities into remediation PR plans before changing code. for dependency vulnerabilities (CVEs, Dependabot, npm audit), use plan-vulnerability-remediation instead.
---

# Plan Code Scanning Remediation

## Overview

Create an actionable, idempotent remediation plan for **code scanning alerts** (CodeQL, SAST tools) before making changes. The plan fetches open alerts from GitHub's code scanning API, reads the flagged source code to assess each finding, groups related findings into coherent PR-scoped units, and emits remediation plans ready for `remediate-code-scanning`.

This skill is designed to pair with the `remediate-code-scanning` skill. Use this skill first when the user asks to triage, plan, batch, or group code scanning fixes. Use `remediate-code-scanning` when it is time to implement one plan and open or update a PR.

For **dependency vulnerabilities** (CVEs, Dependabot, audit findings), use `plan-vulnerability-remediation` instead.

## Goals

- Be idempotent: rerunning should not create duplicate branches or PRs for the same alert set.
- Prefer the smallest safe code change that resolves the alert.
- Group alerts only when doing so creates one coherent, reviewable PR.
- Detect existing remediation PRs before starting new work.
- Produce enough structured information for an automated loop to process one plan at a time.
- Track longer-running remediation progress in a repository-local markdown file.

## Inputs

Accept code scanning findings from any of these sources:

- **GitHub code scanning alerts** via `gh api repos/{owner}/{repo}/code-scanning/alerts`.
- User-provided alert numbers, rule IDs, or file paths.
- Security tracking issues or files in the repository.

Each finding should be normalized to these fields when possible:

- `alert_number`: GitHub code scanning alert number.
- `rule_id`: CodeQL rule identifier, e.g. `py/path-injection`, `js/xss-through-dom`, `actions/missing-workflow-permissions`.
- `rule_description`: human-readable rule name.
- `severity`: security severity level (critical, high, medium, low).
- `tool`: scanner name, typically `CodeQL`.
- `file_path`: source file containing the vulnerability.
- `start_line` / `end_line`: line range of the vulnerable code.
- `message`: CodeQL's description of the specific instance.
- `html_url`: link to the alert on GitHub.

## Safety rules

- Do not change source code, workflow files, or branches in this planning skill unless the user explicitly asks you to proceed with remediation.
- It is acceptable to create or update the progress tracker at `docs/tmp/code-scanning-remediation.md` when planning a longer-running or automated remediation run.
- Treat code scanning output as advisory, not absolute truth. Read the flagged source code to verify each finding before planning a fix.
- Do not group unrelated files or rule families into one PR unless the user explicitly requests broad batching.
- Do not expose secrets from scanner output or CI logs.
- Prefer read-only commands until the plan is accepted.

## Workflow

### 1. Establish repository context

Identify the repository root and structure:

```bash
git status --short --branch
git remote -v
git branch --show-current
```

Determine:

- Base branch (`main`, `master`, or repository default from `gh repo view --json defaultBranchRef` when available).
- Source language(s) and frameworks in use.
- GitHub Actions workflow files present.

### 2. Gather code scanning alerts

Verify `gh` is available and authenticated:

```bash
gh --version
gh auth status
```

List open code scanning alerts:

```bash
gh api "repos/{owner}/{repo}/code-scanning/alerts?state=open&per_page=100" --paginate --jq '.[] | {number, rule_id: .rule.id, rule_description: .rule.description, severity: .rule.security_severity_level, tool: .tool.name, state, file_path: .most_recent_instance.location.path, start_line: .most_recent_instance.location.start_line, end_line: .most_recent_instance.location.end_line, message: .most_recent_instance.message.text, html_url}'
```

For detailed context on a specific alert:

```bash
gh api "repos/{owner}/{repo}/code-scanning/alerts/{alert_number}" --jq '{number, rule: .rule, most_recent_instance: .most_recent_instance, html_url}'
```

### 3. Check whether each finding is already resolved locally

For each alert:

1. Read the source file at the flagged line range to understand the current code.
2. Determine whether the vulnerable pattern has already been fixed (e.g. path validation added, error handling changed, permissions set).
3. If the code no longer matches the vulnerable pattern, mark as `already-fixed-locally` — the alert may be stale and will auto-close on the next CodeQL scan after merge.
4. If the code still exhibits the vulnerability, it needs remediation.
5. Check the alert's `state` via the API — if it shows `fixed` or `dismissed`, mark accordingly.

### 4. Check for existing open PRs that already address findings

Before proposing a new remediation PR, search open PRs:

```bash
gh pr list --state open --limit 100 --json number,title,headRefName,baseRefName,body,labels,url,updatedAt
```

For each finding or candidate group, look for:

- Alert numbers or rule IDs in title, body, branch name, or labels.
- Affected file paths in the PR diff.
- Branch names created by this automation using the convention `security/codeql-<slug>`.

Inspect likely PRs before deciding they match:

```bash
gh pr view <number> --json number,title,body,headRefName,baseRefName,state,mergeable,url
gh pr diff <number> --name-only
```

A PR counts as already addressing a finding only if its diff modifies the flagged code in a way that eliminates the vulnerable pattern. If uncertain, classify as `possibly-covered-by-pr` rather than creating a duplicate.

### 5. Group findings into remediation units

Create candidate remediation groups. Group findings when all or most of these are true:

- Same rule ID across the same file or closely related files (e.g. all `py/path-injection` in `server/routes/utilities.py`).
- Same rule family in the same directory (e.g. all `py/stack-trace-exposure` across `server/routes/*.py`).
- Same file with multiple related rules that share a common fix pattern (e.g. both path injection and stack trace exposure in one route file, if the fix is cohesive).
- All `actions/missing-workflow-permissions` alerts across workflow files can be grouped into one PR since the fix pattern is uniform (adding `permissions:` blocks).

Do not group findings when any of these are true unless explicitly requested:

- Different languages or unrelated directories.
- Unrelated rule families (e.g. a Python path injection fix and a JS XSS fix).
- Fixes that touch unrelated application logic.
- Combining would make review or rollback unclear.

Group priority:

1. Critical and high severity alerts.
2. Alerts with clear, well-understood fix patterns.
3. Multiple alerts resolved by one cohesive code change.
4. Alerts already covered by existing PRs should be marked and excluded from new work.

### 6. Define a remediation plan for each group

For every proposed group, include:

- `group_id`: stable slug, e.g. `codeql-py-path-injection-server-routes` or `codeql-actions-permissions`.
- `alert_numbers`: GitHub code scanning alert numbers included.
- `rule_ids`: CodeQL rule IDs in this group.
- `affected_files`: file paths and line ranges.
- `branch_name`: stable and deterministic, e.g. `security/codeql-py-path-injection-server-routes`.
- `pr_title`: e.g. `fix(security): resolve CodeQL path injection alerts in server routes`.
- `remediation_strategy`: one of `code-fix`, `workflow-permissions-fix`, `config-fix`, or `needs-investigation`.
- `code_changes`: description of the source code changes needed for each alert.
- `verification`: note that CodeQL will re-scan on push; optionally include test commands.
- `existing_pr`: PR URL or number if already covered.
- `risk_notes`: behavioral changes, edge cases, or uncertainty.
- `automation_status`: one of `ready`, `in-progress`, `pr-opened`, `covered-by-existing-pr`, `already-fixed-locally`, `needs-user-input`, `needs-verification`, `blocked`, or `done`.
- `progress_notes`: concise notes about decisions, blockers, or verification gaps.

### 7. Create or update the progress tracker

For longer-running tasks, automated loops, or when the user asks for persistent tracking, create or update:

```text
docs/tmp/code-scanning-remediation.md
```

If `docs/tmp` does not exist, create it. This file is the handoff mechanism between `plan-code-scanning-remediation` and `remediate-code-scanning`.

Use this structure:

```markdown
# Code Scanning Remediation Tracker

## Run metadata

- Started: <date/time if known>
- Repository: <owner/repo or remote URL>
- Base branch: <base branch>
- Sources: <GitHub code scanning alerts>
- Tracker version: 1

## Status summary

- Ready: <count>
- In progress: <count>
- PR opened: <count>
- Covered by existing PR: <count>
- Already fixed locally: <count>
- Needs input: <count>
- Blocked: <count>
- Done: <count>

## Remediation queue

### <group_id>

- Status: ready
- Branch: security/<group_id>
- PR: <none or URL>
- Alerts: <alert numbers>
- Rule IDs: <CodeQL rule IDs>
- Affected files: <file paths and line ranges>
- Strategy: <code-fix/workflow-permissions-fix/config-fix>
- Code changes:
  - <description of source code changes needed per alert>
- Verification:
  - <test commands or "CodeQL re-scan on push">
- Risk notes: <notes>
- Progress notes:
  - <timestamp or date> — planned remediation group
```

Keep each group under a stable `### <group_id>` heading. Preserve existing notes and append new progress notes.

### 8. Handoff contract for `remediate-code-scanning`

Two supported handoff modes:

1. **Conversation handoff** — output a full group plan in the response, then invoke `remediate-code-scanning`.
2. **Tracker-file handoff** — write the plan into `docs/tmp/code-scanning-remediation.md`; `remediate-code-scanning` reads the next `Status: ready` group.

For automated work, prefer tracker-file handoff. `remediate-code-scanning` should process exactly one `ready` group per invocation.

### 9. Output an automation-friendly summary

End with a concise queue:

```text
READY:
1. <group_id> — <branch_name> — <short remediation summary>

SKIP:
1. alert #<number> — already fixed locally
2. alert #<number> — covered by <PR URL>

NEEDS INPUT:
1. <group_id> — reason
```

## Idempotency contract

Preserve idempotency by using:

- Stable `group_id` values derived from rule IDs, file paths, and alert numbers.
- Stable branch names derived from `group_id`.
- PR bodies containing a machine-readable marker:

```text
<!-- code-scanning-remediation: group_id=<group_id>; alerts=<comma-separated numbers>; rules=<comma-separated rule IDs> -->
```

On rerun, search for this marker in open PR bodies before creating any new plan.

## Final response

Report:

- Number of alerts examined.
- Path to the progress tracker if created or updated.
- Alerts already fixed locally.
- Alerts covered by existing PRs.
- Proposed remediation groups ready for implementation.
- Alerts that need user input or investigation.
- The next `group_id` that `remediate-code-scanning` should process, if any.
- Recommended next command or skill invocation.
