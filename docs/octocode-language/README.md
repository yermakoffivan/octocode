# Octocode Language Docs

This folder is the planning and implementation guide for Octocode Query
Language.

## Read Order

| Doc | Use it for |
|---|---|
| https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/OCTOCODE_QUERY_LANGUAGE.md | Target OQL contract and examples |
| https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/QUERY-LANGUAGE.md | Current `octocode grep` and `localSearchCode` behavior |
| https://github.com/bgauryy/octocode/blob/main/docs/octocode-language/OPTIMIZATION-PLAN.md | Build order, milestones, tests, and risks |

## One-page Decision

OQL is a typed query object that compiles to existing Octocode capabilities. It
is not a new raw DSL.

Command split:

- `octocode search`: wide external discovery over GitHub, npm, and future
  providers.
- `octocode grep`: proof-capable local checks, including external code after
  bounded remote-as-local materialization.

Implementation split:

- Schemas and descriptions live in `@octocodeai/octocode-core`.
- Planning and execution live in `packages/octocode-tools-core`.
- Native primitives stay in `packages/octocode-engine`.
- CLI and MCP stay thin.

## Implementation Checklist

1. Add OQL schema types.
2. Build planner with `PUSHDOWN`, `RESIDUAL`, `ROUTE`, and `UNSUPPORTED`.
3. Adapt OQL to current local grep.
4. Promote remote-as-local from CLI behavior into tools-core.
5. Standardize result envelope: `results`, `pagination`, `next`,
   `diagnostics`, and `provenance`.
6. Add `octocode search` targets.
7. Wire CLI and MCP without duplicating logic.

## Editing Rules

- Keep this folder short and implementation-facing.
- Do not duplicate the full target contract in the plan.
- Do not put current implementation details in the target contract unless they
  define an intentional compatibility bridge.
- Use absolute GitHub URLs for documentation links.
