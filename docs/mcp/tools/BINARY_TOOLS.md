# Binary Tools Reference

Reference for `localBinaryInspect` — the Octocode MCP tool for inspecting archives, compressed streams, and native binaries.

Requires `ENABLE_LOCAL=true`.

---

## `localBinaryInspect`

Inspect binary files without writing code. Pick the mode for the job:

| Mode | Input | Output |
|------|-------|--------|
| `identify` | Any file | File type + magic bytes |
| `list` | Archive (.zip, .tar.gz, .jar, .7z, …) | Entry names, sizes, timestamps |
| `extract` | Archive + entry name (from `list`) | Entry content |
| `decompress` | Single-stream compressed file (.gz, .bz2, .xz, .zst, .lz4, .br, .lzfse) | Decompressed text |
| `strings` | Native binary (.so, .dylib, .node, .exe, .wasm) | Readable strings, symbols, URLs |

### Decision Flow

```text
Unknown file  → identify
Archive       → list  → extract (one entry)
Compressed    → decompress
Native binary → strings
```

---

## Parameters

### Required

| Parameter | Description |
|-----------|-------------|
| `path` | File path (absolute or workspace-relative). |
| `mode` | One of: `identify`, `list`, `extract`, `decompress`, `strings`. |

### `list` mode

| Parameter | Default | Description |
|-----------|---------|-------------|
| `verbose` | `false` | Include entry size and mtime. |
| `maxEntries` | `1000` | Cap entries before pagination. |
| `entriesPerPage` | unset | Entries per page. Pair with `entryPageNumber`. |
| `entryPageNumber` | `1` | Page for large archives. |

### `extract` mode

| Parameter | Description |
|-----------|-------------|
| `archiveFile` | Exact entry path (case-sensitive, no leading `-`). **Required.** Run `list` first. |
| `matchString` | Filter decompressed lines by this string. |
| `matchStringContextLines` | Lines around each match. Default `3`. |
| `charOffset` | Char offset for content pagination. |
| `charLength` | Max chars to return. Max `50000`. |

### `decompress` mode

| Parameter | Default | Description |
|-----------|---------|-------------|
| `format` | `auto` | Force compression format: `gzip`, `bzip2`, `xz`, `lzma`, `zstd`, `lz4`, `brotli`, `lzfse`. |
| `matchString` | — | Filter decompressed lines. |
| `matchStringContextLines` | `3` | Context lines around each match. |
| `charOffset` | — | Continuation offset for pagination (from `hints[]`). |
| `charLength` | — | Max chars per page. |

### `strings` mode

| Parameter | Default | Description |
|-----------|---------|-------------|
| `minLength` | `8` | Minimum printable run length. Raise (12–16) to surface symbols/URLs only. |
| `includeOffsets` | `false` | Prefix each string with its hex byte offset. |

---

## Supported Formats

**Archives (list / extract):** `.zip`, `.jar`, `.war`, `.apk`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2`, `.tar.xz`, `.txz`, `.tar.zst`, `.tzst`, `.7z`

**Compressed streams (decompress):** `.gz`, `.bz2`, `.xz`, `.lzma`, `.zst`, `.lz4`, `.br`, `.lzfse`

**Native binaries (strings):** `.so`, `.dylib`, `.node`, `.exe`, `.wasm`, any ELF/Mach-O binary

> `decompress` rejects multi-entry archives. Use `list`/`extract` for `.tar.gz`, `.zip`, etc.

---

## Examples

```bash
# What type is this file?
localBinaryInspect(path="dist/server.node", mode="identify")

# List entries in a zip
localBinaryInspect(path="build.zip", mode="list", verbose=true)

# List a large archive page by page
localBinaryInspect(path="release.tar.gz", mode="list", entriesPerPage=50, entryPageNumber=2)

# Extract one entry (use exact path from list output)
localBinaryInspect(path="build.zip", mode="extract", archiveFile="dist/index.js")

# Extract and filter for a specific function
localBinaryInspect(path="build.zip", mode="extract", archiveFile="dist/index.js",
  matchString="createServer", matchStringContextLines=10)

# Decompress a log file
localBinaryInspect(path="app.log.gz", mode="decompress")

# Decompress and paginate large content
localBinaryInspect(path="app.log.gz", mode="decompress", charLength=10000)
# → response hints[] contains charOffset=N for next page

# Extract symbols from a native addon
localBinaryInspect(path="packages/addon/bin/addon.node", mode="strings", minLength=12)

# Extract strings with byte offsets (for binary diffing)
localBinaryInspect(path="binary.exe", mode="strings", includeOffsets=true)
```

---

## Bulk Queries

Up to 5 queries per call:

```bash
localBinaryInspect(queries=[
  { path="a.zip", mode="list" },
  { path="b.tar.gz", mode="list" }
])
```

---

## Requirements

- `ENABLE_LOCAL=true`
- Backend CLIs must be available: `file`, `strings`, `unzip`, `tar`, `7z` (or `7zz`/`bsdtar` as fallbacks)
- For `.lz4`, `.br`, `.lzfse`: `lz4cat`, `brotli`, `lzfse` must be installed
- `strings` is part of `binutils` on Linux; available via Homebrew on macOS

---

## See Also

- [Local Tools Reference](https://github.com/bgauryy/octocode/blob/main/docs/mcp/tools/LOCAL_TOOLS.md)
- [Configuration Reference](https://github.com/bgauryy/octocode/blob/main/docs/mcp/CONFIGURATION.md)
