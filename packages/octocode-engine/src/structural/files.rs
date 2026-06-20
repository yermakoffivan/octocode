use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use ignore::overrides::{Override, OverrideBuilder};
use ignore::WalkBuilder;

use super::language::AgLanguage;
use super::matcher::compile_matcher;
use super::query::StructuralQuery;
use super::types::{
    StructuralSearchFileResult, StructuralSearchFilesOptions, StructuralSearchFilesResult,
};
use crate::signatures::languages;

pub fn search_files(
    options: StructuralSearchFilesOptions,
) -> Result<StructuralSearchFilesResult, String> {
    let root = PathBuf::from(&options.path);
    let query = StructuralQuery::new(options.pattern.as_deref(), options.rule.as_deref())?;

    let include = options.include.unwrap_or_default();
    let exclude_dir = options.exclude_dir.unwrap_or_else(default_exclude_dirs);
    let max_files = options.max_files.map(|n| n as usize).unwrap_or(2_000);
    let max_file_bytes = options
        .max_file_bytes
        .map(|n| n as u64)
        .unwrap_or(1_000_000);
    let anchor = query.literal_anchor();

    let overrides = build_overrides(&root, &include)?;
    let candidate_files = collect_candidate_files(&root, overrides, &exclude_dir, max_files)?;

    let mut by_ext: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    for path in candidate_files {
        let ext = extension_for_path(&path).unwrap_or_default();
        by_ext.entry(ext).or_default().push(path);
    }

    let mut files = Vec::new();
    let mut total_matches = 0u32;
    let mut parsed_files = 0u32;
    let mut skipped_by_pre_filter = 0u32;
    let mut skipped_unreadable = 0u32;
    let mut skipped_large = 0u32;
    let mut warnings = Vec::new();

    for (ext, paths) in by_ext {
        let Some(entry) = languages::find_entry(&ext) else {
            continue;
        };
        let lang = AgLanguage::new(&ext, entry);
        let run = compile_matcher(&lang, query)?;

        for file_path in paths {
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

            let matches = run(&content);
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
    }

    if anchor.is_none() {
        warnings.push(format!(
            "No literal anchor in the {} — parsed all {parsed_files} candidate file(s) with no text pre-filter.",
            if query.is_rule() { "rule" } else { "pattern" }
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

fn default_exclude_dirs() -> Vec<String> {
    [
        "node_modules",
        "dist",
        ".git",
        "build",
        "coverage",
        ".next",
        "out",
        "target",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

/// Compile the `include` patterns into a gitignore-style override set, rooted at
/// the search path so relative globs like `src/**/*.ts` resolve as users expect.
fn build_overrides(root: &Path, include: &[String]) -> Result<Override, String> {
    let mut builder = OverrideBuilder::new(root);
    for glob in include {
        builder
            .add(glob)
            .map_err(|err| format!("invalid include glob '{glob}': {err}"))?;
    }
    builder
        .build()
        .map_err(|err| format!("failed to compile include globs: {err}"))
}

/// Walk `root` with ripgrep's own `ignore` engine and yields deterministic
/// candidate paths whose extension a grammar can parse.
fn collect_candidate_files(
    root: &Path,
    overrides: Override,
    exclude_dir: &[String],
    max_files: usize,
) -> Result<Vec<PathBuf>, String> {
    let metadata = fs::metadata(root).map_err(|err| {
        format!(
            "Cannot access structural search path '{}': {err}",
            root.display()
        )
    })?;

    if metadata.is_file() {
        return Ok(if file_is_candidate(root, &overrides) {
            vec![root.to_path_buf()]
        } else {
            Vec::new()
        });
    }
    if !metadata.is_dir() {
        return Ok(Vec::new());
    }

    let excluded: HashSet<String> = exclude_dir.iter().cloned().collect();
    let mut builder = WalkBuilder::new(root);
    builder
        .overrides(overrides)
        .sort_by_file_path(|a, b| a.cmp(b))
        .filter_entry(move |entry| {
            if entry.depth() == 0 {
                return true;
            }
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                let name = entry.file_name().to_string_lossy();
                return !excluded.contains(name.as_ref());
            }
            true
        });

    let mut out = Vec::new();
    for result in builder.build() {
        if out.len() >= max_files {
            break;
        }
        let Ok(entry) = result else { continue };
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }
        let path = entry.into_path();
        if extension_for_path(&path).is_some_and(|ext| languages::find_entry(&ext).is_some()) {
            out.push(path);
        }
    }
    Ok(out)
}

fn file_is_candidate(path: &Path, overrides: &Override) -> bool {
    extension_for_path(path).is_some_and(|ext| languages::find_entry(&ext).is_some())
        && !overrides.matched(path, false).is_ignore()
}

fn extension_for_path(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
}
