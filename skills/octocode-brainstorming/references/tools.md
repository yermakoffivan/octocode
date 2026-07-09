# Research Surfaces

Load when building the Surface Plan or choosing local, GitHub/package, and web evidence. `octocode-research` owns code/tool syntax; this file owns brainstorm surface choice.

## Surface Order

For external validation, start with official docs, papers, standards, canonical articles, and dated announcements. Extract leads, verify them in code/packages, then reconcile contradictions with formal sources.
Start locally for repo-targeted ideas. Skip external work for explicit local-only tasks or unavailable web.

## Local, GitHub, Packages

Delegate repo/package/history/semantic checks to `octocode-research`. Ask it to orient locally before external research when the idea touches this workspace; skip local for purely external landscapes. Carry the real stack and constraints into external queries.

## Web Engines

| Script | Credential | Best use |
|---|---|---|
| `scripts/serper-search.mjs` | `SERPER_API_KEY` | broad Google results |
| `scripts/tavily-search.mjs` | `TAVILY_API_KEY` | curated/deeper research |

Run `--check` once; `--presence-only` is offline-only. Credentials load through `@octocodeai/config` from process env, workspace `.octocode/.env`, then global Octocode home. Search → fetch/open the best formal URLs → exact-read code → reconcile. Never cite snippets or print/commit keys.

## Workers

Use solo for one check. Dispatch only for independent surfaces within the five-worker ceiling:

- **Web Search Scout:** one query slice; return ranked fetched leads with author/date.
- **Source/Code Checker:** validate leads through formal sources and `octocode-research`.
- **Trend & Source Scout:** when momentum/crowdedness needs `trend-sources.md` evidence.

Run Web + Source/Code as the default closed loop; add Trend only for a distinct question. Use a fast worker tier for mechanical fetch/summarize when supported. Reserve judgment for stress-test/synthesis.

## Query And Evidence Rules

- Expand the user's phrase into 2-3 synonyms/reframes; retry one changed shape after empty results.
- Prefer recent sources; inactive repos are prior art, not current competition.
- Package health = publish recency, cadence, maintainers, issue/PR ratio, and dependency freshness—not downloads alone.
- Formal claims prefer official docs/specs, standards, papers, and primary code/data. Community/marketing content is a lead unless sentiment is the question.
- Use domain filters for formal sources; fetch the paper/publisher page rather than citing Scholar results.
- On 401/403 switch engine and report invalid auth; on 429/5xx switch/fallback and continue. Without an engine, follow README/package/awesome-list leads and mark web coverage limited.
- Fetch 2-3 decisive sources per question; stop when another source is unlikely to change the verdict.
