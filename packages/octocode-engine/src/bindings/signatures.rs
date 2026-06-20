use napi::{Error, Result, Status};
use napi_derive::napi;

/// Native exports.
#[napi]
pub const SIGNATURES_ONLY_HINT: &str = crate::signatures::SIGNATURES_ONLY_HINT;

/// Structural skeleton with an `NNN| ` line-number gutter, produced purely by
/// tree-sitter parsing (no regex heuristics). Returns `null` for data/config
/// formats, any language without a wired grammar, content above the 1MB guard,
/// and any skeleton that would not be smaller than the source.
#[napi(js_name = "extractSignatures")]
pub fn extract_signatures(content: String, file_path: String) -> Option<String> {
    crate::signatures::extract_signatures_inner(&content, &file_path)
}

/// Native JS/TS document symbols (server-free) as a JSON `DocumentSymbol[]`.
///
/// Parses ECMAScript/TypeScript *syntax* with `oxc_parser` and walks
/// declarations into the LSP `DocumentSymbol` shape (nested, numeric
/// `SymbolKind`, 0-based UTF-16 ranges). **No type inference** — in-file
/// scope/binding accuracy only; type-aware outlines still require a language
/// server. Only `ts/tsx/js/jsx/mjs/cjs/mts/cts` are handled.
///
/// Returns `null` for non-JS/TS files, oversized content, a hard parse failure
/// (caller should fall back to `extractSignatures`/tree-sitter), or a file with
/// no extractable top-level symbols.
#[napi(js_name = "extractJsSymbols")]
pub fn extract_js_symbols(content: String, file_path: String) -> Option<String> {
    crate::signatures::js_oxc::extract_js_symbols(&content, &file_path)
}

/// Canonical list of file extensions (lowercase, no leading dot) handled by the
/// native oxc JS/TS path (`extractJsSymbols` / `findInFileReferences`). Callers
/// should gate native dispatch on this list rather than hardcoding it, so the
/// Rust and JS sides never drift.
#[napi(js_name = "getSupportedJsTsExtensions")]
pub fn get_supported_js_ts_extensions() -> Vec<String> {
    crate::file_extension::JS_TS_EXTENSIONS
        .iter()
        .map(|ext| (*ext).to_owned())
        .collect()
}

/// Native in-file references (server-free) for the JS/TS symbol under
/// `(line, character)` (0-based, UTF-16), as a JSON `Range[]` covering the
/// declaration and every resolved in-file reference (declaration first).
///
/// **Same-file only.** oxc resolves bindings within one module; cross-file
/// references require a language server. No type inference. Returns `null` for
/// non-JS/TS files, oversized content, a parse failure, or when the cursor is
/// not on a resolvable binding/reference.
#[napi(js_name = "findInFileReferences")]
pub fn find_in_file_references(
    content: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Option<String> {
    crate::signatures::js_oxc::find_in_file_references(&content, &file_path, line, character)
}

/// Structural (AST) search — octocode's L2 layer. Resolves the grammar from
/// `file_path`'s extension and matches a code-shaped `pattern` OR a YAML `rule`
/// (exactly one). Returns node ranges (1-based lines, ready as `lineHint`s)
/// plus captured metavariables. Throws on unsupported extension, invalid
/// pattern/rule, or both/neither query supplied.
#[napi(js_name = "structuralSearch")]
pub fn structural_search(
    content: String,
    file_path: String,
    pattern: Option<String>,
    rule: Option<String>,
) -> Result<Vec<crate::structural::StructuralMatch>> {
    let ext = crate::file_extension::get_extension_internal(&file_path, true, "txt");
    // Contain tree-sitter matcher panics on pathological input: an unwind
    // across the napi FFI boundary would abort the Node process. Mirror the
    // panic guards used in `apply.rs` / signature extraction.
    let outcome = std::panic::catch_unwind(|| {
        crate::structural::search(&content, &ext, pattern.as_deref(), rule.as_deref())
    })
    .unwrap_or_else(|_| Err("structural search failed on pathological input".to_string()));
    outcome.map_err(|message| Error::new(Status::InvalidArg, message))
}

#[napi(js_name = "structuralSearchFiles")]
pub fn structural_search_files(
    options: crate::structural::StructuralSearchFilesOptions,
) -> Result<crate::structural::StructuralSearchFilesResult> {
    std::panic::catch_unwind(|| crate::structural::search_files(options))
        .unwrap_or_else(|_| Err("structural file search failed on pathological input".to_string()))
        .map_err(|message| Error::new(Status::InvalidArg, message))
}

#[napi(js_name = "getSupportedStructuralExtensions")]
pub fn get_supported_structural_extensions() -> Vec<String> {
    crate::structural::supported_extensions()
}

/// Returns a sorted list of JS char offsets (UTF-16 code units) where
/// top-level semantic blocks begin in `content`.
///
/// **Tree-sitter only** (exact AST): `ts tsx js jsx mjs cjs mts cts py pyi go rs
///   java c h cpp cc cxx hpp hh hxx cs sh bash zsh`. Languages without a wired
/// grammar and structural-only grammars (HTML/CSS/Scala/JSON/YAML/TOML) return
/// `[]` — there is no regex/heuristic fallback. Also `[]` for data/config files,
/// plain text, and files above the 1 MB guard.
///
/// Char offsets match JavaScript `string.substring()` — pass them directly to
/// JavaScript string slicing without conversion.
#[napi(js_name = "getSemanticBoundaryOffsets")]
pub fn get_semantic_boundary_offsets(content: String, file_path: String) -> Vec<u32> {
    crate::signatures::get_semantic_boundary_offsets_inner(&content, &file_path)
}

/// Returns all extensions that have signature-outline support. This is exactly
/// the set of tree-sitter grammars with a function-body query (no regex
/// heuristics): structural-only grammars (HTML/CSS/Scala/JSON/YAML/TOML) are
/// excluded because they produce no outline.
#[napi(js_name = "getSupportedSignatureExtensions")]
pub fn get_supported_signature_extensions() -> Vec<String> {
    let mut exts: Vec<String> = crate::signatures::languages::signature_extensions()
        .into_iter()
        .map(str::to_owned)
        .collect();
    exts.sort();
    exts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_signature_extensions_are_tree_sitter_only_and_sorted() {
        let exts = get_supported_signature_extensions();
        for required in ["ts", "py", "rs", "go", "java"] {
            assert!(exts.iter().any(|e| e == required), "missing {required}");
        }
        for absent in [
            "vue", "svelte", "md", "markdown", "lua", "sql", "html", "scala",
        ] {
            assert!(
                !exts.iter().any(|e| e == absent),
                "{absent} must not have a signature outline (no grammar / structural-only)"
            );
        }
        let mut sorted = exts.clone();
        sorted.sort();
        assert_eq!(exts, sorted, "extension list must be sorted");
    }
}
