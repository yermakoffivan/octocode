use napi_derive::napi;

/// Structural inspection of a binary (executable / object / archive) file.
///
/// `format`/`arch`/`bits`/`endianness`/`stripped` are always populated (the
/// fields the old `identify` mode produced). The list fields are populated only
/// when the file is a recognized executable format `goblin` could parse; for an
/// unrecognized file they stay empty and `notes` explains why (e.g. "use
/// mode=list/decompress for archives").
///
/// Every list is capped (see `crate::binary::inspect::LIST_CAP`); the `*_count`
/// fields carry the true totals, and `truncated` is set when any list was cut.
#[napi(object)]
pub struct BinaryInspectInfo {
    /// elf | macho | macho-fat | pe | coff | archive | wasm | unknown
    pub format: String,
    /// Human-readable one-line summary (drop-in for `file -b`).
    pub description: String,
    /// Space-separated hex of the leading bytes (drop-in for `xxd -p -l 32`).
    pub magic_hex: String,
    pub arch: Option<String>,
    pub bits: Option<u32>,
    /// "little" | "big"
    pub endianness: Option<String>,
    pub stripped: Option<bool>,
    /// Hex entry-point address, when the format has one.
    pub entry: Option<String>,
    pub symbols: Vec<String>,
    pub imports: Vec<String>,
    pub exports: Vec<String>,
    pub sections: Vec<String>,
    /// Dynamic dependencies / needed shared libraries.
    pub libraries: Vec<String>,
    pub symbol_count: u32,
    pub import_count: u32,
    pub export_count: u32,
    /// True when any list was capped.
    pub truncated: bool,
    /// Advisory notes (unrecognized format, parse degradation, size truncation).
    pub notes: Vec<String>,
}

/// Result of a strings extraction pass over a binary buffer.
#[napi(object)]
pub struct BinaryStrings {
    /// Printable runs, longest-first. ASCII **and** UTF-16 (LE/BE) — the win
    /// over GNU `strings -a`, which misses wide strings. Each entry is prefixed
    /// with its hex byte offset when offsets were requested.
    pub strings: Vec<String>,
    /// Total runs found before any display capping.
    pub total_found: u32,
    /// True when more of the file remains to scan beyond this window — follow
    /// `next_scan_offset`. Lossless continuation cursor, **not** a data-loss
    /// flag (the old fixed-cap meaning): every byte is reachable by paging.
    pub truncated: bool,
    /// Absolute byte offset to start the next scan window, or `None` at EOF.
    /// Rewound to a safe break so no string is split across windows.
    pub next_scan_offset: Option<u32>,
}
