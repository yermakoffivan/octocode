# Using octocode-mcp with Pi

Pi (the coding agent from [earendil-works](https://github.com/earendil-works/pi)) has no built-in MCP support — this is an explicit non-goal. To run octocode-mcp inside Pi, install the community adapter **[`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter)** and point it at octocode-mcp.

The adapter exposes one ~200-token proxy tool (`mcp`) instead of injecting every MCP tool schema into the prompt — servers stay disconnected until the agent actually calls a tool.

> **Paths in this guide:** `./…` is relative to Pi's global agent directory, `~/.pi/agent/`. `.pi/…` (no `~`) is the per-project directory in your current repo.

---

## 1. Install the adapter

```bash
pi install npm:pi-mcp-adapter
```

Restart Pi after installation.

## 2. Add octocode-mcp to your MCP config

The adapter reads standard MCP files. Pick the scope that fits:

| File | Scope |
| --- | --- |
| `~/.config/mcp/mcp.json` | User-global, shared across MCP hosts (Cursor, Claude Code, Pi, …) |
| `.mcp.json` | Project-local, shared across MCP hosts |
| `./mcp.json` | Pi-only, user-global override (in `~/.pi/agent/`) |
| `.pi/mcp.json` | Pi-only, project override |

Precedence (highest first):

1. `~/.config/mcp/mcp.json`
2. `./mcp.json`
3. `.mcp.json`
4. `.pi/mcp.json`

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

> The `type: "stdio"` field used by some hosts (e.g. Cursor) is not required here — pi-mcp-adapter assumes stdio for `command` entries.

### Enabling clone tools

```json
{
  "mcpServers": {
    "octocode": {
      "command": "npx",
      "args": ["-y", "octocode-mcp@latest"],
      "env": {
        "ENABLE_CLONE": "true"
      }
    }
  }
}
```

### Importing from an existing host

If you already have octocode configured for Cursor, Claude Code, Codex, etc., adopt those configs into Pi with the `/mcp setup` slash command **inside a Pi session**. The flow previews exactly what it will write before touching disk.

> `pi-mcp-adapter init` exists as a shell entrypoint (`./npm/node_modules/.bin/pi-mcp-adapter init`) but is interactive — it needs a TTY and produces no output in non-interactive shells. Prefer `/mcp setup` from inside Pi, or just write `./mcp.json` by hand as shown above.

## 3. Verify the server side (no Pi needed)

Before launching Pi, sanity-check that the `command` + `env` in your config actually produce a working MCP server. This handshake lists tools without going through the adapter:

```bash
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | ENABLE_LOCAL=true ENABLE_CLONE=true npx -y octocode-mcp@latest 2>/dev/null \
  | grep -o '"name":"[^"]*"' | sort -u
```

Expected output includes the 13 Octocode tools below — this confirms `ENABLE_CLONE` are taking effect:

```
"name":"ghCloneRepo"
"name":"ghGetFileContent"
"name":"ghSearchCode"
"name":"ghHistoryResearch"
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

If `ghCloneRepo` or local/LSP tools are missing, the env block in `mcp.json` is not being read — re-check JSON syntax.

## 4. Use octocode tools from inside Pi

Start the agent and discover tools through the proxy:

```
mcp({ search: "github" })
```

The adapter returns matching tool descriptions. Call one with a JSON-string `args` (not an object):

```
mcp({ tool: "octocode_ghSearchCode", args: "{\"queries\":[{\"id\":\"q1\",\"keywordsToSearch\":[\"useState\"]}]}" })
```

Servers are **lazy by default** — `octocode-mcp` only spawns when you first invoke one of its tools.

## 5. Verify inside Pi

```
/mcp
```

Pi lists detected MCP files and registered servers. You should see `octocode` listed under `./mcp.json` (or whichever scope you chose). The first tool call lazily spawns `npx octocode-mcp@latest` and streams its tool list into the adapter's cache — expect a one-time delay on the first `mcp({ tool: ... })` call.

To confirm the adapter is registered in Pi at all (without launching the TUI):

```bash
cd ~/.pi/agent
cat ./settings.json   # should contain "npm:pi-mcp-adapter" under "packages"
ls ./npm/node_modules/.bin/pi-mcp-adapter   # binary exists
```

---

## 6. Tune Pi's behavior with `APPEND_SYSTEM.md`

This is core Pi, not the adapter — it's how you teach the agent your operating rules (e.g. "reach for the octocode tools above when researching code"). Pi extends its prompt from a Markdown file:

- `APPEND_SYSTEM.md` — **appends** your rules to Pi's default system prompt. Use this; it keeps Pi's built-in behavior.
- `SYSTEM.md` — **replaces** the default prompt entirely. Only for full control.

Pi looks in two locations and uses the **first** match — they do not merge:

| File | Scope | Loaded when |
| --- | --- | --- |
| `.pi/APPEND_SYSTEM.md` | Project (current repo) | the project is trusted |
| `./APPEND_SYSTEM.md` | Global (`~/.pi/agent/`) | always |

So a trusted project's `.pi/APPEND_SYSTEM.md` **shadows** the global `./APPEND_SYSTEM.md`. Keep cross-project rules global; put repo-specific rules in the project file.

Create the global rules file:

```bash
cd ~/.pi/agent
$EDITOR ./APPEND_SYSTEM.md
```

Keep it lean: Pi's harness already spends part of the model's instruction budget, and a bloated file degrades adherence to *all* your rules, not just the new ones. Lead with the hard "never" constraints, name the exact tools you want used, and push anything a linter can check into tooling rather than prose. A compact working example lives at `./APPEND_SYSTEM.md`. Restart Pi to pick up changes.

---

## 7. Add skills (native — no adapter)

Pi natively supports the [Agent Skills standard](https://agentskills.io) (`SKILL.md` folders) — in fact Pi's stated philosophy is "CLI tools with READMEs (Skills) over MCP." Skills are discovered from:

| Location | Scope |
| --- | --- |
| `./skills/` (i.e. `~/.pi/agent/skills/`) | Global — available in every session |
| `.pi/skills/` | Project — current repo only |

Each skill is a folder containing a `SKILL.md` (a top-level `.md` file works too). Pi lists available skills in the system prompt and loads one when a task matches its `description`; force it with `/skill:name`.

Install the octocode researcher skill into the global skills dir by fetching the
skill subtree — [`skills/octocode-engineer`](https://github.com/bgauryy/octocode/tree/main/skills/octocode-engineer) —
straight into `~/.pi/agent/skills/`.

**With `degit`** (fetches just the subfolder, no git history):

```bash
npx -y degit bgauryy/octocode/skills/octocode-engineer ~/.pi/agent/skills/octocode-engineer
ls ~/.pi/agent/skills/octocode-engineer/SKILL.md   # confirm it landed
```

**Without `degit`** (git sparse-checkout fallback):

```bash
tmp="$(mktemp -d)"
git clone --depth 1 --filter=blob:none --sparse https://github.com/bgauryy/octocode "$tmp"
git -C "$tmp" sparse-checkout set skills/octocode-engineer
mkdir -p ~/.pi/agent/skills
cp -R "$tmp/skills/octocode-engineer" ~/.pi/agent/skills/
rm -rf "$tmp"
ls ~/.pi/agent/skills/octocode-engineer/SKILL.md   # confirm it landed
```

Either way the result is `~/.pi/agent/skills/octocode-engineer/SKILL.md`, which Pi
discovers automatically (force it with `/skill:octocode-engineer`).

The skill drives octocode via its CLI and avoids the MCP transport entirely. Use the adapter route (sections 1–5) when you want the full 13-tool surface exposed; use the skill route when a focused research workflow is enough.

## 8. Add custom models (`models.json`)

Point Pi at extra providers and models — local models, proxies, or gateways — via `./models.json` (i.e. `~/.pi/agent/models.json`). The file reloads every time you open `/model`, so no restart is needed.

The root is `{ "providers": { "<name>": { … } } }`. Each provider sets `baseUrl`, `api` (`openai-completions`, `openai-responses`, `anthropic-messages`, or `google-generative-ai`), `apiKey`, and a `models` array. `apiKey` accepts a literal, a `$ENV_VAR` reference, or a `!command` (e.g. `!op read 'op://vault/item/credential'`) — don't commit raw secrets.

```json
{
  "providers": {
    "nebius": {
      "baseUrl": "https://api.studio.nebius.com/v1",
      "apiKey": "$NEBIUS_API_KEY",
      "api": "openai-completions",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "zai-org/GLM-5.2",
          "name": "Nebius GLM-5.2",
          "contextWindow": 200000,
          "maxTokens": 32000
        }
      ]
    },
    "anthropic": {
      "baseUrl": "https://www.wixapis.com/anthropic",
      "apiKey": "$ANTHROPIC_API_KEY",
      "api": "anthropic-messages",
      "models": [
        {
          "id": "claude-sonnet-4-6",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 900000,
          "maxTokens": 32000
        }
      ]
    },
    "openai": {
      "baseUrl": "https://www.wixapis.com/openai/v1",
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

Then select a model with `/model` inside Pi (or `--model <pattern>`).

> Naming a provider after a built-in (`anthropic`, `openai`) and supplying `models` **replaces** that provider's entire model list with yours — here it repoints Anthropic/OpenAI at the Wix gateway. To add to the built-ins instead of replacing, use `modelOverrides`.

## References

- pi-mcp-adapter — https://github.com/nicobailon/pi-mcp-adapter
- Pi (coding agent) — https://github.com/earendil-works/pi
- octocode-mcp tool reference — [GitHub Tools Reference](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/GITHUB_TOOLS.md), [Local Tools Reference](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/LOCAL_TOOLS.md), [LSP Tools Reference](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/LSP_TOOLS.md)
