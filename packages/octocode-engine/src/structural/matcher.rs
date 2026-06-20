use std::collections::HashMap;

use ast_grep_config::{from_str, DeserializeEnv, SerializableRuleCore};
use ast_grep_core::meta_var::MetaVariable;
use ast_grep_core::tree_sitter::{LanguageExt, StrDoc};
use ast_grep_core::{NodeMatch, Pattern};

use super::language::AgLanguage;
use super::query::StructuralQuery;
use super::types::StructuralMatch;

/// A compiled query bound to one language: parse the pattern/rule ONCE, return
/// a closure that runs it against any document of that language.
pub(super) type CompiledMatcher = Box<dyn Fn(&str) -> Vec<StructuralMatch>>;

pub(super) fn compile_matcher(
    lang: &AgLanguage,
    query: StructuralQuery<'_>,
) -> Result<CompiledMatcher, String> {
    match query.parts() {
        (Some(pattern), None) if is_document_probe(pattern) => {
            let lang = lang.clone();
            Ok(Box::new(move |content| root_match(&lang, content)))
        }
        (Some(pattern), None) => {
            let pat = Pattern::try_new(pattern, lang.clone())
                .map_err(|err| format!("invalid structural pattern: {err}"))?;
            let lang = lang.clone();
            Ok(Box::new(move |content| {
                let grep = lang.ast_grep(content);
                grep.root().find_all(&pat).map(|m| to_match(&m)).collect()
            }))
        }
        (None, Some(rule)) => {
            let env = DeserializeEnv::new(lang.clone());
            let serialized: SerializableRuleCore =
                from_str(rule).map_err(|err| format!("invalid rule YAML: {err}"))?;
            let matcher = serialized
                .get_matcher(env)
                .map_err(|err| format!("invalid rule: {err}"))?;
            let lang = lang.clone();
            Ok(Box::new(move |content| {
                let grep = lang.ast_grep(content);
                grep.root()
                    .find_all(&matcher)
                    .map(|m| to_match(&m))
                    .collect()
            }))
        }
        _ => unreachable!("StructuralQuery validates the query shape"),
    }
}

/// Convert one ast-grep match into the napi-facing struct, pulling every
/// captured metavar out of the match environment.
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
                    .map(|node| node.text().to_string())
                    .collect();
                metavars.insert(id, texts);
            }
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

fn root_match(lang: &AgLanguage, content: &str) -> Vec<StructuralMatch> {
    let grep = lang.ast_grep(content);
    let node = grep.root();
    let start = node.start_pos();
    let end = node.end_pos();

    vec![StructuralMatch {
        start_line: (start.line() as u32) + 1,
        end_line: (end.line() as u32) + 1,
        start_col: start.column(&node) as u32,
        end_col: end.column(&node) as u32,
        text: node.text().to_string(),
        metavars: HashMap::new(),
    }]
}

fn is_document_probe(pattern: &str) -> bool {
    pattern.trim() == "$$$"
}
