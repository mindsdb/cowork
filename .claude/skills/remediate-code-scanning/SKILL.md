---
name: remediate-code-scanning
description: implement an idempotent code scanning remediation plan, apply source code fixes for CodeQL/SAST alerts, verify the fix, commit, push, and create or update a pull request. use after planning code scanning remediation or when asked to fix CodeQL alerts, path injection, XSS, stack trace exposure, workflow permissions, or other SAST findings.
---

# Remediate Code Scanning

## Overview

Implement one coherent **code scanning** remediation unit safely and idempotently. This skill takes a plan from `plan-code-scanning-remediation` or enough alert details from the user, reads the flagged source code, applies the smallest safe source code fix, verifies the result, commits, pushes a deterministic branch, and creates or updates a pull request.

The intended automation model is: take one `ready` group off the queue, run this skill, update progress, and stop after one PR is created or updated.

For **dependency vulnerabilities**, use `remediate-vulnerability` instead.

For longer-running or automated work, the queue lives in `docs/tmp/code-scanning-remediation.md`, created by `plan-code-scanning-remediation`.

## Idempotency requirements

Rerunning this skill for the same group must not create duplicate branches or PRs.

Use these stable identifiers:

- `group_id`: from the plan, or derive from rule IDs + file paths, e.g. `codeql-py-path-injection-server-routes`.
- `branch_name`: `security/<group_id>` unless the plan specifies another deterministic branch.
- PR marker in the PR body:

```text
<!-- code-scanning-remediation: group_id=<group_id>; alerts=<comma-separated numbers>; rules=<comma-separated rule IDs> -->
```

Before creating new work, search for:

- An open PR containing the marker.
- An open PR modifying the same files for the same rule IDs.
- An existing local or remote branch with the deterministic branch name.

If a matching open PR already addresses the finding, update that PR only if necessary.

## Inputs

Two supported input modes:

1. **Tracker-file input** — read `docs/tmp/code-scanning-remediation.md` and process exactly one group with `Status: ready`.
2. **Conversation input** — consume one group supplied by `plan-code-scanning-remediation` or the user.

Prefer a remediation group with:

- `group_id`
- `alert_numbers`
- `rule_ids`
- `affected_files` and line ranges
- `branch_name`
- `pr_title`
- `remediation_strategy`
- `code_changes` description
- `verification` commands
- `risk_notes`
- `alert_html_urls`: mapping of alert numbers to their GitHub URLs (for PR body links)

If no plan exists and there are multiple unrelated alerts, ask the user to run `plan-code-scanning-remediation` first.

## Safety rules

- Never run destructive git commands unless the user explicitly requests them.
- Do not commit secrets, local environment files, or unrelated user changes.
- Do not overwrite unrelated uncommitted changes.
- Avoid direct pushes to protected base branches.
- Keep PRs focused. One remediation group = one branch = one PR.
- Read the full function/handler containing the flagged lines before changing code.
- Prefer the smallest change that eliminates the vulnerability without altering intended behavior.
- Do not refactor surrounding code or add unrelated improvements.
- State clearly if verification could not be completed.

## Workflow

### 1. Load the tracker or supplied group

If `docs/tmp/code-scanning-remediation.md` exists and the user did not supply a specific group, read it and select the first group with `Status: ready`. Process exactly one group per invocation.

If using tracker-file input, update the selected group immediately:

- Change `Status: ready` to `Status: in-progress`.
- Append a progress note that remediation started.

If no tracker exists and no group is supplied, gather enough details to produce a one-group plan or ask the user to run `plan-code-scanning-remediation` first.

### 2. Confirm repository state and base branch

```bash
git status --short --branch
git branch --show-current
git remote -v
git fetch origin
gh repo view --json defaultBranchRef
```

### 3. Fetch alert URLs for PR links

If the tracker or group input does not include `html_url` for each alert, fetch them:

```bash
gh api "repos/{owner}/{repo}/code-scanning/alerts/{alert_number}" --jq '.html_url'
```

Store these URLs so the PR body can link directly to each CodeQL alert on GitHub.

### 4. Read the flagged source code

For each alert in the group, read the affected file and understand the context:

- Read the full function/handler containing the flagged lines.
- Understand what the code does and why CodeQL flagged it.
- Determine the correct fix pattern.

### 5. Check for existing remediation PRs

```bash
gh pr list --state open --limit 100 --json number,title,headRefName,baseRefName,body,labels,url,updatedAt
```

If an open PR already fixes the alerts, update the tracker to `Status: covered-by-existing-pr` and stop.

### 6. Prepare the deterministic branch

```bash
git branch --list <branch_name>
git ls-remote --heads origin <branch_name>
git checkout -b <branch_name> origin/<base_branch>
```

### 7. Apply the code fix

Apply source code fixes based on the rule type. Common patterns:

#### `py/path-injection`

User-controlled input flows into filesystem operations without validation. Fix by:
- Resolving the path with `os.path.realpath()` or `pathlib.Path.resolve()` and checking it stays within the intended base directory.
- Example: `if not os.path.realpath(user_path).startswith(os.path.realpath(base_dir)): raise ValueError("path traversal")`

#### `py/stack-trace-exposure`

Stack traces or exception details returned in HTTP responses. Fix by:
- Catching exceptions and returning a generic error message to the client.
- Logging the full traceback server-side for debugging.
- Example: replace `raise HTTPException(detail=str(e))` with `logger.exception("..."); raise HTTPException(detail="Internal server error")`

#### `js/xss-through-dom`

User input or URL parameters inserted into the DOM without sanitization. Fix by:
- Using `textContent` instead of `innerHTML` for plain text.
- Sanitizing HTML input through a library like DOMPurify before insertion.
- Using framework-safe APIs (React's JSX auto-escapes by default).

#### `js/redos`

Regular expressions vulnerable to catastrophic backtracking. Fix by:
- Simplifying the regex to avoid nested quantifiers.
- Adding input length limits before regex matching.
- Using atomic groups or possessive quantifiers where supported.

#### `js/incomplete-multi-character-sanitization`

Sanitization that replaces multi-character sequences but can be bypassed by nesting. Fix by:
- Applying the replacement in a loop until no more matches are found.
- Or using a proper parser/sanitizer library instead of regex replacement.

#### `js/incomplete-url-substring-sanitization`

URL validation using substring checks like `.includes("allowed.com")` which can be bypassed. Fix by:
- Parsing the URL with `new URL()` and checking the `hostname` property exactly.
- Example: `new URL(url).hostname === "allowed.com"` or checking `.endsWith(".allowed.com")`

#### `js/disabling-electron-websecurity`

Electron `webPreferences.webSecurity` set to `false`. Fix by:
- Removing the `webSecurity: false` setting (defaults to `true`).
- If needed for development only, gate behind an environment variable check.

If no fix is applicable, use a suppression comment — see **Alert is a false positive or the pattern is intentional** below.

#### `js/disabling-certificate-validation`

TLS certificate validation disabled via `NODE_TLS_REJECT_UNAUTHORIZED=0` or `rejectUnauthorized: false`. Fix by:
- Removing the override entirely if possible.
- If needed for specific self-signed certs, configure a custom CA bundle instead.
- If needed for development only, gate behind an environment variable.

If no fix is applicable, use a suppression comment — see **Alert is a false positive or the pattern is intentional** below.

#### `actions/missing-workflow-permissions`

GitHub Actions workflow or job without explicit `permissions` declarations. Fix by:
- Adding a top-level `permissions:` block with least-privilege scopes.
- Or adding per-job `permissions:` blocks.
- Common minimal permissions: `contents: read` for checkout-only workflows, `contents: write` for release workflows, `packages: write` for container publishing.
- Example:
  ```yaml
  permissions:
    contents: read
  ```

#### Other rules

For rules not listed above:
- Read the CodeQL rule documentation linked in the alert.
- Understand the vulnerable pattern and recommended fix.
- Apply the minimal change that eliminates the taint flow or unsafe pattern.
- If the fix pattern is unclear, mark the group as `needs-verification` and describe the vulnerability and proposed fix in the PR body.

### 8. Inspect the diff

```bash
git status --short
git diff --stat
git diff --name-status
git diff -- <affected-files>
```

Confirm:
- Changed files match the plan.
- Vulnerable patterns have been eliminated.
- No unrelated changes are included.
- The fix does not introduce new issues.

### 9. Verify remediation

CodeQL cannot be run locally in most environments, so verification is different from dependency fixes:

1. Re-read the source file to confirm the vulnerable pattern has been removed.
2. Verify the fix does not introduce new issues (e.g. a path check that always fails, an error handler that swallows all exceptions).
3. Note in the PR body that CodeQL will re-scan on push and the alert should auto-close if the fix is correct.

Run focused tests if available and the change has runtime risk:

```bash
npm test
pnpm test
pytest
```

After the PR is pushed, alert status can be checked via:

```bash
gh api "repos/{owner}/{repo}/code-scanning/alerts/{alert_number}" --jq '{state, most_recent_instance: .most_recent_instance.state}'
```

### 10. Commit the remediation

Stage only intended files:

```bash
git add <affected-source-files>
```

Use a conventional security commit message:

```bash
git commit -m "fix(security): resolve CodeQL <rule_id> alerts" -m "Fix <rule_description> in <file paths>. Alerts: <alert numbers>."
```

### 11. Push and create or update the PR

```bash
git push -u origin <branch_name>
gh pr list --state open --head <branch_name> --json number,title,url,body
```

If no PR exists, create it:

```bash
gh pr create --draft --title "<pr_title>" --body "<pr_body>" --base <base_branch> --head <branch_name>
```

Use this PR body structure:

```markdown
<!-- code-scanning-remediation: group_id=<group_id>; alerts=<comma-separated alert numbers>; rules=<comma-separated rule IDs> -->

## Summary

- Resolves CodeQL `<rule IDs>` alerts in `<file paths>`.
- Strategy: `<code-fix/workflow-permissions-fix/etc.>`.

## Code scanning alerts addressed

- [Alert #`<number>`](<html_url>) — `<rule_id>` in `<file_path>:<line>` — `<description of fix applied>`

## Verification

- [x] Source code reviewed: vulnerable pattern removed
- [x] Fix does not alter intended behavior
- [ ] CodeQL re-scan on push will confirm resolution

## Risk notes

- `<behavioral changes, edge cases, or "Minimal change, no behavioral impact expected.">`
```

### 12. Update the progress tracker

If `docs/tmp/code-scanning-remediation.md` exists, update the group's section:

- Set `Status: pr-opened` when a PR was created or updated.
- Set `Status: done` when verified fixed.
- Set `Status: blocked` when remediation cannot proceed.
- Set `PR: <url>` when a PR exists.
- Append progress notes.

### 13. Final response

Report:

- Remediation group ID and alert numbers.
- Tracker path and status, if used.
- Branch name.
- Commit hash and message, if created.
- PR URL.
- Files changed.
- Verification results.
- Any residual risk or follow-up required.

## Handling common situations

### Alert requires understanding application context

Some alerts (e.g. `py/path-injection`) require understanding what paths are valid and what the intended access scope is. Read the surrounding code, route definitions, and any existing validation. If the intended scope is unclear, describe the vulnerability and the candidate fix in the PR body and mark as `needs-verification`.

### Alert is a false positive or the pattern is intentional

If after reading the code you determine the alert is a false positive or the flagged pattern is intentional and no code fix is applicable (e.g. the input is already validated upstream, or the flagged code is unreachable):

1. Ensure there is a comment in the code explaining why the flagged pattern is safe and intentional. If one already exists, no additional prose is needed.
2. Add a CodeQL suppression comment on the **line immediately before** the flagged line:
   - JavaScript/TypeScript: `// codeql[rule-id]`
   - Python: `# codeql[rule-id]`
   - YAML: `# codeql[rule-id]`

   **Important**: the suppression comment must be on its own dedicated line immediately preceding the flagged line. Appending it at the end of the flagged line itself does **not** work.

3. Commit and open a PR as normal. The suppression prevents future scans from re-flagging the line without requiring GitHub UI dismissals each time.

If the code is entirely dead/unreachable, removing it is preferable to suppressing it.

### Multiple rules in one file

If a file has alerts for multiple rules (e.g. both `py/path-injection` and `py/stack-trace-exposure`), and they were grouped together in the plan, fix all of them in the same PR. Read the file once, understand the full handler, and apply all fixes coherently.

### GitHub Actions workflow permissions

For `actions/missing-workflow-permissions` alerts, read each workflow file, understand what the workflow does, and add the minimum required `permissions` block. Common patterns:
- Checkout + build + test only: `contents: read`
- Push artifacts or releases: `contents: write`
- Comment on PRs: `pull-requests: write`
- Push container images: `packages: write`
- Multiple jobs with different needs: use per-job permissions rather than top-level

### Fix requires a new dependency

If the fix requires importing a new module or library (e.g. DOMPurify for XSS sanitization), verify it is already available in the project or add it as a minimal dependency. Note the new dependency in the PR risk notes.
