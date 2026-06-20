//! Binary inspection — octocode's **format lane**, native.
//!
//! Replaces the `file` / `xxd` / `strings` shell-outs with one portable Rust
//! path: no GNU binutils/coreutils dependency (so it works on Windows and
//! distroless/Alpine Linux), parser-stable structured output, UTF-16-aware
//! strings, and structural inspection (symbols/imports/exports/sections/deps)
//! that the binutils path could never do.
//!
//! The **container lane** (archive listing/extraction, decompression) stays in
//! TypeScript shell-outs — `goblin` parses executable formats, it does not
//! extract zip/tar/gzip.

mod inspect;
mod read;
mod strings;
mod types;

pub use types::{BinaryInspectInfo, BinaryStrings};

/// Parse `path` and return its structural identity + (when it is a recognized
/// executable) symbols/imports/exports/sections/dynamic-deps.
pub fn inspect(path: &str) -> Result<BinaryInspectInfo, String> {
    let (buf, truncated) = read::read_capped(path, inspect::MAX_FILE)?;
    Ok(inspect::inspect(&buf, truncated))
}

/// Extract printable ASCII + UTF-16 strings (≥ `min_len`) from the scan window
/// of `path` beginning at `scan_offset`, longest-first, optionally prefixed with
/// **absolute** hex byte offsets.
///
/// Scans one `SCAN_WINDOW`-sized window and returns a `next_scan_offset` cursor
/// (rewound to a safe break) so the whole file is reachable losslessly by
/// paging — no string is split across windows, and nothing past a fixed cap is
/// silently discarded.
pub fn strings(
    path: &str,
    min_len: u32,
    include_offsets: bool,
    scan_offset: u32,
) -> Result<BinaryStrings, String> {
    let (buf, at_eof) = read::read_window(path, scan_offset as u64, strings::SCAN_WINDOW)?;
    Ok(strings::extract(
        &buf,
        min_len as usize,
        include_offsets,
        scan_offset,
        at_eof,
    ))
}
