# Octocode Language Docs

This folder is the planning and implementation guide for Octocode Query
Language.

## Read Order

| Doc | Use it for |
|---|---|
| https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/OCTOCODE_QUERY_LANGUAGE.md | XML-tagged canonical OQL V1 implementation contract and examples |
| https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/OCTOCODE_QUERY_LANGUAGE_PLAN.md | Implementation plan, prerequisites, package split, milestones, tests, and risks |

## One-page Decision

OQL is a typed query object that compiles to existing Octocode capabilities. It
is not a new raw DSL. The V1 contract is Markdown with XML-style tags so agents
can chunk the prompt into stable instruction blocks. V1 has one canonical shape:
`target`, `from`, `scope`, discriminated `where.kind`, `materialize`, `fetch`,
`select`, `view`, `controls`, result bounds, diagnostics, provenance,
evidence, and executable `next.*` continuations. V1 also defines a bounded
batch envelope for 1-5 independent queries.

Command split:

- `octocode search`: universal OQL runner to implement from this contract.
- Existing quick commands (`grep`, `cat`, `ls`, `find`, and later `lsp`,
  `repo`, `pkg`, `pr`, `history`, `binary`, `diff`) remain aliases that should
  lower into canonical OQL after parity gates pass.
- Until that runner lands, current quick commands and raw `tools NAME` calls
  are the execution surface.

Implementation split:

- Schemas and descriptions live in `@octocodeai/octocode-core`.
- Planning and execution live in `packages/octocode-tools-core`.
- Native primitives stay in `packages/octocode-engine`.
- CLI and MCP stay thin.

## Implementation Checklist

1. Add strict OQL V1 schema types.
2. Build the normalizer: sugar in, canonical OQL out.
3. Build planner with predicate-node IDs and `PUSHDOWN`, `RESIDUAL`, `ROUTE`,
   and `UNSUPPORTED`.
4. Adapt canonical OQL to current local and GitHub V1 tools.
5. Promote bounded remote-as-local from CLI behavior into tools-core.
6. Standardize result envelope: `results`, `pagination`, executable `next`,
   `diagnostics`, `provenance`, and `evidence`.
7. Add `--explain` with normalized query, per-predicate routing, defaults,
   budgets, backend calls, materialization, diagnostics, and continuations.
8. Wire CLI and MCP without duplicating logic.

## Editing Rules

- Keep this folder short and implementation-facing.
- Do not duplicate the full target contract in the plan.
- Do not put current implementation details in the target contract unless they
  define an intentional compatibility bridge.
- Keep the OQL contract XML tags balanced and meaningful for agent attention.
- Use absolute GitHub URLs for documentation links.
