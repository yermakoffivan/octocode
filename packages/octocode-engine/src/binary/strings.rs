//! Printable-string extraction over a raw byte buffer.
//!
//! Unlike GNU `strings -a` (ASCII only), this also recovers UTF-16LE/BE runs,
//! which dominate PE/Windows binaries — the correctness win that motivated the
//! native path. A single linear scan per encoding; no allocation until a run is
//! confirmed long enough.

use super::types::BinaryStrings;

/// Files larger than this are scanned only over their leading prefix. Native
/// reading is fast, so this is generous (the old `strings` shell-out capped at
/// 32MB); the caller surfaces `truncated`.
pub const SCAN_CAP: usize = 64 * 1024 * 1024;

/// Hard ceiling on how many runs we materialize, so a buffer that is almost
/// entirely printable cannot blow up memory. The true count is reported
/// separately.
const MAX_RUNS: usize = 200_000;

#[inline]
fn is_printable_ascii(b: u8) -> bool {
    // Graphic ASCII plus space and tab — matches the intent of `strings`.
    b == b'\t' || (0x20..=0x7e).contains(&b)
}

struct Found {
    offset: usize,
    text: String,
}

/// Extract ASCII runs of at least `min_len` printable bytes.
fn scan_ascii(buf: &[u8], min_len: usize, out: &mut Vec<Found>) {
    let mut start = 0usize;
    let mut len = 0usize;
    for (i, &b) in buf.iter().enumerate() {
        if is_printable_ascii(b) {
            if len == 0 {
                start = i;
            }
            len += 1;
        } else {
            if len >= min_len {
                push_run(buf, start, i, out);
            }
            len = 0;
        }
        if out.len() >= MAX_RUNS {
            return;
        }
    }
    if len >= min_len {
        push_run(buf, start, buf.len(), out);
    }
}

fn push_run(buf: &[u8], start: usize, end: usize, out: &mut Vec<Found>) {
    let text = String::from_utf8_lossy(&buf[start..end]).into_owned();
    out.push(Found { offset: start, text });
}

/// Extract UTF-16 runs. `lead_zero_first == true` scans big-endian (00 XX);
/// otherwise little-endian (XX 00). A run is a sequence of printable ASCII code
/// points encoded as 2-byte units; `min_len` is in characters.
fn scan_utf16(buf: &[u8], min_len: usize, lead_zero_first: bool, out: &mut Vec<Found>) {
    let n = buf.len();
    let mut i = 0usize;
    while i + 1 < n {
        let (hi, lo) = if lead_zero_first {
            (buf[i], buf[i + 1])
        } else {
            (buf[i + 1], buf[i])
        };
        // Candidate start: zero high byte + printable low byte.
        if hi == 0 && is_printable_ascii(lo) {
            let start = i;
            let mut chars = String::new();
            let mut j = i;
            while j + 1 < n {
                let (h, l) = if lead_zero_first {
                    (buf[j], buf[j + 1])
                } else {
                    (buf[j + 1], buf[j])
                };
                if h == 0 && is_printable_ascii(l) {
                    chars.push(l as char);
                    j += 2;
                } else {
                    break;
                }
            }
            if chars.len() >= min_len {
                out.push(Found { offset: start, text: chars });
                if out.len() >= MAX_RUNS {
                    return;
                }
            }
            i = j.max(i + 2);
        } else {
            i += 1;
        }
    }
}

/// Scan `buf` for printable ASCII and UTF-16 strings of at least `min_len`,
/// returning them longest-first. `include_offsets` prefixes each entry with its
/// hex byte offset (mirrors `strings -t x`). `truncated` marks a prefix-only
/// scan of an oversized file.
pub fn extract(buf: &[u8], min_len: usize, include_offsets: bool, truncated: bool) -> BinaryStrings {
    let min_len = min_len.max(1);
    let mut found: Vec<Found> = Vec::new();

    scan_ascii(buf, min_len, &mut found);
    if found.len() < MAX_RUNS {
        scan_utf16(buf, min_len, false, &mut found); // UTF-16LE
    }
    if found.len() < MAX_RUNS {
        scan_utf16(buf, min_len, true, &mut found); // UTF-16BE
    }

    let total_found = found.len() as u32;

    // Longest-first surfaces the most meaningful strings; the byte offset is a
    // stable tiebreaker so output is deterministic.
    found.sort_by(|a, b| b.text.len().cmp(&a.text.len()).then(a.offset.cmp(&b.offset)));

    let strings = found
        .into_iter()
        .map(|f| {
            if include_offsets {
                format!("{:#010x}: {}", f.offset, f.text)
            } else {
                f.text
            }
        })
        .collect();

    BinaryStrings { strings, total_found, truncated }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_ascii_runs_above_min_length() {
        let buf = b"\x00\x01hello world\x00ab\x00longer_string_here\xff";
        let r = extract(buf, 5, false, false);
        // "hello world" and "longer_string_here" qualify; "ab" does not.
        assert!(r.strings.iter().any(|s| s == "hello world"));
        assert!(r.strings.iter().any(|s| s == "longer_string_here"));
        assert!(!r.strings.iter().any(|s| s == "ab"));
        // Longest-first ordering.
        assert_eq!(r.strings[0], "longer_string_here");
    }

    #[test]
    fn recovers_utf16le_strings_that_gnu_strings_misses() {
        // "WIDE" as UTF-16LE: 57 00 49 00 44 00 45 00
        let buf = b"\x57\x00\x49\x00\x44\x00\x45\x00\xff\xff";
        let r = extract(buf, 4, false, false);
        assert!(r.strings.iter().any(|s| s == "WIDE"), "got {:?}", r.strings);
    }

    #[test]
    fn recovers_utf16be_strings() {
        // "WIDE" as UTF-16BE: 00 57 00 49 00 44 00 45
        let buf = b"\x00\x57\x00\x49\x00\x44\x00\x45\xff\xff";
        let r = extract(buf, 4, false, false);
        assert!(r.strings.iter().any(|s| s == "WIDE"), "got {:?}", r.strings);
    }

    #[test]
    fn offsets_are_prefixed_when_requested() {
        let buf = b"\x00\x00abcdef";
        let r = extract(buf, 4, true, false);
        assert_eq!(r.strings.len(), 1);
        assert!(r.strings[0].starts_with("0x00000002: abcdef"), "got {:?}", r.strings);
    }

    #[test]
    fn empty_when_nothing_meets_min_length() {
        let buf = b"\x00\x01\x02ab\x03";
        let r = extract(buf, 8, false, false);
        assert_eq!(r.total_found, 0);
        assert!(r.strings.is_empty());
    }
}
