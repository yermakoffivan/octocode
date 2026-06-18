# CLI Docs

The Octocode CLI (`octocode`) installs and manages Octocode, and runs all 12 MCP tools directly from the terminal.

## Quick Start

```bash
npx octocode-cli --help            # all commands
npx octocode-cli tools             # list tools
npx octocode-cli tools <name>      # schema for one tool
npx octocode-cli install --ide cursor  # install MCP for an IDE
```

## Docs

| Doc | Purpose |
|-----|---------|
| [REFERENCE.md](https://github.com/bgauryy/octocode-mcp/blob/main/docs/cli/REFERENCE.md) | All commands, flags, options, exit codes |
| [BENCHMARK.md](https://github.com/bgauryy/octocode-mcp/blob/main/docs/cli/BENCHMARK.md) | Agent benchmark comparing CLI and MCP tool paths |

## Supported IDE Clients

`cursor`, `claude-desktop`, `claude-code`, `windsurf`, `zed`, `vscode-cline`, `vscode-roo`, `vscode-continue`, `opencode`, `trae`, `antigravity`, `codex`, `gemini-cli`, `goose`, `kiro`

[← docs index](https://github.com/bgauryy/octocode-mcp/blob/main/docs/README.md)
