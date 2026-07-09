# RFC Resources

Load this when producing `RESOURCES.md`, when the user asks for resources/refs, or when an RFC depends on external papers, prior art, packages, local code maps, research artifacts, or search prompts.

`RESOURCES.md` is an appendix, not a proof substitute. It keeps the source inventory reviewable while decisive claims still cite evidence in `RFC.md`, `PREREQUISITES.md`, `IMPLEMENTATION.md`, or `KPI.md`.

## What Belongs Here

| Section | Include |
|---|---|
| Primary sources | User-provided papers, specs, docs, issues, PRs, commits, package pages, or official references. |
| Local code refs | `path:line` anchors for important files, APIs, tests, schema, and docs. |
| Prior art | Comparable systems, libraries, patterns, standards, papers, and known alternatives. |
| Research artifacts | Brainstorming ledgers, Octocode research outputs, eval logs, screenshots, benchmark notes. |
| Open research leads | Sources worth checking later, with why they were not decisive yet. |
| Search prompts | Queries that recreate or extend the research trail. |

## Template

````markdown
# Resources: <Title>

## Primary Sources

| Resource | Link or path | Why it matters |
|---|---|---|

## Local Code References

| Area | File and lines | Notes |
|---|---|---|

## Prior Art And Related Systems

| Resource | Link | Use for this RFC |
|---|---|---|

## Internal Research Artifacts

| Artifact | Path | Notes |
|---|---|---|

## Open Research Leads

- Lead - why it matters, and what would make it decision-grade.

## Search Prompts

```text
query that can reproduce or extend the research
```
````

## Quality Bar

- Every source has a reason it matters.
- Local entries use stable `path:line` anchors when possible.
- External links prefer primary sources over summaries.
- Prior-art rows explain the lesson, not just the name.
- Undecided leads are labeled as leads, not cited as proof.
- `RESOURCES.md` does not replace inline citations for decisions, risks, or implementation constraints.
