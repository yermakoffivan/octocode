//! Bounded file reads for the binary lane.
//!
//! We parse and scan untrusted binaries, so reads are always capped: a 250MB
//! Electron framework or a hostile multi-GB file must never balloon engine
//! memory. The caller gets the prefix plus a `truncated` flag, never an OOM.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

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

/// Read a window of up to `len` bytes from `path` starting at byte `offset`.
/// Returns the bytes plus `at_eof` — true when the window reaches the end of
/// the file (so the caller knows there is nothing left to page to). Used by the
/// lossless strings scan-pagination path, which advances `offset` window by
/// window instead of capping and discarding the tail.
pub fn read_window(path: &str, offset: u64, len: usize) -> Result<(Vec<u8>, bool), String> {
    let mut file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let file_size = file
        .metadata()
        .map_err(|e| format!("cannot stat {path}: {e}"))?
        .len();

    if offset >= file_size {
        return Ok((Vec::new(), true));
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("cannot seek {path}: {e}"))?;

    let mut buf = Vec::new();
    let read = file
        .by_ref()
        .take(len as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("cannot read {path}: {e}"))?;

    let at_eof = offset.saturating_add(read as u64) >= file_size;
    Ok((buf, at_eof))
}
