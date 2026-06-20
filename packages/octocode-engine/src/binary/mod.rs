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

/// Extract printable ASCII + UTF-16 strings (≥ `min_len`) from `path`,
/// longest-first, optionally prefixed with hex byte offsets.
pub fn strings(path: &str, min_len: u32, include_offsets: bool) -> Result<BinaryStrings, String> {
    let (buf, truncated) = read::read_capped(path, strings::SCAN_CAP)?;
    Ok(strings::extract(&buf, min_len as usize, include_offsets, truncated))
}
