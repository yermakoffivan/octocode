use std::collections::HashMap;

use napi_derive::napi;

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
