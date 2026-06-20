use std::borrow::Cow;

use tree_sitter::Language as TSLanguage;

use crate::signatures::languages::LanguageEntry;

/// A tree-sitter language wrapper. A single wrapper covers every grammar; the
/// only per-language knob is `expando_char`, the stand-in identifier char used
/// while parsing a pattern in languages where `$` is not a valid identifier
/// character (Rust/Go/Python/C/...).
#[derive(Clone)]
pub(super) struct AgLanguage {
    ts: TSLanguage,
    expando: char,
}

impl AgLanguage {
    pub(super) fn new(ext: &str, entry: &LanguageEntry) -> Self {
        Self {
            ts: entry.language.clone(),
            expando: expando_for_ext(ext),
        }
    }

    pub(super) fn tree_sitter_language(&self) -> TSLanguage {
        self.ts.clone()
    }

    pub(super) fn expando_char_value(&self) -> char {
        self.expando
    }

    pub(super) fn preprocess_pattern<'query>(&self, query: &'query str) -> Cow<'query, str> {
        pre_process_pattern(self.expando, query)
    }
}

/// The stand-in identifier char for `$` metavariables, per language. Languages
/// where `$` is a legal identifier char (JS/TS/Java/Bash) keep `$`; the rest get
/// a char the grammar accepts.
fn expando_for_ext(ext: &str) -> char {
    match ext {
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs" | "java" | "sh" | "bash"
        | "zsh" => '$',
        "c" | "h" | "cpp" | "cc" | "cxx" | "hpp" | "hh" | "hxx" => '\u{10000}',
        "html" | "htm" => 'z',
        "css" | "scss" | "less" => '_',
        "scala" | "sc" | "sbt" => '\u{00b5}',
        _ => '\u{00b5}',
    }
}

/// Rewrites the `$` sigil of capturing/anonymous-multiple metavars to the
/// language's expando char so the tree-sitter parser accepts the pattern.
/// Literal `$` (e.g. a non-metavar `$` in the source) is preserved.
fn pre_process_pattern(expando: char, query: &str) -> Cow<'_, str> {
    let mut ret = Vec::with_capacity(query.len());
    let mut dollar_count = 0;
    for c in query.chars() {
        if c == '$' {
            dollar_count += 1;
            continue;
        }
        let need_replace = matches!(c, 'A'..='Z' | '_') || dollar_count == 3;
        let sigil = if need_replace { expando } else { '$' };
        ret.extend(std::iter::repeat_n(sigil, dollar_count));
        dollar_count = 0;
        ret.push(c);
    }
    let sigil = if dollar_count == 3 { expando } else { '$' };
    ret.extend(std::iter::repeat_n(sigil, dollar_count));
    Cow::Owned(ret.into_iter().collect())
}
