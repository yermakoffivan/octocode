# Learning Loop Closure

Use this when reflection, evals, recurring failures, developer review, or harness proposals should change future behavior. This is **bookkeeping (learning)**; read `references/bookkeeping.md` for cleanup and triggers. Skip routine successful edits with no reusable lesson.

A loop is closed only when its output has an owner, an applied action, fresh verification, and a terminal state or refreshed projection.

## Routes

| Trigger | Produce | Consume | Close |
|---|---|---|---|
| Reusable task outcome | `reflect record --lesson` memory | A later `attend` / `memory recall` | Re-check against source/tests; supersede or forget when stale. |
| Repo/code fix remains | `reflect record --fix-repo` refinement | `refinement get --state open` | Apply, verify, then `refinement set --refinement-id <id> --state done`. |
| Harness/tooling gap | `reflect record --fix-harness` memory | `reflect export-harness` preview | Human approves; edit owning skill/tool, run skill review/tests, then reflect the result. |
| Bad/missing instructions | `reflect record --fix-instructions` developer-review row | Human reads `reflect developer-review` or its projection | Update instructions, verify behavior, mark refinement `done`, optionally `repo inject`. |
| Repeated/eval failure | `--failure-signature` / `--eval-failure-json` memories | `reflect mine-weakness` clusters | Choose one cluster, implement one fix, verify, then reflect with the same signature. |
| Need reflection prompts | `reflect record --duo` advisory prompts | Agent runs one internal role dialogue | Run one check; capture synthesis, not prompts or raw debate. |
| Need independent challenge | One read-only rubber-duck subagent | Main agent revises with dissent and a next check | Run the check; choose none/memory/refinement/signal. Never treat agreement as proof. |
| Stale docs/context | `docs staleness` or projection-health output | Source owner / doc maintainer | Update source+doc, verify links/contracts, regenerate only needed projections. |
| Cleanup pressure | `maintenance digest --dry-run`, prune/forget dry-runs | Human/agent reviews raw IDs and scope | Approve mutation, execute, then re-run `attend`/`query` to confirm health. |

## Learning from failures and errors

When a test fails, a command errors, or a check breaks — capture it so it can cluster, not just fix-and-forget:

- **Capture:** `reflect record --outcome failed --failure-signature "<stable key>" --lesson "<what broke + why>"` (a stable signature is a deterministic key for the error — e.g. `test:<name>` or `<error-class>:<call-site>`, not the full message). `memory record --failure-signature` also accepts one.
- **Bulk eval failures:** `reflect record --eval-failure-json '[{"id":"...","dimension":"...","failure_signature":"...","suggested_lesson":"..."}]'`.
- **Detect recurrence:** `reflect mine-weakness` clusters memories by `failure_signature`; a cluster with repeats is the signal to fix the cause, not the instance.
- **Route the fix** by target (rows above): `--fix-repo` / `--fix-harness` / `--fix-instructions`. After fixing, reflect again with the **same** signature so the cluster closes.

`--outcome` must be `worked|partial|failed`; recording `failed` is what makes a failure learnable.

## Self-Reflection Sequence

```text
VERIFIED OUTCOME -> REFLECT -> ROUTE -> APPLY -> VERIFY -> CLOSE ROW -> PROJECT IF USEFUL -> ATTEND
```

Use `--duo` after a non-obvious result or before a risky long-lived decision. Use `references/subagent-rubber-duck.md` when independent restatement/source checking is worth another agent. Do not treat agreement as proof.

`none` closes the current run when no durable output is justified: nothing reusable/actionable remains, or verification is inconclusive and no owner exists.
Preserve dissent in the returned packet; open a pending signal/refinement only when another run owns the next check.

`reflect export-harness` returns preview text for human review; an approved edit changes `AGENTS.md`, `SKILL.md`, docs, or code. `repo inject` only publishes DB state. Keep application and publication as separate gates.

Preserve returned memory/refinement IDs until closure so the next agent can trace the output to its action and verification.
