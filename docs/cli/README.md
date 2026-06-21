# CLI Docs

The Octocode CLI (`octocode`) runs quick research commands, executes all Octocode MCP tools directly from the terminal, manages GitHub auth, installs MCP client config, and reports status/cache state.

## Quick Start

```bash
npx octocode --help            # all commands
npx octocode tools             # list tools
npx octocode tools <name>      # schema for one tool
npx octocode status --json     # auth/token/cache/MCP status
npx octocode install --ide cursor  # install MCP for an IDE
```

## Docs

| Doc | Purpose |
|-----|---------|
| [REFERENCE.md](https://github.com/bgauryy/octocode/blob/main/docs/cli/REFERENCE.md) | All commands, flags, options, exit codes |
| [BENCHMARK.md](https://github.com/bgauryy/octocode/blob/main/docs/cli/BENCHMARK.md) | Agent benchmark comparing CLI and MCP tool paths |

## Supported IDE Clients

`cursor`, `claude-desktop`, `claude-code`, `windsurf`, `zed`, `vscode-cline`, `vscode-roo`, `vscode-continue`, `opencode`, `trae`, `antigravity`, `codex`, `gemini-cli`, `goose`, `kiro`

[← docs index](https://github.com/bgauryy/octocode/blob/main/docs/README.md)
