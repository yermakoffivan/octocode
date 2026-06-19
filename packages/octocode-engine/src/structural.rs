//! Structural (AST) search over the tree-sitter grammars we already link.
//!
//! This is octocode's L2 search layer: it answers shape questions ripgrep
//! can't (a call shaped `foo($X)`, an `eval()` call site that is NOT inside a
//! comment/string) and that LSP is too heavy for. The matcher is
//! `ast-grep-core`; the grammars are the exact `tree_sitter::Language` values
//! in [`crate::signatures::languages`] — no second grammar set, no link
//! collision.
//!
//! Two query surfaces, mirroring ast-grep:
//!   * `pattern` — a code-shaped pattern (`console.log($$$)`). Metavars: `$X`
//!     is one node, `$$$ARGS` is a list.
//!   * `rule` — a YAML relational/composite rule object (`not`/`has`/`inside`/
//!     `all`/`any`), the only surface that can express negation and
//!     parent/child relationships.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use napi_derive::napi;

use ast_grep_config::{from_str, DeserializeEnv, SerializableRuleCore};
use ast_grep_core::language::Language;
use ast_grep_core::matcher::{PatternBuilder, PatternError};
use ast_grep_core::meta_var::MetaVariable;
use ast_grep_core::tree_sitter::{LanguageExt, StrDoc, TSLanguage};
use ast_grep_core::{NodeMatch, Pattern};

use crate::signatures::languages;

/// One structural match. Line numbers are 1-based so `start_line` can be fed
/// directly as an `lspGetSemantics` `lineHint`; columns are 0-based char
/// offsets (tree-sitter native).
#[napi(object)]
pub struct StructuralMatch {
    pub start_line: u32,
    pub end_line: u32,
    pub start_col: u32,
    pub end_col: u32,
    pub text: String,
    /// Captured metavariables. `$X` yields a single-element list;
    /// `$$$ARGS` yields the full list of captured nodes. Keyed by the bare
    /// metavar name (no leading `$`).
    pub metavars: HashMap<String, Vec<String>>,
}

#[napi(object)]
pub struct StructuralSearchFilesOptions {
    pub path: String,
    pub pattern: Option<String>,
    pub rule: Option<String>,
    pub include: Option<Vec<String>>,
    pub exclude_dir: Option<Vec<String>>,
    pub max_files: Option<u32>,
    pub max_file_bytes: Option<u32>,
}

#[napi(object)]
pub struct StructuralSearchFileResult {
    pub path: String,
    pub matches: Vec<StructuralMatch>,
}

#[napi(object)]
pub struct StructuralSearchFilesResult {
    pub files: Vec<StructuralSearchFileResult>,
    pub total_matches: u32,
    pub parsed_files: u32,
    pub skipped_by_pre_filter: u32,
    pub skipped_unreadable: u32,
    pub skipped_large: u32,
    pub warnings: Vec<String>,
}

/// A tree-sitter language wrapped so ast-grep can drive it. A single wrapper
/// covers every grammar — the only per-language knob is `expando_char`, the
/// stand-in identifier char used while parsing a pattern in languages where
/// `$` is not a valid identifier character (Rust/Go/Python/C/…). Values match
/// the `ast-grep-language` crate so pattern semantics are identical (KPI #2).
#[derive(Clone)]
struct AgLanguage {
    ts: TSLanguage,
    expando: char,
}

impl Language for AgLanguage {
    fn kind_to_id(&self, kind: &str) -> u16 {
        self.ts.id_for_node_kind(kind, /* named */ true)
    }

    fn field_to_id(&self, field: &str) -> Option<u16> {
        self.ts.field_id_for_name(field).map(|f| f.get())
    }

    fn expando_char(&self) -> char {
        self.expando
    }

    fn pre_process_pattern<'q>(&self, query: &'q str) -> Cow<'q, str> {
        pre_process_pattern(self.expando, query)
    }

    fn build_pattern(&self, builder: &PatternBuilder) -> Result<Pattern, PatternError> {
        builder.build(|src| StrDoc::try_new(src, self.clone()))
    }
}

impl LanguageExt for AgLanguage {
    fn get_ts_language(&self) -> TSLanguage {
        self.ts.clone()
    }
}

/// The stand-in identifier char for `$` metavariables, per language. Mirrors
/// `ast-grep-language`: languages where `$` is a legal identifier char
/// (JS/TS/Java/Bash) keep `$`; the rest get a char the grammar accepts.
fn expando_for_ext(ext: &str) -> char {
    match ext {
        // `$` is a valid identifier character → no substitution needed.
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "java" | "sh" | "bash" | "zsh" => '$',
        // C / C++ accept this CJK code point as an identifier start.
        "c" | "h" | "cpp" | "cc" | "cxx" | "hpp" | "hh" | "hxx" => '\u{10000}',
        // HTML: tree-sitter-html's tagName scanner uses locale-dependent
        // `iswalnum`, which rejects the micro sign — so a plain ASCII `z` is the
        // only reliable expando for tag-name metavars (matches ast-grep-language).
        "html" | "htm" => 'z',
        // CSS family: `$` is SCSS's own variable sigil, so it can't double as the
        // metavar expando. `_` is a valid identifier-start in all three dialects
        // and is exactly what ast-grep-language uses for CSS (SCSS/LESS inherit).
        "css" | "scss" | "less" => '_',
        // Scala: `$` is reserved (string interpolation / synthetic names), so it
        // can't be the expando. The micro sign is a Unicode lowercase letter,
        // which Scala (and tree-sitter-scala) accept as an identifier char —
        // matches the `ast-grep-language` default.
        "scala" | "sc" | "sbt" => '\u{00b5}',
        // Go / Rust / Python / C# accept the micro sign as an identifier char.
        _ => '\u{00b5}',
    }
}

/// Verbatim port of `ast-grep-language::pre_process_pattern`: rewrites the
/// `$` sigil of capturing/anonymous-multiple metavars to the language's
/// expando char so the tree-sitter parser accepts the pattern. Literal `$`
/// (e.g. a non-metavar `$` in the source) is preserved.
fn pre_process_pattern(expando: char, query: &str) -> Cow<'_, str> {
    let mut ret = Vec::with_capacity(query.len());
    let mut dollar_count = 0;
    for c in query.chars() {
        if c == '$' {
            dollar_count += 1;
            continue;
        }
        let need_replace = matches!(c, 'A'..='Z' | '_') // $A or $$A or $$$A
            || dollar_count == 3; // anonymous multiple
        let sigil = if need_replace { expando } else { '$' };
        ret.extend(std::iter::repeat_n(sigil, dollar_count));
        dollar_count = 0;
        ret.push(c);
    }
    // trailing anonymous multiple
    let sigil = if dollar_count == 3 { expando } else { '$' };
    ret.extend(std::iter::repeat_n(sigil, dollar_count));
    Cow::Owned(ret.into_iter().collect())
}

/// Convert one ast-grep match into the napi-facing struct, pulling every
/// captured metavar out of the match environment. `$X` → single (one-element
/// list via `get_match`); `$$$ARGS` → list (via `get_multiple_matches`).
fn to_match(m: &NodeMatch<StrDoc<AgLanguage>>) -> StructuralMatch {
    let node = m.get_node();
    let start = node.start_pos();
    let end = node.end_pos();

    let env = m.get_env();
    let mut metavars: HashMap<String, Vec<String>> = HashMap::new();
    for var in env.get_matched_variables() {
        match var {
            MetaVariable::Capture(id, _) => {
                if let Some(matched) = env.get_match(&id) {
                    metavars.insert(id, vec![matched.text().to_string()]);
                }
            }
            MetaVariable::MultiCapture(id) => {
                let texts = env
                    .get_multiple_matches(&id)
                    .iter()
                    .map(|n| n.text().to_string())
                    .collect();
                metavars.insert(id, texts);
            }
            // Dropped (`$_`) / anonymous Multiple (`$$$`) are not captured.
            _ => {}
        }
    }

    StructuralMatch {
        start_line: (start.line() as u32) + 1,
        end_line: (end.line() as u32) + 1,
        start_col: start.column(node) as u32,
        end_col: end.column(node) as u32,
        text: node.text().to_string(),
        metavars,
    }
}

/// Run a structural search over `content`, parsed with the grammar resolved
/// from `ext`. Exactly one of `pattern` / `rule` must be `Some`.
///
/// Returns `Err` for: an unsupported extension, an invalid pattern, invalid
/// rule YAML, or both/neither query supplied — the napi layer maps these to a
/// JS error so the caller can surface guidance instead of a silent empty set.
pub fn supported_extensions() -> Vec<String> {
    languages::supported_extensions()
        .into_iter()
        .map(str::to_owned)
        .collect()
}

pub fn search(
    content: &str,
    ext: &str,
    pattern: Option<&str>,
    rule: Option<&str>,
) -> Result<Vec<StructuralMatch>, String> {
    let entry = languages::find_entry(ext)
        .ok_or_else(|| format!("structural search does not support .{ext} files"))?;
    let lang = AgLanguage {
        ts: entry.language.clone(),
        expando: expando_for_ext(ext),
    };

    let grep = lang.ast_grep(content);
    let root = grep.root();
    let mut out = Vec::new();

    match (pattern, rule) {
        (Some(p), None) => {
            if p.trim().is_empty() {
                return Err("pattern must not be empty".to_string());
            }
            let pat = Pattern::try_new(p, lang.clone())
                .map_err(|e| format!("invalid structural pattern: {e}"))?;
            for m in root.find_all(&pat) {
                out.push(to_match(&m));
            }
        }
        (None, Some(r)) => {
            if r.trim().is_empty() {
                return Err("rule must not be empty".to_string());
            }
            let env = DeserializeEnv::new(lang.clone());
            let serialized: SerializableRuleCore =
                from_str(r).map_err(|e| format!("invalid rule YAML: {e}"))?;
            let matcher = serialized
                .get_matcher(env)
                .map_err(|e| format!("invalid rule: {e}"))?;
            for m in root.find_all(&matcher) {
                out.push(to_match(&m));
            }
        }
        (Some(_), Some(_)) => {
            return Err("provide either `pattern` or `rule`, not both".to_string());
        }
        (None, None) => {
            return Err("structural search requires `pattern` or `rule`".to_string());
        }
    }

    Ok(out)
}

pub fn search_files(
    options: StructuralSearchFilesOptions,
) -> Result<StructuralSearchFilesResult, String> {
    let root = PathBuf::from(&options.path);
    let pattern = options.pattern.as_deref();
    let rule = options.rule.as_deref();
    validate_query_shape(pattern, rule)?;

    let include = options.include.unwrap_or_default();
    let exclude_dir = options.exclude_dir.unwrap_or_else(default_exclude_dirs);
    let max_files = options.max_files.map(|n| n as usize).unwrap_or(2_000);
    let max_file_bytes = options.max_file_bytes.map(|n| n as u64).unwrap_or(1_000_000);
    let anchor = pattern.and_then(derive_literal_anchor);

    let mut candidate_files = Vec::new();
    collect_candidate_files(&root, &include, &exclude_dir, max_files, &mut candidate_files)?;

    let mut files = Vec::new();
    let mut total_matches = 0u32;
    let mut parsed_files = 0u32;
    let mut skipped_by_pre_filter = 0u32;
    let mut skipped_unreadable = 0u32;
    let mut skipped_large = 0u32;
    let mut warnings = Vec::new();

    for file_path in candidate_files {
        let metadata = match fs::metadata(&file_path) {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped_unreadable += 1;
                continue;
            }
        };
        if metadata.len() > max_file_bytes {
            skipped_large += 1;
            continue;
        }

        let content = match fs::read_to_string(&file_path) {
            Ok(content) => content,
            Err(_) => {
                skipped_unreadable += 1;
                continue;
            }
        };

        if anchor.is_some_and(|literal| !content.contains(literal)) {
            skipped_by_pre_filter += 1;
            continue;
        }

        let ext = extension_for_path(&file_path).unwrap_or_default();
        let matches = search(&content, &ext, pattern, rule)?;
        parsed_files += 1;
        if matches.is_empty() {
            continue;
        }
        total_matches = total_matches.saturating_add(matches.len() as u32);
        files.push(StructuralSearchFileResult {
            path: file_path.to_string_lossy().to_string(),
            matches,
        });
    }

    if anchor.is_none() {
        warnings.push(format!(
            "No literal anchor in the {} — parsed all {parsed_files} candidate file(s) with no text pre-filter.",
            if rule.is_some() { "rule" } else { "pattern" }
        ));
    } else if skipped_by_pre_filter > 0 {
        warnings.push(format!(
            "Pre-filter skipped parsing {skipped_by_pre_filter} file(s); parsed {parsed_files}."
        ));
    }
    if skipped_unreadable > 0 {
        warnings.push(format!(
            "Skipped {skipped_unreadable} unreadable or vanished candidate file(s)."
        ));
    }
    if skipped_large > 0 {
        warnings.push(format!(
            "Skipped {skipped_large} candidate file(s) larger than {max_file_bytes} bytes."
        ));
    }

    Ok(StructuralSearchFilesResult {
        files,
        total_matches,
        parsed_files,
        skipped_by_pre_filter,
        skipped_unreadable,
        skipped_large,
        warnings,
    })
}

fn validate_query_shape(pattern: Option<&str>, rule: Option<&str>) -> Result<(), String> {
    match (pattern, rule) {
        (Some(p), None) if p.trim().is_empty() => Err("pattern must not be empty".to_string()),
        (None, Some(r)) if r.trim().is_empty() => Err("rule must not be empty".to_string()),
        (Some(_), None) | (None, Some(_)) => Ok(()),
        (Some(_), Some(_)) => Err("provide either `pattern` or `rule`, not both".to_string()),
        (None, None) => Err("structural search requires `pattern` or `rule`".to_string()),
    }
}

fn default_exclude_dirs() -> Vec<String> {
    ["node_modules", "dist", ".git", "build", "coverage", ".next", "out", "target"]
        .into_iter()
        .map(str::to_owned)
        .collect()
}

fn collect_candidate_files(
    root: &Path,
    include: &[String],
    exclude_dir: &[String],
    max_files: usize,
    out: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if out.len() >= max_files {
        return Ok(());
    }
    let metadata = fs::metadata(root).map_err(|err| {
        format!(
            "Cannot access structural search path '{}': {err}",
            root.display()
        )
    })?;
    if metadata.is_file() {
        if path_matches_include(root, include) {
            out.push(root.to_path_buf());
        }
        return Ok(());
    }
    if !metadata.is_dir() {
        return Ok(());
    }

    let entries = fs::read_dir(root).map_err(|err| {
        format!(
            "Cannot read structural search directory '{}': {err}",
            root.display()
        )
    })?;
    for entry in entries {
        if out.len() >= max_files {
            break;
        }
        let entry = entry.map_err(|err| format!("Cannot read structural search entry: {err}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|err| {
                format!(
                    "Cannot inspect structural search entry '{}': {err}",
                    path.display()
                )
            })?;
        let name = entry.file_name().to_string_lossy().to_string();
        if file_type.is_dir() {
            if exclude_dir.iter().any(|dir| dir == &name) {
                continue;
            }
            collect_candidate_files(&path, include, exclude_dir, max_files, out)?;
        } else if file_type.is_file() && path_matches_include(&path, include) {
            out.push(path);
        }
    }
    Ok(())
}

fn path_matches_include(path: &Path, include: &[String]) -> bool {
    if include.is_empty() {
        return extension_for_path(path).is_some_and(|ext| languages::find_entry(&ext).is_some());
    }
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or_default();
    include.iter().any(|pattern| glob_matches_name(pattern, name))
}

fn extension_for_path(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
}

fn glob_matches_name(pattern: &str, name: &str) -> bool {
    if let Some(ext) = pattern.strip_prefix("*.") {
        return name.ends_with(&format!(".{ext}"));
    }
    pattern == name
}

fn derive_literal_anchor(pattern: &str) -> Option<&str> {
    let mut best: Option<&str> = None;
    for token in pattern.split(|ch: char| !(ch == '_' || ch.is_ascii_alphanumeric())) {
        if token.len() < 3 || token.chars().all(|ch| ch.is_ascii_uppercase()) {
            continue;
        }
        if best.is_none_or(|current| token.len() > current.len()) {
            best = Some(token);
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "octocode_structural_{}_{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn run_pattern(src: &str, ext: &str, pattern: &str) -> Vec<StructuralMatch> {
        search(src, ext, Some(pattern), None).expect("pattern search should succeed")
    }

    #[test]
    fn finds_call_and_captures_single_metavar() {
        let src = "const a = foo(bar);\nconst b = foo(baz);\n";
        let matches = run_pattern(src, "ts", "foo($X)");
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].start_line, 1);
        assert_eq!(matches[0].metavars.get("X").map(Vec::as_slice), Some(&["bar".to_string()][..]));
        assert_eq!(matches[1].metavars.get("X").map(Vec::as_slice), Some(&["baz".to_string()][..]));
    }

    #[test]
    fn captures_multi_metavar_as_list() {
        let src = "log(1, 2, 3);\n";
        let matches = run_pattern(src, "js", "log($$$ARGS)");
        assert_eq!(matches.len(), 1);
        // ast-grep's `$$$` captures EVERY node in the list, separators
        // included — matching the CLI exactly (KPI #2). We deliberately do not
        // strip the commas.
        assert_eq!(
            matches[0].metavars.get("ARGS").map(Vec::as_slice),
            Some(&["1".to_string(), ",".to_string(), "2".to_string(), ",".to_string(), "3".to_string()][..])
        );
    }

    #[test]
    fn comment_and_string_immunity() {
        // KPI #1: a literal `eval(x)` inside a comment and inside a string must
        // NOT match — only the real call site (line 3) does.
        let src = "// eval(evil)\nconst s = \"eval(evil)\";\neval(real);\n";
        let matches = run_pattern(src, "js", "eval($X)");
        assert_eq!(matches.len(), 1, "only the real call site matches");
        assert_eq!(matches[0].start_line, 3);
        assert_eq!(matches[0].metavars.get("X").map(Vec::as_slice), Some(&["real".to_string()][..]));
    }

    #[test]
    fn python_pattern_with_expando_char() {
        // Python's expando char is µ, not $ — exercises pre_process_pattern.
        let src = "print(hello)\nprint(world)\n";
        let matches = run_pattern(src, "py", "print($X)");
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].metavars.get("X").map(Vec::as_slice), Some(&["hello".to_string()][..]));
    }

    #[test]
    fn rust_pattern_with_expando_char() {
        let src = "fn main() {\n    println(a);\n    println(b);\n}\n";
        let matches = run_pattern(src, "rs", "println($X)");
        assert_eq!(matches.len(), 2);
    }

    #[test]
    fn relational_rule_inside_function() {
        // KPI: a rule that plain patterns cannot express — `await` calls that
        // are `inside` a for-loop. `stopBy: end` walks all ancestors.
        let src = "async function f() {\n  for (const x of xs) {\n    await g(x);\n  }\n  await h();\n}\n";
        let rule = "rule:\n  pattern: await $C\n  inside:\n    kind: for_in_statement\n    stopBy: end\n";
        let matches = search(src, "ts", None, Some(rule)).expect("rule search should succeed");
        assert_eq!(matches.len(), 1, "only the await inside the for-loop matches");
        assert_eq!(matches[0].start_line, 3);
    }

    #[test]
    fn unsupported_extension_errors() {
        match search("x", "zzz", Some("foo()"), None) {
            Err(e) => assert!(e.contains("does not support")),
            Ok(_) => panic!("expected an unsupported-extension error"),
        }
    }

    #[test]
    fn supported_extensions_are_rust_owned() {
        let exts = supported_extensions();
        assert!(exts.iter().any(|ext| ext == "ts"));
        assert!(exts.iter().any(|ext| ext == "rs"));
    }

    #[test]
    fn search_files_finds_matches_and_prefilters_non_matching_files() {
        let root = temp_root("files");
        fs::write(root.join("a.ts"), "target(value);\n").expect("write a");
        fs::write(root.join("b.ts"), "other(value);\n").expect("write b");
        fs::write(root.join("note.txt"), "target(value);\n").expect("write txt");

        let result = search_files(StructuralSearchFilesOptions {
            path: root.to_string_lossy().to_string(),
            pattern: Some("target($X)".to_owned()),
            rule: None,
            include: None,
            exclude_dir: None,
            max_files: Some(10),
            max_file_bytes: None,
        })
        .expect("search files");

        assert_eq!(result.total_matches, 1);
        assert_eq!(result.files.len(), 1);
        assert!(result.files[0].path.ends_with("a.ts"));
        assert_eq!(result.skipped_by_pre_filter, 1);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn search_files_respects_excluded_directories_and_large_file_limit() {
        let root = temp_root("filters");
        fs::create_dir_all(root.join("src")).expect("src");
        fs::create_dir_all(root.join("node_modules/pkg")).expect("node_modules");
        fs::write(root.join("src/a.ts"), "target(v);\n").expect("write a");
        fs::write(root.join("src/large.ts"), "target(value);\n").expect("write large");
        fs::write(root.join("node_modules/pkg/b.ts"), "target(value);\n").expect("write b");

        let result = search_files(StructuralSearchFilesOptions {
            path: root.to_string_lossy().to_string(),
            pattern: Some("target($X)".to_owned()),
            rule: None,
            include: Some(vec!["*.ts".to_owned()]),
            exclude_dir: Some(vec!["node_modules".to_owned()]),
            max_files: Some(10),
            max_file_bytes: Some(14),
        })
        .expect("search files");

        assert_eq!(result.total_matches, 1);
        assert_eq!(result.skipped_large, 1);
        assert_eq!(result.files.len(), 1);
        assert!(result.files[0].path.ends_with("src/a.ts"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn search_files_accepts_single_file_root() {
        let root = temp_root("single");
        let file = root.join("a.ts");
        fs::write(&file, "target(value);\n").expect("write file");

        let result = search_files(StructuralSearchFilesOptions {
            path: file.to_string_lossy().to_string(),
            pattern: Some("target($X)".to_owned()),
            rule: None,
            include: None,
            exclude_dir: None,
            max_files: None,
            max_file_bytes: None,
        })
        .expect("search file");

        assert_eq!(result.total_matches, 1);
        assert_eq!(result.files.len(), 1);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn both_or_neither_query_errors() {
        assert!(search("x", "ts", Some("a"), Some("b")).is_err());
        assert!(search("x", "ts", None, None).is_err());
    }

    #[test]
    fn invalid_pattern_errors() {
        assert!(search("x", "ts", Some("   "), None).is_err());
    }

    // ── markup / style grammars (HTML/CSS/SCSS/LESS) ──────────────────────────

    #[test]
    fn css_pattern_captures_declaration_value() {
        // Expando is `_`, so `$C` → `_C`, a valid CSS identifier.
        let src = ".btn {\n  color: red;\n}\n";
        let matches = run_pattern(src, "css", ".btn { color: $C; }");
        assert_eq!(matches.len(), 1);
        assert_eq!(
            matches[0].metavars.get("C").map(Vec::as_slice),
            Some(&["red".to_string()][..])
        );
    }

    #[test]
    fn css_rule_matches_by_kind() {
        // A `rule` surface needs no expando — match every rule_set.
        let src = ".a { color: red; }\n.b { color: blue; }\n";
        let rule = "rule:\n  kind: rule_set\n";
        let matches = search(src, "css", None, Some(rule)).expect("css rule search");
        assert_eq!(matches.len(), 2);
    }

    #[test]
    fn scss_pattern_matches_and_keeps_literal_lowercase_var() {
        // Lowercase `$base` is a literal SCSS variable (NOT replaced — only
        // `$UPPER`/`$$$` become metavars), so it must match verbatim while `$C`
        // captures the property value.
        let src = ".card {\n  color: $base;\n}\n";
        let matches = run_pattern(src, "scss", ".card { color: $base; }");
        assert_eq!(matches.len(), 1, "literal $base preserved as a real var");

        let captured = run_pattern(src, "scss", ".card { color: $C; }");
        assert_eq!(captured.len(), 1);
        assert_eq!(
            captured[0].metavars.get("C").map(Vec::as_slice),
            Some(&["$base".to_string()][..])
        );
    }

    #[test]
    fn less_pattern_matches_rule() {
        let src = ".box {\n  width: 10px;\n}\n";
        let matches = run_pattern(src, "less", ".box { width: $W; }");
        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn html_tag_name_metavar_resolves_with_z_expando() {
        // The reason HTML's expando is `z`, not `µ`: tree-sitter-html's tagName
        // scanner rejects non-ASCII, so a tag-name metavar only works with `z`.
        let src = "<input>\n";
        let matches = run_pattern(src, "html", "<$TAG>");
        assert_eq!(matches.len(), 1);
        assert_eq!(
            matches[0].metavars.get("TAG").map(Vec::as_slice),
            Some(&["input".to_string()][..])
        );
    }

    #[test]
    fn html_element_pattern_matches_nested_tag() {
        let src = "<section>\n  <button id=\"go\">Click</button>\n</section>\n";
        let matches = run_pattern(src, "html", "<button id=\"go\">$$$</button>");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].start_line, 2);
    }

    #[test]
    fn markup_and_style_extensions_are_supported() {
        let exts = supported_extensions();
        for ext in ["html", "htm", "css", "scss", "less"] {
            assert!(exts.iter().any(|e| e == ext), "structural search must support .{ext}");
        }
    }

    // ── Scala ─────────────────────────────────────────────────────────────────

    #[test]
    fn scala_pattern_captures_call_argument() {
        // Expando is µ, so `$X` → `µX`, a valid Scala identifier.
        let src = "object M {\n  def f() = { println(hello); println(world) }\n}\n";
        let matches = run_pattern(src, "scala", "println($X)");
        assert_eq!(matches.len(), 2);
        assert_eq!(
            matches[0].metavars.get("X").map(Vec::as_slice),
            Some(&["hello".to_string()][..])
        );
    }

    #[test]
    fn scala_comment_and_string_immunity() {
        // KPI #1: a `println(evil)` in a comment and in a string must NOT match.
        let src = "object M {\n  // println(evil)\n  val s = \"println(evil)\"\n  def go() = println(real)\n}\n";
        let matches = run_pattern(src, "scala", "println($X)");
        assert_eq!(matches.len(), 1, "only the real call site matches");
        assert_eq!(
            matches[0].metavars.get("X").map(Vec::as_slice),
            Some(&["real".to_string()][..])
        );
    }

    #[test]
    fn scala_extensions_are_supported() {
        let exts = supported_extensions();
        for ext in ["scala", "sc", "sbt"] {
            assert!(exts.iter().any(|e| e == ext), "structural search must support .{ext}");
        }
    }
}
