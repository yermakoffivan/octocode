use napi::{Error, Result, Status};
use napi_derive::napi;

/// Native binary inspection (format lane). Parses `path` as an executable /
/// object / archive and returns its identity plus — for recognized executable
/// formats — symbols, imports, exports, sections and dynamic dependencies.
///
/// Replaces the `file` + `xxd` shell-outs. Never throws on malformed input: a
/// parse failure degrades to magic-byte identity with an explanatory note. The
/// only `Err` cases are unreadable / oversized files.
#[napi(js_name = "inspectBinaryNative")]
pub fn inspect_binary_native(path: String) -> Result<crate::binary::BinaryInspectInfo> {
    // `goblin` is explicitly not hardened against malicious input, so an unwind
    // across the napi FFI boundary (which would abort Node) is contained here —
    // the same guard the structural/signature paths use.
    std::panic::catch_unwind(|| crate::binary::inspect(&path))
        .unwrap_or_else(|_| Err("binary inspection failed on pathological input".to_string()))
        .map_err(|message| Error::new(Status::InvalidArg, message))
}

/// Native strings extraction. Recovers printable ASCII **and** UTF-16 (LE/BE)
/// runs of at least `min_length` from the scan window of `path` beginning at
/// `scan_offset`, longest-first, optionally hex offset-prefixed. Replaces the
/// `strings` shell-out and additionally surfaces the wide strings GNU
/// `strings -a` misses.
///
/// Lossless pagination: the returned `nextScanOffset` (when set) is the absolute
/// byte offset of the next window, rewound to a safe break so no string is split
/// across windows. Pass `scanOffset = 0` for the first window.
#[napi(js_name = "extractBinaryStringsNative")]
pub fn extract_binary_strings_native(
    path: String,
    min_length: u32,
    include_offsets: bool,
    scan_offset: u32,
) -> Result<crate::binary::BinaryStrings> {
    std::panic::catch_unwind(|| {
        crate::binary::strings(&path, min_length, include_offsets, scan_offset)
    })
    .unwrap_or_else(|_| Err("strings extraction failed on pathological input".to_string()))
    .map_err(|message| Error::new(Status::InvalidArg, message))
}
