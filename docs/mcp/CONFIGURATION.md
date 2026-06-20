# Configuration Reference

Concise reference for Octocode MCP environment variables, `.octocoderc`, local state paths, and option precedence.

## Sources And Precedence

Octocode resolves configuration in this order:

```text
environment variables > <octocode-home>/.octocoderc > built-in defaults
```

Use environment variables for per-client/per-project settings and tokens. Use `.octocoderc` for machine-wide defaults. Restart the MCP server after changing either source.

## MCP Env Example

```json
{
  "mcpServers": {
    "octocode": {
      "command": "npx",
      "args": ["-y", "octocode-mcp@latest"],
      "env": {
        "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx",
        "ENABLE_LOCAL": "true",
        "ENABLE_CLONE": "false"
      }
    }
  }
}
```

Install helpers write client-specific paths automatically:

```bash
npx octocode install --ide cursor
```

Supported clients are listed in the [CLI Reference](https://github.com/bgauryy/octocode/blob/main/docs/cli/REFERENCE.md#install).

## `.octocoderc`

Path:

```text
<octocode-home>/.octocoderc
```

The file is JSON with comments/trailing commas tolerated. Tokens do not belong here.

```jsonc
{
  "version": 1,
  "github": {
    "apiUrl": "https://api.github.com"
  },
  "local": {
    "enabled": true,
    "enableClone": false,
    "workspaceRoot": "/absolute/workspace",
    "allowedPaths": []
  },
  "tools": {
    "enabled": null,
    "enableAdditional": null,
    "disabled": null
  },
  "network": {
    "timeout": 30000,
    "maxRetries": 3
  },
  "telemetry": {
    "logging": true
  },
  "lsp": {
    "configPath": null
  },
  "output": {
    "format": "yaml",
    "pagination": {
      "defaultCharLength": 20000
    }
  }
}
```

Invalid file values fall back to defaults or env overrides. Unknown keys warn and are ignored.

## Options

| Env | `.octocoderc` | Default | Meaning |
|-----|---------------|---------|---------|
| `GITHUB_API_URL` | `github.apiUrl` | `https://api.github.com` | GitHub API endpoint. Use `/api/v3` for GitHub Enterprise. |
| `ENABLE_LOCAL` | `local.enabled` | `true` | Enable local filesystem and LSP tools. |
| `ENABLE_CLONE` | `local.enableClone` | `false` | Enable `ghCloneRepo` and directory fetch. Requires local enabled. |
| `WORKSPACE_ROOT` | `local.workspaceRoot` | `process.cwd()` | Root used for relative local paths and project context. Must be absolute when set. |
| `ALLOWED_PATHS` | `local.allowedPaths` | `[]` | Comma-separated env list or JSON array. Empty means unrestricted after path validation. |
| `TOOLS_TO_RUN` | `tools.enabled` | `null` | Strict whitelist. Overrides add/remove filters. |
| `ENABLE_TOOLS` | `tools.enableAdditional` | `null` | Add tools to the default enabled set. |
| `DISABLE_TOOLS` | `tools.disabled` | `null` | Remove tools from the default enabled set. |
| `REQUEST_TIMEOUT` | `network.timeout` | `30000` | Request timeout in ms. Clamped to `5000..300000`. |
| `MAX_RETRIES` | `network.maxRetries` | `3` | Retry attempts. Clamped to `0..10`. |
| `LOG` | `telemetry.logging` | `true` | Remote/session logging switch. `false` or `0` disables. |
| `OCTOCODE_LSP_CONFIG` | `lsp.configPath` | unset | Custom LSP server config path. |
| `OCTOCODE_OUTPUT_FORMAT` | `output.format` | `yaml` | `yaml` or `json`. |
| `OCTOCODE_OUTPUT_DEFAULT_CHAR_LENGTH` | `output.pagination.defaultCharLength` | `20000` | Auto-pagination character budget. Clamped to `1000..50000`. |

Env-only options:

| Env | Default | Meaning |
|-----|---------|---------|
| `OCTOCODE_TOKEN` | unset | Highest-priority GitHub token. |
| `GH_TOKEN` | unset | Second-priority GitHub token. |
| `GITHUB_TOKEN` | unset | Third-priority GitHub token. |
| `OCTOCODE_HOME` | platform default | Base directory for config, credentials, sessions, stats, logs, and repo cache. Defaults: macOS `~/.octocode`, Windows `%APPDATA%\octocode`, Linux `${XDG_CONFIG_HOME:-~/.config}/octocode`. |
| `OCTOCODE_BULK_QUERY_TIMEOUT_MS` | `60000` | Per-query timeout inside a bulk tool call (ms). |
| `OCTOCODE_TOOL_TIMEOUT_MS` | `60000` | Outer timeout for the entire tool call (ms). |
| `OCTOCODE_COMMAND_CHECK_TIMEOUT_MS` | `5000` | System command availability check timeout (ms). |
| `OCTOCODE_RG_PATH` | unset | Explicit path to a ripgrep binary. Overrides bundled and `@vscode/ripgrep` lookups. |
| `OCTOCODE_DISABLE_VSCODE_RIPGREP` | `0` | Set to `1` to skip `@vscode/ripgrep` lookup and use only `OCTOCODE_RG_PATH` or PATH. |
| `OCTOCODE_CACHE_TTL_MS` | `86400000` | Clone cache TTL in ms. |
| `OCTOCODE_MAX_CACHE_SIZE` | `2147483648` | Clone cache size limit in bytes. |
| `OCTOCODE_MAX_CLONES` | `50` | Maximum cached clone count. |

## Parsing Rules

| Type | Env format | `.octocoderc` format |
|------|------------|----------------------|
| Boolean | `"true"` / `"1"` / `"false"` / `"0"` | `true` / `false` |
| Number | Integer string | Number |
| List | Comma-separated string, such as `"a,b,c"` | JSON array |
| Logging | `"false"` or `"0"` disables; anything else enables | Boolean |

## Important Interactions

- Auth tokens are env-only. Do not put tokens in `.octocoderc`.
- `TOOLS_TO_RUN` is a strict whitelist and overrides `ENABLE_TOOLS` and `DISABLE_TOOLS`.
- Clone and GitHub directory fetch require both `ENABLE_LOCAL=true` and `ENABLE_CLONE=true`.
- LSP requires local tools enabled. If `OCTOCODE_LSP_CONFIG` is unset, Octocode checks `<workspace>/.octocode/lsp-servers.json`, then `${OCTOCODE_HOME}/lsp-servers.json`.
- `WORKSPACE_ROOT` env overrides `local.workspaceRoot`.
- `LOG=false` disables remote/session logging, but local usage stats may still be updated.

## Local State

All state lives under Octocode home (`OCTOCODE_HOME` when set, otherwise the platform default):

| Path | Purpose |
|------|---------|
| `.octocoderc` | Persistent MCP config (env/local/tools/network/output). |
| `credentials.json` | Encrypted OAuth credentials. |
| `.key` | 32-byte AES key for credential encryption. |
| `session.json` | Session identity and timestamps. |
| `stats.json` | Usage counters and character savings. |
| `config.json` | CLI config (e.g. `skillsDestDir`). |
| `repos/` | Clone/directory-fetch cache. |
| `logs/` | Local logs. |
| `lsp-servers.json` | User-level LSP server config. |

Architecture details: [Credentials](https://github.com/bgauryy/octocode/blob/main/docs/mcp/CREDENTIALS.md) · [Session](https://github.com/bgauryy/octocode/blob/main/docs/mcp/SESSION.md)

## Project `.octocode/` Folder

Octocode also reads a per-project `.octocode/` directory at the workspace root. It is not required — create it only when you need project-specific overrides.

| Path | Purpose |
|------|---------|
| `.octocode/lsp-servers.json` | Project-level LSP server config. Checked before `<octocode-home>/lsp-servers.json`. |

### `lsp-servers.json` format

Keys are file-extension patterns (must start with `.`). `languageId` is required.

```jsonc
{
  "languageServers": {
    ".py": {
      "command": "pylsp",
      "args": [],
      "languageId": "python"
    },
    ".go": {
      "command": "gopls",
      "args": [],
      "languageId": "go"
    },
    ".java": {
      "command": "jdtls",
      "args": ["-data", "/tmp/jdtls-workspace"],
      "languageId": "java"
    }
  }
}
```

TypeScript/JavaScript are bundled — no entry needed. Set `OCTOCODE_LSP_CONFIG` to point to a different file entirely.

## Quick Checks

```bash
echo "GITHUB_TOKEN: ${GITHUB_TOKEN:+set}"
echo "ENABLE_LOCAL: ${ENABLE_LOCAL:-not set}"
echo "ENABLE_CLONE: ${ENABLE_CLONE:-not set}"
octocode status --json
```

Common fixes:

| Symptom | Check |
|---------|-------|
| Token missing | Set `OCTOCODE_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`, or run `octocode auth login`. |
| Local tools unavailable | Make sure `ENABLE_LOCAL` is not false and tool filters did not hide them. |
| Clone unavailable | Set `ENABLE_LOCAL=true` and `ENABLE_CLONE=true`. |
| Tool hidden | Check `TOOLS_TO_RUN`, `ENABLE_TOOLS`, and `DISABLE_TOOLS`. |
| Timeout | Increase `REQUEST_TIMEOUT` up to `300000`. |

## See Also

- [Authentication Setup](https://github.com/bgauryy/octocode/blob/main/docs/mcp/AUTHENTICATION.md)
- [CLI Reference](https://github.com/bgauryy/octocode/blob/main/docs/cli/REFERENCE.md)
- [Local Tools Reference](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/LOCAL_TOOLS.md)
- [LSP Tools Reference](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/LSP_TOOLS.md)
