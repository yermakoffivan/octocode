# References

Sources consulted to research and create this skill.

## Skills.sh API Results

| Skill | Source | Installs | Used for |
|-------|--------|----------|----------|
| langchain-architecture | wshobson/agents | 8,215 | Inspiration; path not found (404), patterns inferred from description |
| deep-agents-memory | langchain-ai/langchain-skills | 8,170 | Inspiration; path not found (404), memory strategy section |
| langchain-fundamentals | langchain-ai/langchain-skills | 7,217 | Inspiration; path not found (404) |
| langgraph-persistence | langchain-ai/langchain-skills | 7,019 | LangGraph persistence patterns (PostgreSQL checkpointer) |
| langchain-rag | langchain-ai/langchain-skills | 7,009 | RAG pipeline patterns |
| langgraph-human-in-the-loop | langchain-ai/langchain-skills | 6,824 | Human-in-the-loop interrupt pattern |
| langchain-middleware | langchain-ai/langchain-skills | 6,519 | Middleware/callback patterns |

## GitHub Sources Inspected

| File | Owner/Repo | Path | Quality | Notes |
|------|-----------|------|---------|-------|
| LangChain Framework | bobmatnyc/claude-mpm-skills | toolchains/ai/frameworks/langchain/SKILL.md | Medium | Code-heavy reference; extracted LCEL, RAG, tool patterns; rejected wholesale copy (license unclear; too code-heavy for a workflow skill) |

## Registry and Marketplace Surfaces

| Surface | URL or Query | Finding |
|---------|-------------|---------|
| skills.sh API | `https://www.skills.sh/api/search?q=langchain&limit=100` | 100 results; top 7 by installs identified above |
| GitHub search | `filename:SKILL.md langchain best practices` | Found 10 candidate SKILL.md files; bobmatnyc was strongest match |
| GitHub search | `filename:SKILL.md langchain chain agent` | Confirmed majiayu000/claude-skill-registry has langchain-10 skill (LangChain 1.0 API reference only) |
| WebSearch | "LangChain best practices 2026 production patterns" | Key patterns: LCEL, LangGraph for stateful agents, RunnableWithMessageHistory, LangSmith |
| WebFetch | https://textify.ai/langchain-agents-guide-2026/ | Production checklist, anti-patterns, memory strategies |

## Local Sources

| File | Path | Notes |
|------|------|-------|
| agent-skills-guide.md | /Users/guybary/.claude/skills/octocode-search-skill/references/agent-skills-guide.md | Used for skill structure, description optimization, progressive disclosure design |
| references-template.md | /Users/guybary/.claude/skills/octocode-search-skill/references/references-template.md | Used for this file's structure |
