use super::language::AgLanguage;
use super::octo;
use super::query::StructuralQuery;
use super::types::StructuralMatch;

/// A compiled query bound to one language: parse the pattern/rule ONCE, return
/// a closure that runs it against any document of that language.
pub(super) type CompiledMatcher = Box<dyn Fn(&str) -> Vec<StructuralMatch>>;

pub(super) fn compile_matcher(
    lang: &AgLanguage,
    query: StructuralQuery<'_>,
) -> Result<CompiledMatcher, String> {
    compile_matcher_octo(lang, query)
}

pub(super) fn compile_matcher_octo(
    lang: &AgLanguage,
    query: StructuralQuery<'_>,
) -> Result<CompiledMatcher, String> {
    octo::compile_matcher(lang, query)
}
