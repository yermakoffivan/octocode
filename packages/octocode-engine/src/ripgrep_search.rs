//! In-process ripgrep search.
//!
//! Octocode is its own source of ripgrep: instead of shelling out to an `rg`
//! binary (and bundling one via `@vscode/ripgrep`), this module drives
//! ripgrep's own library crates directly —
//!   * `grep` (grep-searcher + grep-regex + grep-printer) for the search engine,
//!   * the `pcre2` feature (grep-pcre2) for `-P` lookaround/backreferences,
//!   * `ignore` for the gitignore-aware walk, `-g` override globs and `-t` types.
//!
//! It replicates every flag the old `RipgrepCommandBuilder` emitted and returns
//! the exact `RipgrepParseResult` shape the `--json` parser produced, so the
//! result is byte-identical to the previous `rg --json` execution path.

use std::path::Path;
use std::time::SystemTime;

use grep::matcher::Matcher;
use grep::pcre2::RegexMatcherBuilder as Pcre2MatcherBuilder;
use grep::regex::RegexMatcherBuilder;
use grep::searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkContext, SinkMatch};
use ignore::overrides::OverrideBuilder;
use ignore::types::TypesBuilder;
use ignore::WalkBuilder;
use napi::{Error, Result, Status};

use crate::ripgrep_parser::{assemble_file, strip_trailing_newline, FileEntry, RawMatch};
use crate::types::{RipgrepFile, RipgrepParseResult, RipgrepSearchOptions, RipgrepStats};
use crate::utf8_offsets::byte_to_char_offset_inner;

const DEFAULT_MAX_SNIPPET_CHARS: u32 = 500;

fn to_napi_err<E: std::fmt::Display>(e: E) -> Error {
    Error::new(Status::GenericFailure, e.to_string())
}

/// Output mode. The CLI builder applied these with a fixed precedence
/// (filesOnly → filesWithoutMatch → countMatches → countLines → normal); we
/// mirror that precedence so conflicting flags resolve identically.
#[derive(Clone, Copy, PartialEq)]
enum Mode {
    FilesOnly,
    FilesWithoutMatch,
    CountMatches,
    CountLines,
    Normal,
}

fn resolve_mode(opts: &RipgrepSearchOptions) -> Mode {
    if opts.files_only.unwrap_or(false) {
        Mode::FilesOnly
    } else if opts.files_without_match.unwrap_or(false) {
        Mode::FilesWithoutMatch
    } else if opts.count_matches_per_file.unwrap_or(false) {
        Mode::CountMatches
    } else if opts.count_lines_per_file.unwrap_or(false) {
        Mode::CountLines
    } else {
        Mode::Normal
    }
}

/// Per-file collected state from a single `Searcher` pass.
struct FileRec {
    path: String,
    entry: FileEntry,
    /// Number of matching (or, with `-v`, non-matching) lines reported.
    matched_lines: u32,
    /// Number of individual matches (submatches) across all matched lines.
    submatches: u32,
    /// Metadata timestamp captured for non-path sort keys.
    sort_time: Option<SystemTime>,
}

/// `grep_searcher::Sink` that accumulates matches/contexts for one file and,
/// using the matcher, derives the 0-based UTF-16 column of the first submatch.
struct CollectSink<'a, M: Matcher> {
    matcher: &'a M,
    entry: &'a mut FileEntry,
    submatches: u32,
    matched_lines: u32,
}

impl<M: Matcher> Sink for CollectSink<'_, M> {
    type Error = std::io::Error;

    fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> std::io::Result<bool> {
        let line_number = mat.line_number().unwrap_or(0) as u32;
        let bytes = mat.bytes();
        let line_cow = String::from_utf8_lossy(bytes);
        let line_text = strip_trailing_newline(&line_cow).to_owned();

        // rg reports the submatch start as a BYTE offset within the line; convert
        // to a 0-based UTF-16 char column so multibyte lines line up with JS
        // string indices (mirrors the --json parser's column convention).
        let byte_col = self
            .matcher
            .find(bytes)
            .ok()
            .flatten()
            .map(|m| m.start())
            .unwrap_or(0);
        let column = byte_to_char_offset_inner(&line_text, byte_col) as u32;

        // Count submatches on this line for --count-matches. A matched line has
        // at least one match even if find_iter is conservative.
        let mut count: u32 = 0;
        let _ = self.matcher.find_iter(bytes, |_m| {
            count = count.saturating_add(1);
            true
        });
        self.submatches = self.submatches.saturating_add(count.max(1));
        self.matched_lines = self.matched_lines.saturating_add(1);

        self.entry.raw_matches.push(RawMatch {
            line_text,
            line_number,
            column,
        });
        Ok(true)
    }

    fn context(&mut self, _searcher: &Searcher, ctx: &SinkContext<'_>) -> std::io::Result<bool> {
        let line_number = ctx.line_number().unwrap_or(0) as u32;
        let line_cow = String::from_utf8_lossy(ctx.bytes());
        let line_text = strip_trailing_newline(&line_cow).to_owned();
        self.entry.contexts.insert(line_number, line_text);
        Ok(true)
    }
}

/// Build the gitignore-aware walker with `-g` overrides, `-t` types, hidden and
/// no-ignore handling. Single-threaded: we sort results ourselves afterwards to
/// reproduce `--sort`/`--sortr` deterministically.
fn build_walk(opts: &RipgrepSearchOptions) -> Result<ignore::Walk> {
    let mut wb = WalkBuilder::new(&opts.path);
    let no_ignore = opts.no_ignore.unwrap_or(false);
    wb.ignore(!no_ignore)
        .git_ignore(!no_ignore)
        .git_global(!no_ignore)
        .git_exclude(!no_ignore)
        .parents(!no_ignore)
        // hidden(true) means "skip hidden"; rg searches them only with --hidden.
        .hidden(!opts.hidden.unwrap_or(false))
        .follow_links(false);

    if let Some(lang) = opts.lang_type.as_deref().filter(|l| !l.is_empty()) {
        let mut tb = TypesBuilder::new();
        tb.add_defaults();
        tb.select(lang);
        wb.types(tb.build().map_err(to_napi_err)?);
    }

    let has_globs = opts.include.as_ref().is_some_and(|v| !v.is_empty())
        || opts.exclude.as_ref().is_some_and(|v| !v.is_empty())
        || opts.exclude_dir.as_ref().is_some_and(|v| !v.is_empty());
    if has_globs {
        let mut ob = OverrideBuilder::new(&opts.path);
        if let Some(include) = &opts.include {
            for glob in include {
                ob.add(glob).map_err(to_napi_err)?;
            }
        }
        if let Some(exclude) = &opts.exclude {
            for glob in exclude {
                ob.add(&format!("!{glob}")).map_err(to_napi_err)?;
            }
        }
        if let Some(exclude_dir) = &opts.exclude_dir {
            for dir in exclude_dir {
                ob.add(&format!("!{dir}/")).map_err(to_napi_err)?;
            }
        }
        wb.overrides(ob.build().map_err(to_napi_err)?);
    }

    Ok(wb.build())
}

fn capture_sort_time(opts: &RipgrepSearchOptions, entry: &ignore::DirEntry) -> Option<SystemTime> {
    match opts.sort.as_deref() {
        Some("modified") => entry.metadata().ok()?.modified().ok(),
        Some("accessed") => entry.metadata().ok()?.accessed().ok(),
        Some("created") => entry.metadata().ok()?.created().ok(),
        _ => None,
    }
}

/// Run the walk + per-file search for a concrete matcher type, returning the
/// collected records plus the total number of files searched.
fn collect<M: Matcher>(
    opts: &RipgrepSearchOptions,
    matcher: &M,
    mode: Mode,
) -> Result<(Vec<FileRec>, u32)> {
    let context_lines = if mode == Mode::Normal {
        opts.context_lines.unwrap_or(0)
    } else {
        0
    };

    let mut sb = SearcherBuilder::new();
    sb.line_number(true)
        .binary_detection(BinaryDetection::quit(b'\x00'));
    if opts.multiline.unwrap_or(false) {
        sb.multi_line(true);
    }
    if opts.invert_match.unwrap_or(false) {
        sb.invert_match(true);
    }
    if context_lines > 0 {
        sb.before_context(context_lines as usize);
        sb.after_context(context_lines as usize);
    }
    let mut searcher = sb.build();

    let keep_unmatched = mode == Mode::FilesWithoutMatch;
    let mut recs: Vec<FileRec> = Vec::new();
    let mut files_searched: u32 = 0;

    for dent in build_walk(opts)? {
        let dent = match dent {
            Ok(d) => d,
            Err(_) => continue,
        };
        if !dent.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path: &Path = dent.path();

        let mut entry = FileEntry::new();
        let (submatches, matched_lines) = {
            let mut sink = CollectSink {
                matcher,
                entry: &mut entry,
                submatches: 0,
                matched_lines: 0,
            };
            // Per-file IO errors (permission denied, mid-file invalid UTF-8 under
            // PCRE2 utf mode, etc.) just skip that file — rg behaves the same.
            if searcher.search_path(matcher, path, &mut sink).is_err() {
                continue;
            }
            (sink.submatches, sink.matched_lines)
        };
        files_searched += 1;

        let has_match = matched_lines > 0;
        if has_match == keep_unmatched {
            // Normal/files-only/count modes keep matched files; files-without-match
            // keeps the rest.
            continue;
        }

        recs.push(FileRec {
            path: dent.path().to_string_lossy().into_owned(),
            entry,
            matched_lines,
            submatches,
            sort_time: capture_sort_time(opts, &dent),
        });
    }

    Ok((recs, files_searched))
}

fn sort_recs(opts: &RipgrepSearchOptions, recs: &mut [FileRec]) {
    match opts.sort.as_deref() {
        Some("modified") | Some("accessed") | Some("created") => {
            recs.sort_by_key(|r| r.sort_time);
        }
        // Default and explicit "path": lexicographic by full path, matching
        // `rg --sort path`.
        _ => recs.sort_by(|a, b| a.path.cmp(&b.path)),
    }
    if opts.sort_reverse.unwrap_or(false) {
        recs.reverse();
    }
}

fn build_result(
    opts: &RipgrepSearchOptions,
    mode: Mode,
    mut recs: Vec<FileRec>,
    files_searched: u32,
) -> RipgrepParseResult {
    sort_recs(opts, &mut recs);

    let context_lines = opts.context_lines.unwrap_or(0);
    let max_snippet = opts
        .max_snippet_chars
        .unwrap_or(DEFAULT_MAX_SNIPPET_CHARS) as usize;

    let files_matched = recs.len() as u32;
    let total_submatches: u32 = recs.iter().map(|r| r.submatches).sum();
    let total_matched_lines: u32 = recs.iter().map(|r| r.matched_lines).sum();

    let files: Vec<RipgrepFile> = recs
        .into_iter()
        .map(|r| match mode {
            Mode::Normal => assemble_file(r.path, &r.entry, context_lines, max_snippet),
            // files-only / files-without-match: path list, matchCount 1, no
            // snippets — exactly what the old plain-text parser produced.
            Mode::FilesOnly | Mode::FilesWithoutMatch => RipgrepFile {
                path: r.path,
                match_count: 1,
                matches: Vec::new(),
            },
            Mode::CountLines => RipgrepFile {
                path: r.path,
                match_count: r.matched_lines,
                matches: Vec::new(),
            },
            Mode::CountMatches => RipgrepFile {
                path: r.path,
                match_count: r.submatches,
                matches: Vec::new(),
            },
        })
        .collect();

    let stats = match mode {
        Mode::Normal => RipgrepStats {
            match_count: Some(total_submatches),
            matched_lines: Some(total_matched_lines),
            files_matched: Some(files_matched),
            files_searched: Some(files_searched),
            bytes_searched: None,
            search_time: None,
        },
        Mode::CountLines => RipgrepStats {
            match_count: Some(total_matched_lines),
            ..RipgrepStats::default()
        },
        Mode::CountMatches => RipgrepStats {
            match_count: Some(total_submatches),
            ..RipgrepStats::default()
        },
        // files-only / files-without-match emitted no stats in the old parser.
        Mode::FilesOnly | Mode::FilesWithoutMatch => RipgrepStats::default(),
    };

    RipgrepParseResult { files, stats }
}

/// Build the appropriate matcher (default Rust regex, or PCRE2 for `-P`) and run
/// the search. `fixed_string` is honored by escaping the pattern for the regex
/// engine; the CLI gave `-F` precedence over `-P`, so PCRE2 only applies when
/// `fixed_string` is not set.
pub(crate) fn search(opts: RipgrepSearchOptions) -> Result<RipgrepParseResult> {
    let mode = resolve_mode(&opts);

    let case_sensitive = opts.case_sensitive.unwrap_or(false);
    let case_insensitive = !case_sensitive && opts.case_insensitive.unwrap_or(false);
    // Default (neither -s nor -i): smart-case, matching the builder's `-S`.
    let smart_case = !case_sensitive && !opts.case_insensitive.unwrap_or(false);
    let whole_word = opts.whole_word.unwrap_or(false);
    let multiline = opts.multiline.unwrap_or(false);
    let dotall = multiline && opts.multiline_dotall.unwrap_or(false);
    let fixed_string = opts.fixed_string.unwrap_or(false);
    let perl_regex = !fixed_string && opts.perl_regex.unwrap_or(false);

    if perl_regex {
        let mut b = Pcre2MatcherBuilder::new();
        b.caseless(case_insensitive)
            .case_smart(smart_case)
            .word(whole_word)
            .multi_line(multiline)
            .dotall(dotall)
            .crlf(true)
            .utf(true)
            .ucp(true)
            .jit_if_available(true);
        let matcher = b.build(&opts.pattern).map_err(to_napi_err)?;
        let (recs, searched) = collect(&opts, &matcher, mode)?;
        Ok(build_result(&opts, mode, recs, searched))
    } else {
        let mut b = RegexMatcherBuilder::new();
        b.case_insensitive(case_insensitive)
            .case_smart(smart_case)
            .word(whole_word)
            .multi_line(multiline)
            .dot_matches_new_line(dotall);
        let pattern = if fixed_string {
            regex::escape(&opts.pattern)
        } else {
            opts.pattern.clone()
        };
        let matcher = b.build(&pattern).map_err(to_napi_err)?;
        let (recs, searched) = collect(&opts, &matcher, mode)?;
        Ok(build_result(&opts, mode, recs, searched))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Unique temp dir per test (no Date/rand needed): pid + atomic counter.
    struct TmpDir(PathBuf);
    impl TmpDir {
        fn new() -> Self {
            let id = COUNTER.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir().join(format!("octo-rg-test-{}-{id}", std::process::id()));
            fs::create_dir_all(&dir).expect("create temp dir");
            TmpDir(dir)
        }
        fn write(&self, rel: &str, content: &str) {
            let p = self.0.join(rel);
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent).expect("create parent");
            }
            fs::write(p, content).expect("write file");
        }
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }
    impl Drop for TmpDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn opts(path: String, pattern: &str) -> RipgrepSearchOptions {
        RipgrepSearchOptions {
            path,
            pattern: pattern.to_owned(),
            ..Default::default()
        }
    }

    #[test]
    fn finds_matches_with_line_and_column() {
        let t = TmpDir::new();
        t.write("a.txt", "hello world\nno match here\nhello again\n");
        let r = search(opts(t.path(), "hello")).expect("search ok");
        assert_eq!(r.files.len(), 1);
        let f = &r.files[0];
        assert_eq!(f.match_count, 2);
        assert_eq!(f.matches[0].line, 1);
        assert_eq!(f.matches[0].column, 0);
        assert_eq!(f.matches[0].value, "hello world");
        assert_eq!(f.matches[1].line, 3);
        assert_eq!(r.stats.match_count, Some(2));
        assert_eq!(r.stats.files_matched, Some(1));
    }

    #[test]
    fn column_is_utf16_offset_on_multibyte_line() {
        let t = TmpDir::new();
        // 'b' is at byte 8 but UTF-16 index 7 ('é' is 2 bytes).
        t.write("u.txt", "café = bar\n");
        let r = search(opts(t.path(), "bar")).expect("ok");
        assert_eq!(r.files[0].matches[0].column, 7);
    }

    #[test]
    fn smart_case_default_is_case_insensitive_for_lowercase() {
        let t = TmpDir::new();
        t.write("a.txt", "Hello\nhello\n");
        let r = search(opts(t.path(), "hello")).expect("ok");
        assert_eq!(r.files[0].match_count, 2);
    }

    #[test]
    fn case_sensitive_flag_is_exact() {
        let t = TmpDir::new();
        t.write("a.txt", "Hello\nhello\n");
        let mut o = opts(t.path(), "hello");
        o.case_sensitive = Some(true);
        let r = search(o).expect("ok");
        assert_eq!(r.files[0].match_count, 1);
    }

    #[test]
    fn fixed_string_treats_pattern_literally() {
        let t = TmpDir::new();
        t.write("a.txt", "a.b\naxb\n");
        let mut o = opts(t.path(), "a.b");
        o.fixed_string = Some(true);
        let r = search(o).expect("ok");
        // Literal "a.b" matches only line 1, not "axb".
        assert_eq!(r.files[0].match_count, 1);
        assert_eq!(r.files[0].matches[0].value, "a.b");
    }

    #[test]
    fn perl_regex_supports_lookahead() {
        let t = TmpDir::new();
        t.write("a.txt", "foobar\nfoobaz\n");
        let mut o = opts(t.path(), "foo(?=bar)");
        o.perl_regex = Some(true);
        let r = search(o).expect("ok");
        assert_eq!(r.files[0].match_count, 1);
        assert_eq!(r.files[0].matches[0].line, 1);
    }

    #[test]
    fn files_only_lists_paths_without_snippets() {
        let t = TmpDir::new();
        t.write("a.txt", "needle\n");
        t.write("b.txt", "haystack\n");
        let mut o = opts(t.path(), "needle");
        o.files_only = Some(true);
        let r = search(o).expect("ok");
        assert_eq!(r.files.len(), 1);
        assert_eq!(r.files[0].match_count, 1);
        assert!(r.files[0].matches.is_empty());
        assert!(r.files[0].path.ends_with("a.txt"));
    }

    #[test]
    fn files_without_match_inverts_file_set() {
        let t = TmpDir::new();
        t.write("a.txt", "needle\n");
        t.write("b.txt", "haystack\n");
        let mut o = opts(t.path(), "needle");
        o.files_without_match = Some(true);
        let r = search(o).expect("ok");
        assert_eq!(r.files.len(), 1);
        assert!(r.files[0].path.ends_with("b.txt"));
    }

    #[test]
    fn count_matches_counts_submatches_per_file() {
        let t = TmpDir::new();
        t.write("a.txt", "x x x\nx\n");
        let mut o = opts(t.path(), "x");
        o.count_matches_per_file = Some(true);
        let r = search(o).expect("ok");
        assert_eq!(r.files[0].match_count, 4);
        assert_eq!(r.stats.match_count, Some(4));
    }

    #[test]
    fn count_lines_counts_matched_lines_per_file() {
        let t = TmpDir::new();
        t.write("a.txt", "x x x\nx\nnope\n");
        let mut o = opts(t.path(), "x");
        o.count_lines_per_file = Some(true);
        let r = search(o).expect("ok");
        assert_eq!(r.files[0].match_count, 2);
    }

    #[test]
    fn context_lines_are_assembled_into_snippet() {
        let t = TmpDir::new();
        t.write("a.txt", "before\nmatch\nafter\n");
        let mut o = opts(t.path(), "match");
        o.context_lines = Some(1);
        let r = search(o).expect("ok");
        let v = &r.files[0].matches[0].value;
        assert!(v.contains("before") && v.contains("match") && v.contains("after"), "{v}");
    }

    #[test]
    fn lang_type_filters_by_extension() {
        let t = TmpDir::new();
        t.write("a.ts", "target\n");
        t.write("b.py", "target\n");
        let mut o = opts(t.path(), "target");
        o.lang_type = Some("ts".to_owned());
        let r = search(o).expect("ok");
        assert_eq!(r.files.len(), 1);
        assert!(r.files[0].path.ends_with("a.ts"));
    }

    #[test]
    fn include_glob_restricts_files() {
        let t = TmpDir::new();
        t.write("a.ts", "target\n");
        t.write("b.js", "target\n");
        let mut o = opts(t.path(), "target");
        o.include = Some(vec!["*.ts".to_owned()]);
        let r = search(o).expect("ok");
        assert_eq!(r.files.len(), 1);
        assert!(r.files[0].path.ends_with("a.ts"));
    }

    #[test]
    fn exclude_dir_prunes_directory() {
        let t = TmpDir::new();
        t.write("keep/a.txt", "target\n");
        t.write("skip/b.txt", "target\n");
        let mut o = opts(t.path(), "target");
        o.exclude_dir = Some(vec!["skip".to_owned()]);
        let r = search(o).expect("ok");
        assert_eq!(r.files.len(), 1);
        assert!(r.files[0].path.contains("keep"));
    }

    #[test]
    fn results_are_sorted_by_path() {
        let t = TmpDir::new();
        t.write("z.txt", "m\n");
        t.write("a.txt", "m\n");
        t.write("m.txt", "m\n");
        let r = search(opts(t.path(), "m")).expect("ok");
        let paths: Vec<&str> = r.files.iter().map(|f| f.path.as_str()).collect();
        let mut sorted = paths.clone();
        sorted.sort_unstable();
        assert_eq!(paths, sorted);
    }

    #[test]
    fn sort_reverse_flips_order() {
        let t = TmpDir::new();
        t.write("a.txt", "m\n");
        t.write("z.txt", "m\n");
        let mut o = opts(t.path(), "m");
        o.sort_reverse = Some(true);
        let r = search(o).expect("ok");
        assert!(r.files[0].path.ends_with("z.txt"));
        assert!(r.files[1].path.ends_with("a.txt"));
    }

    #[test]
    fn respects_gitignore_by_default_and_no_ignore_overrides() {
        let t = TmpDir::new();
        // The `ignore` crate (like rg) only applies .gitignore inside a git repo
        // (require_git defaults true); a bare `.git` dir marks the temp tree as one.
        fs::create_dir_all(t.0.join(".git")).expect("create .git");
        t.write(".gitignore", "ignored.txt\n");
        t.write("ignored.txt", "target\n");
        t.write("kept.txt", "target\n");

        let r = search(opts(t.path(), "target")).expect("ok");
        assert_eq!(r.files.len(), 1, "gitignore'd file should be skipped");
        assert!(r.files[0].path.ends_with("kept.txt"));

        let mut o = opts(t.path(), "target");
        o.no_ignore = Some(true);
        let r2 = search(o).expect("ok");
        assert_eq!(r2.files.len(), 2, "--no-ignore searches the ignored file");
    }

    #[test]
    fn whole_word_requires_word_boundary() {
        let t = TmpDir::new();
        t.write("a.txt", "foo\nfoobar\n");
        let mut o = opts(t.path(), "foo");
        o.whole_word = Some(true);
        let r = search(o).expect("ok");
        assert_eq!(r.files[0].match_count, 1);
        assert_eq!(r.files[0].matches[0].line, 1);
    }

    #[test]
    fn empty_result_when_no_match() {
        let t = TmpDir::new();
        t.write("a.txt", "nothing here\n");
        let r = search(opts(t.path(), "absent")).expect("ok");
        assert!(r.files.is_empty());
    }
}
