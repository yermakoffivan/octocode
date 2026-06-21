# Using octocode-mcp with Pi

> **Pi documentation:** https://pi.dev/docs/latest

Pi is a CLI coding agent whose philosophy is *"CLI tools with READMEs (Skills) over MCP."* Pairing it with Octocode gives a lean, evidence-driven loop — **Pi edits; Octocode researches.**

Two integration paths — pick based on how much tool surface you need:

| Path | When to use |
| --- | --- |
| ⭐ **Skills** (sections 1–3) | Recommended. Focused workflows via the Octocode CLI; no MCP transport overhead |
| **MCP adapter** (sections 4–7) | Full 13-tool surface accessible via the `mcp()` proxy |

> **Path convention used throughout this guide**
> - `./` → Pi's global agent directory (`~/.pi/agent/`)
> - `.pi/` (no `~`) → per-project directory inside your current repo

---

## 1. Install skills

[Agent Skills](https://agentskills.io) (`SKILL.md` folders) are Pi's preferred extension model. Skills are activated automatically by task context or forced with `/skill:name`.

Browse all Octocode skills: **[skills.sh/bgauryy/octocode-mcp](https://www.skills.sh/bgauryy/octocode-mcp)**

| Skill | Purpose |
| --- | --- |
| ⭐ `octocode-engineer` | Codebase understanding, implementation, bug investigation, refactors, PR review, and RFC validation — with AST + LSP evidence |
| `octocode-research` | Deep code exploration: trace flow, find usages, understand a codebase |
| `octocode-brainstorming` | Validate ideas against GitHub, npm, and web evidence; produces a decision-ready brief. Add a [Tavily API key](https://tavily.com) (`TAVILY_API_KEY`) for richer web search results |
| `octocode-rfc-generator` | Evidence-backed RFCs and design docs before starting implementations |
| `octocode-pull-request-reviewer` | Structured code reviews grounded in evidence |
| `octocode-search-skill` | Find, evaluate, install, and create Agent Skills |

Install with `npx skills add`:

```bash
npx skills add https://github.com/bgauryy/octocode-mcp --skill octocode-engineer
npx skills add https://github.com/bgauryy/octocode-mcp --skill octocode-research
npx skills add https://github.com/bgauryy/octocode-mcp --skill octocode-brainstorming
npx skills add https://github.com/bgauryy/octocode-mcp --skill octocode-rfc-generator
npx skills add https://github.com/bgauryy/octocode-mcp --skill octocode-pull-request-reviewer
npx skills add https://github.com/bgauryy/octocode-mcp --skill octocode-search-skill
```

> Default scope is global (`~/.pi/agent/skills/`). Add `--scope project` to install under `.pi/skills/` for the current repo only. Pi discovers skills automatically on next start; force one with `/skill:octocode-engineer`.

**Fallback — if `npx skills add` is unavailable:**

```bash
npx -y degit bgauryy/octocode/skills/<skill-name> ~/.pi/agent/skills/<skill-name>
```

---

## 2. Authenticate GitHub

Octocode GitHub tools need a token for private repositories and higher API rate limits. Any one method is enough:

**Option A — Octocode CLI (simplest):**

```bash
npx octocode auth login
npx octocode status   # confirm the active token source
```

**Option B — GitHub CLI (if already installed):**

```bash
gh auth login
```

Octocode reads the `gh` token automatically — no further config needed.

**Option C — Personal Access Token:**

Set `OCTOCODE_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN` in your shell or in the MCP config `env` block (see section 5). Required scopes: `repo`, `read:user`, `read:org`.

> Never commit tokens to version control. Use environment variables or a secret manager.

---

## 3. Tune Pi's behavior

Pi extends its system prompt from `APPEND_SYSTEM.md`. Use it to tell the agent which tools to prefer, any project conventions, and hard constraints. A ready-to-use starter lives at [`docs/PI/APPEND_SYSTEM.md`](https://github.com/bgauryy/octocode/blob/main/docs/PI/APPEND_SYSTEM.md).

| File | Scope | When loaded |
| --- | --- | --- |
| `.pi/APPEND_SYSTEM.md` | Project | When the project is trusted |
| `./APPEND_SYSTEM.md` | Global (`~/.pi/agent/`) | Always |

A trusted project's `.pi/APPEND_SYSTEM.md` **shadows** the global file — they do not merge. Keep cross-project rules global; put repo-specific rules in the project file.

`SYSTEM.md` (same locations) **replaces** the default prompt entirely — only use it when you need full control.

```bash
$EDITOR ~/.pi/agent/APPEND_SYSTEM.md
```

Keep it concise. A bloated file degrades adherence to all rules. Lead with hard constraints, name the exact tools to use, and push anything a linter can enforce into tooling rather than prose. Restart Pi to pick up changes.

---

## 4. Install the MCP adapter

> Use this path for the full 13-tool surface via Pi's `mcp()` proxy. If you only need the skill-based workflow, sections 1–3 are sufficient.

```bash
pi install npm:pi-mcp-adapter
```

Restart Pi after installation. The adapter exposes a single ~200-token `mcp` proxy tool instead of injecting every tool schema into the prompt — servers stay disconnected until the agent actually calls a tool.

---

## 5. Configure octocode-mcp

The adapter reads standard MCP config files. Choose the scope that fits your setup:

| File | Scope |
| --- | --- |
| `~/.config/mcp/mcp.json` | User-global, shared across all MCP hosts (Cursor, Claude Code, Pi, …) |
| `.mcp.json` | Project-local, shared across all MCP hosts |
| `./mcp.json` | Pi-only, user-global (`~/.pi/agent/mcp.json`) |
| `.pi/mcp.json` | Pi-only, project-local |

Precedence (highest first): `~/.config/mcp/mcp.json` → `./mcp.json` → `.mcp.json` → `.pi/mcp.json`

Add the `octocode` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "octocode": {
      "command": "npx",
      "args": ["-y", "octocode-mcp@latest"]
    }
  }
}
```

> `type: "stdio"` is not needed — the adapter assumes stdio for `command` entries.

**With local filesystem and clone tools enabled:**

```json
{
  "mcpServers": {
    "octocode": {
      "command": "npx",
      "args": ["-y", "octocode-mcp@latest"],
      "env": {
        "ENABLE_LOCAL": "true",
        "ENABLE_CLONE": "true"
      }
    }
  }
}
```

**Migrating from another host:** Run `/mcp setup` inside a Pi session — it previews what it will write before touching disk.

---

## 6. Verify the setup

**Before launching Pi** — confirm the server responds and expected tools appear:

```bash
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | ENABLE_LOCAL=true ENABLE_CLONE=true npx -y octocode-mcp@latest 2>/dev/null \
  | grep -o '"name":"[^"]*"' | sort -u
```

Expected output (13 tools when all env flags are set):

```
"name":"ghCloneRepo"
"name":"ghGetFileContent"
"name":"ghHistoryResearch"
"name":"ghSearchCode"
"name":"ghSearchRepos"
"name":"ghViewRepoStructure"
"name":"localBinaryInspect"
"name":"localFindFiles"
"name":"localGetFileContent"
"name":"localSearchCode"
"name":"localViewStructure"
"name":"lspGetSemantics"
"name":"npmSearch"
```

If tools are missing, the `env` block is not being applied — check JSON syntax and confirm the file is at the right scope.

**Inside Pi** — run `/mcp` to list registered servers. `octocode` should appear. To confirm the adapter binary:

```bash
grep pi-mcp-adapter ~/.pi/agent/settings.json
ls ~/.pi/agent/npm/node_modules/.bin/pi-mcp-adapter
```

---

## 7. Use octocode tools from Pi

Search for available tools via the proxy:

```
mcp({ search: "github" })
```

Call a tool — pass `args` as a JSON string, not an object:

```
mcp({ tool: "octocode_ghSearchCode", args: "{\"queries\":[{\"id\":\"q1\",\"keywordsToSearch\":[\"useState\"]}]}" })
```

**Token efficiency:** `concise:true` returns path/title-only lists. `minify:"symbols"` gives a skeleton outline with line numbers; `minify:"standard"` (default) strips comments and blanks; `minify:"none"` returns exact bytes.

The server spawns lazily on the first tool call — expect a brief delay the first time.

---

## 8. Add custom models

Point Pi at additional providers via `~/.pi/agent/models.json`. The file reloads every time you open `/model` — no restart needed.

Each provider entry needs: `baseUrl`, `api` (one of `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`), `apiKey`, and a `models` array. `apiKey` accepts a literal string, `$ENV_VAR`, or `!shell-command` (e.g. `!op read 'op://vault/item/field'`) — don't commit raw secrets.

> Naming a provider after a built-in (`anthropic`, `openai`) and providing `models` **replaces** that provider's model list entirely. Use `modelOverrides` to extend the built-ins instead.

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "https://your-gateway/anthropic",
      "apiKey": "$ANTHROPIC_API_KEY",
      "api": "anthropic-messages",
      "models": [
        {
          "id": "claude-sonnet-4-6",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 200000,
          "maxTokens": 32000
        }
      ]
    },
    "openai": {
      "baseUrl": "https://your-gateway/openai/v1",
      "apiKey": "$OPENAI_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "gpt-5.5",
          "input": ["text", "image"],
          "contextWindow": 200000
        }
      ]
    }
  }
}
```

Select a model with `/model` inside Pi, or pass `--model <pattern>` at launch.

---

## References

- [Pi documentation](https://pi.dev/docs/latest)
- [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter)
- [Pi source](https://github.com/earendil-works/pi)
- [Octocode skills index](https://www.skills.sh/bgauryy/octocode-mcp)
- [APPEND_SYSTEM.md starter](https://github.com/bgauryy/octocode/blob/main/docs/PI/APPEND_SYSTEM.md)
- octocode-mcp tool reference: [GitHub tools](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/GITHUB_TOOLS.md) · [Local tools](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/LOCAL_TOOLS.md) · [LSP tools](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/LSP_TOOLS.md)
