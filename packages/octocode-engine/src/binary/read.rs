//! Bounded file reads for the binary lane.
//!
//! We parse and scan untrusted binaries, so reads are always capped: a 250MB
//! Electron framework or a hostile multi-GB file must never balloon engine
//! memory. The caller gets the prefix plus a `truncated` flag, never an OOM.

use std::fs::File;
use std::io::Read;

/// Read at most `cap` bytes of `path`. Returns the bytes plus whether the file
/// was longer than `cap` (i.e. the buffer is a truncated prefix).
pub fn read_capped(path: &str, cap: usize) -> Result<(Vec<u8>, bool), String> {
    let mut file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;

    // Read up to cap+1 so we can tell "exactly cap" from "more than cap".
    let mut buf = Vec::new();
    let read = file
        .by_ref()
        .take((cap as u64).saturating_add(1))
        .read_to_end(&mut buf)
        .map_err(|e| format!("cannot read {path}: {e}"))?;

    let truncated = read > cap;
    if truncated {
        buf.truncate(cap);
    }
    Ok((buf, truncated))
}
