use std::collections::{HashMap, HashSet};

use regex::Regex;
use serde::Deserialize;
use tree_sitter::{Language, Node, Parser, Tree};

use super::language::AgLanguage;
use super::query::StructuralQuery;
use super::types::StructuralMatch;

pub(super) type OctoCompiledMatcher = Box<dyn Fn(&str) -> Vec<StructuralMatch>>;

pub(super) fn compile_matcher(
    lang: &AgLanguage,
    query: StructuralQuery<'_>,
) -> Result<OctoCompiledMatcher, String> {
    let language = lang.tree_sitter_language();
    match query.parts() {
        (Some(pattern), None) if is_document_probe(pattern) => Ok(Box::new(move |content| {
            parse_tree(&language, content)
                .map(|tree| {
                    vec![to_structural_match(
                        tree.root_node(),
                        content,
                        HashMap::new(),
                    )]
                })
                .unwrap_or_default()
        })),
        (Some(pattern), None) => {
            let compiled = CompiledPattern::new(lang, pattern)?;
            Ok(Box::new(move |content| {
                if compiled.is_special() {
                    return compiled.find_special_matches(content);
                }

                let Some(tree) = parse_tree(compiled.language(), content) else {
                    return Vec::new();
                };
                let mut matches = Vec::new();
                visit_named(tree.root_node(), &mut |candidate| {
                    let mut captures = CaptureEnv::default();
                    if compiled.matches(candidate, content, &mut captures) {
                        matches.push(to_structural_match(candidate, content, captures.into_map()));
                    }
                });
                matches
            }))
        }
        (None, Some(rule)) => {
            let compiled = CompiledRule::new(lang, rule)?;
            let language = lang.tree_sitter_language();
            Ok(Box::new(move |content| {
                let Some(tree) = parse_tree(&language, content) else {
                    return Vec::new();
                };
                let document = Document { content };
                let mut matches = Vec::new();
                visit_named(tree.root_node(), &mut |candidate| {
                    let mut captures = CaptureEnv::default();
                    if compiled.matches(candidate, &document, &mut captures) {
                        matches.push(to_structural_match(candidate, content, captures.into_map()));
                    }
                });
                matches
            }))
        }
        _ => unreachable!("StructuralQuery validates the query shape"),
    }
}

fn is_document_probe(pattern: &str) -> bool {
    pattern.trim() == "$$$"
}

fn parse_tree(language: &Language, content: &str) -> Option<Tree> {
    let mut parser = Parser::new();
    parser.set_language(language).ok()?;
    parser.parse(content.as_bytes(), None)
}

fn visit_named<'tree>(node: Node<'tree>, f: &mut impl FnMut(Node<'tree>)) {
    if node.is_named() {
        f(node);
    }
    for child in named_children(node) {
        visit_named(child, f);
    }
}

#[derive(Default, Clone)]
struct CaptureEnv {
    values: HashMap<String, Vec<String>>,
}

impl CaptureEnv {
    fn capture_one(&mut self, name: &str, text: String) -> bool {
        match self.values.get(name) {
            Some(existing) => existing.as_slice() == [text.as_str()],
            None => {
                self.values.insert(name.to_owned(), vec![text]);
                true
            }
        }
    }

    fn capture_many(&mut self, name: &str, texts: Vec<String>) -> bool {
        match self.values.get(name) {
            Some(existing) => existing == &texts,
            None => {
                self.values.insert(name.to_owned(), texts);
                true
            }
        }
    }

    fn into_map(self) -> HashMap<String, Vec<String>> {
        self.values
    }
}

struct CompiledPattern {
    language: Language,
    expando: char,
    source: String,
    tree: Option<Tree>,
    special: Option<SpecialPattern>,
}

enum SpecialPattern {
    HtmlTagName {
        capture: String,
    },
    KeyValuePair {
        key_capture: String,
        value_capture: String,
    },
}

impl CompiledPattern {
    fn new(lang: &AgLanguage, pattern: &str) -> Result<Self, String> {
        if let Some(capture) = html_tag_name_capture(pattern) {
            return Ok(Self {
                language: lang.tree_sitter_language(),
                expando: lang.expando_char_value(),
                source: pattern.to_owned(),
                tree: None,
                special: Some(SpecialPattern::HtmlTagName { capture }),
            });
        }

        if let Some((key_capture, value_capture)) = key_value_pair_capture(pattern) {
            return Ok(Self {
                language: lang.tree_sitter_language(),
                expando: lang.expando_char_value(),
                source: pattern.to_owned(),
                tree: None,
                special: Some(SpecialPattern::KeyValuePair {
                    key_capture,
                    value_capture,
                }),
            });
        }

        let source = lang.preprocess_pattern(pattern).into_owned();
        let language = lang.tree_sitter_language();
        let tree = parse_tree(&language, &source)
            .ok_or_else(|| "invalid structural pattern: failed to parse pattern".to_string())?;
        let root = effective_pattern_root(tree.root_node());
        if root.is_error() {
            return Err(
                "invalid structural pattern: pattern parsed with syntax errors".to_string(),
            );
        }
        Ok(Self {
            language,
            expando: lang.expando_char_value(),
            source,
            tree: Some(tree),
            special: None,
        })
    }

    fn language(&self) -> &Language {
        &self.language
    }

    fn is_special(&self) -> bool {
        self.special.is_some()
    }

    fn find_special_matches(&self, content: &str) -> Vec<StructuralMatch> {
        let Some(special) = &self.special else {
            return Vec::new();
        };
        let Some(tree) = parse_tree(&self.language, content) else {
            return Vec::new();
        };

        let mut seen = HashSet::new();
        let mut matches = Vec::new();
        visit_named(tree.root_node(), &mut |candidate| {
            if let Some(matched) = self.special_structural_match(special, candidate, content) {
                let key = (
                    matched.start_line,
                    matched.start_col,
                    matched.end_line,
                    matched.end_col,
                );
                if seen.insert(key) {
                    matches.push(matched);
                }
            }
        });
        matches
    }

    fn matches(&self, candidate: Node<'_>, content: &str, captures: &mut CaptureEnv) -> bool {
        if let Some(special) = &self.special {
            return self.matches_special(special, candidate, content, captures);
        }

        let Some(tree) = &self.tree else {
            return false;
        };
        let root = effective_pattern_root(tree.root_node());
        self.match_node(root, &self.source, candidate, content, captures)
    }

    fn special_structural_match(
        &self,
        special: &SpecialPattern,
        candidate: Node<'_>,
        content: &str,
    ) -> Option<StructuralMatch> {
        match special {
            SpecialPattern::HtmlTagName { capture } => {
                let tag_name = html_tag_name_node(candidate)?;
                let text = node_text(candidate, content);
                let open_tag_len = text.find('>')? + 1;
                let start_byte = candidate.start_byte();
                let end_byte = start_byte + open_tag_len;
                let mut metavars = HashMap::new();
                metavars.insert(
                    capture.clone(),
                    vec![node_text(tag_name, content).to_owned()],
                );
                Some(structural_match_from_byte_range(
                    content, start_byte, end_byte, metavars,
                ))
            }
            SpecialPattern::KeyValuePair {
                key_capture,
                value_capture,
            } => {
                let (key, value) = key_value_nodes(candidate)?;
                let mut metavars = HashMap::new();
                metavars.insert(
                    key_capture.clone(),
                    vec![node_text(key, content).to_owned()],
                );
                metavars.insert(
                    value_capture.clone(),
                    vec![node_text(value, content).to_owned()],
                );
                Some(to_structural_match(candidate, content, metavars))
            }
        }
    }

    fn matches_special(
        &self,
        special: &SpecialPattern,
        candidate: Node<'_>,
        content: &str,
        captures: &mut CaptureEnv,
    ) -> bool {
        match special {
            SpecialPattern::HtmlTagName { capture } => {
                let Some(tag_name) = html_tag_name_node(candidate) else {
                    return false;
                };
                captures.capture_one(capture, node_text(tag_name, content).to_owned())
            }
            SpecialPattern::KeyValuePair {
                key_capture,
                value_capture,
            } => {
                let Some((key, value)) = key_value_nodes(candidate) else {
                    return false;
                };
                captures.capture_one(key_capture, node_text(key, content).to_owned())
                    && captures.capture_one(value_capture, node_text(value, content).to_owned())
            }
        }
    }

    fn match_node(
        &self,
        pattern: Node<'_>,
        pattern_source: &str,
        candidate: Node<'_>,
        candidate_source: &str,
        captures: &mut CaptureEnv,
    ) -> bool {
        if let Some(meta) = meta_from_node(pattern, pattern_source, self.expando) {
            return match meta {
                MetaVar::Single(name) => {
                    captures.capture_one(&name, node_text(candidate, candidate_source).to_owned())
                }
                MetaVar::IgnoredSingle => true,
                MetaVar::Multi(_) | MetaVar::IgnoredMulti => false,
            };
        }

        if pattern.kind() != candidate.kind() {
            return false;
        }

        let pattern_children = children(pattern);
        let candidate_children = children(candidate);
        if pattern_children.is_empty() && candidate_children.is_empty() {
            return node_text(pattern, pattern_source) == node_text(candidate, candidate_source);
        }

        self.match_child_list(
            &pattern_children,
            pattern_source,
            &candidate_children,
            candidate_source,
            captures,
        )
    }

    fn match_child_list(
        &self,
        pattern_children: &[Node<'_>],
        pattern_source: &str,
        candidate_children: &[Node<'_>],
        candidate_source: &str,
        captures: &mut CaptureEnv,
    ) -> bool {
        if pattern_children.is_empty() {
            return candidate_children.is_empty();
        }

        let first = pattern_children[0];
        if let Some(meta) = meta_from_node(first, pattern_source, self.expando) {
            match meta {
                MetaVar::Multi(name) => {
                    return self.match_multi_capture(
                        name.as_deref(),
                        &pattern_children[1..],
                        pattern_source,
                        candidate_children,
                        candidate_source,
                        captures,
                    );
                }
                MetaVar::IgnoredMulti => {
                    return self.match_multi_capture(
                        None,
                        &pattern_children[1..],
                        pattern_source,
                        candidate_children,
                        candidate_source,
                        captures,
                    );
                }
                MetaVar::Single(_) | MetaVar::IgnoredSingle => {}
            }
        }

        let Some(candidate_first) = candidate_children.first().copied() else {
            return false;
        };
        let mut branch = captures.clone();
        if !self.match_node(
            first,
            pattern_source,
            candidate_first,
            candidate_source,
            &mut branch,
        ) {
            return false;
        }
        if self.match_child_list(
            &pattern_children[1..],
            pattern_source,
            &candidate_children[1..],
            candidate_source,
            &mut branch,
        ) {
            *captures = branch;
            return true;
        }
        false
    }

    fn match_multi_capture(
        &self,
        name: Option<&str>,
        remaining_pattern: &[Node<'_>],
        pattern_source: &str,
        candidate_children: &[Node<'_>],
        candidate_source: &str,
        captures: &mut CaptureEnv,
    ) -> bool {
        let min_remaining =
            minimum_candidate_nodes(remaining_pattern, pattern_source, self.expando);
        if candidate_children.len() < min_remaining {
            return false;
        }
        let max_take = candidate_children.len() - min_remaining;
        for take in 0..=max_take {
            let mut branch = captures.clone();
            if let Some(name) = name {
                let texts = candidate_children[..take]
                    .iter()
                    .map(|node| node_text(*node, candidate_source).to_owned())
                    .collect();
                if !branch.capture_many(name, texts) {
                    continue;
                }
            }
            if self.match_child_list(
                remaining_pattern,
                pattern_source,
                &candidate_children[take..],
                candidate_source,
                &mut branch,
            ) {
                *captures = branch;
                return true;
            }
        }
        false
    }
}

fn html_tag_name_node(candidate: Node<'_>) -> Option<Node<'_>> {
    if !matches!(candidate.kind(), "element" | "self_closing_tag") {
        return None;
    }
    first_named_descendant_kind(candidate, "tag_name")
}

fn key_value_nodes(candidate: Node<'_>) -> Option<(Node<'_>, Node<'_>)> {
    if !matches!(candidate.kind(), "pair" | "block_mapping_pair") {
        return None;
    }
    let named = named_children(candidate);
    match named.as_slice() {
        [key, value, ..] => Some((*key, *value)),
        _ => None,
    }
}

fn html_tag_name_capture(pattern: &str) -> Option<String> {
    let trimmed = pattern.trim();
    let inner = trimmed.strip_prefix("<$")?.strip_suffix('>')?;
    if is_capture_name(inner) {
        return Some(inner.to_owned());
    }
    None
}

fn key_value_pair_capture(pattern: &str) -> Option<(String, String)> {
    let (left, right) = pattern.trim().split_once(':')?;
    let key_capture = capture_name_from_token(left.trim())?;
    let value_capture = capture_name_from_token(right.trim())?;
    Some((key_capture, value_capture))
}

fn capture_name_from_token(token: &str) -> Option<String> {
    let name = token.strip_prefix('$')?;
    if is_capture_name(name) {
        return Some(name.to_owned());
    }
    None
}

fn minimum_candidate_nodes(pattern_children: &[Node<'_>], source: &str, expando: char) -> usize {
    pattern_children
        .iter()
        .filter(|node| {
            !matches!(
                meta_from_node(**node, source, expando),
                Some(MetaVar::Multi(_) | MetaVar::IgnoredMulti)
            )
        })
        .count()
}

#[derive(Debug, PartialEq, Eq)]
enum MetaVar {
    Single(String),
    Multi(Option<String>),
    IgnoredSingle,
    IgnoredMulti,
}

fn meta_from_node(node: Node<'_>, source: &str, expando: char) -> Option<MetaVar> {
    let text = node_text(node, source);
    let mut chars = text.chars();
    if chars.next()? != expando {
        return None;
    }

    let expando_len = text.chars().take_while(|ch| *ch == expando).count();
    let rest: String = text.chars().skip(expando_len).collect();
    match expando_len {
        1 if rest == "_" => Some(MetaVar::IgnoredSingle),
        1 if is_capture_name(&rest) => Some(MetaVar::Single(rest)),
        3 if rest.is_empty() => Some(MetaVar::IgnoredMulti),
        3 if is_capture_name(&rest) => Some(MetaVar::Multi(Some(rest))),
        _ => None,
    }
}

fn is_capture_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|ch| ch == '_' || ch.is_ascii_uppercase() || ch.is_ascii_digit())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRuleDocument {
    rule: RawRule,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRule {
    kind: Option<String>,
    pattern: Option<String>,
    regex: Option<String>,
    has: Option<Box<RawRule>>,
    inside: Option<Box<RawRule>>,
    all: Option<Vec<RawRule>>,
    any: Option<Vec<RawRule>>,
    not: Option<Box<RawRule>>,
    #[serde(rename = "stopBy")]
    stop_by: Option<RawStopBy>,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum RawStopBy {
    End,
}

struct CompiledRule {
    kind: Option<String>,
    pattern: Option<CompiledPattern>,
    regex: Option<Regex>,
    has: Option<Box<CompiledRule>>,
    inside: Option<Box<CompiledRule>>,
    all: Vec<CompiledRule>,
    any: Vec<CompiledRule>,
    not: Option<Box<CompiledRule>>,
    stop_by_end: bool,
}

impl CompiledRule {
    fn new(lang: &AgLanguage, rule: &str) -> Result<Self, String> {
        let raw: RawRuleDocument =
            serde_yaml_ng::from_str(rule).map_err(|err| format!("invalid rule YAML: {err}"))?;
        Self::compile(lang, raw.rule)
    }

    fn compile(lang: &AgLanguage, raw: RawRule) -> Result<Self, String> {
        let pattern = raw
            .pattern
            .as_deref()
            .map(|pattern| CompiledPattern::new(lang, pattern))
            .transpose()?;
        let regex = raw
            .regex
            .as_deref()
            .map(Regex::new)
            .transpose()
            .map_err(|err| format!("invalid rule regex: {err}"))?;
        let has = raw
            .has
            .map(|rule| Self::compile(lang, *rule).map(Box::new))
            .transpose()?;
        let inside = raw
            .inside
            .map(|rule| Self::compile(lang, *rule).map(Box::new))
            .transpose()?;
        let all = raw
            .all
            .unwrap_or_default()
            .into_iter()
            .map(|rule| Self::compile(lang, rule))
            .collect::<Result<Vec<_>, _>>()?;
        let any = raw
            .any
            .unwrap_or_default()
            .into_iter()
            .map(|rule| Self::compile(lang, rule))
            .collect::<Result<Vec<_>, _>>()?;
        let not = raw
            .not
            .map(|rule| Self::compile(lang, *rule).map(Box::new))
            .transpose()?;

        let compiled = Self {
            kind: raw.kind,
            pattern,
            regex,
            has,
            inside,
            all,
            any,
            not,
            stop_by_end: raw.stop_by == Some(RawStopBy::End),
        };
        if compiled.is_empty() {
            return Err("invalid rule: rule must contain at least one matcher".to_string());
        }
        Ok(compiled)
    }

    fn is_empty(&self) -> bool {
        self.kind.is_none()
            && self.pattern.is_none()
            && self.regex.is_none()
            && self.has.is_none()
            && self.inside.is_none()
            && self.all.is_empty()
            && self.any.is_empty()
            && self.not.is_none()
    }

    fn matches(
        &self,
        candidate: Node<'_>,
        document: &Document<'_>,
        captures: &mut CaptureEnv,
    ) -> bool {
        if let Some(kind) = &self.kind {
            if candidate.kind() != kind {
                return false;
            }
        }
        if let Some(pattern) = &self.pattern {
            if !pattern.matches(candidate, document.content, captures) {
                return false;
            }
        }
        if let Some(regex) = &self.regex {
            if !regex.is_match(node_text(candidate, document.content)) {
                return false;
            }
        }
        if let Some(rule) = &self.has {
            let mut branch = captures.clone();
            if !matches_descendant(rule, candidate, document, &mut branch) {
                return false;
            }
            *captures = branch;
        }
        if let Some(rule) = &self.inside {
            let mut branch = captures.clone();
            if !matches_ancestor(rule, candidate, document, &mut branch) {
                return false;
            }
            *captures = branch;
        }
        for rule in &self.all {
            let mut branch = captures.clone();
            if !rule.matches(candidate, document, &mut branch) {
                return false;
            }
            *captures = branch;
        }
        if !self.any.is_empty() {
            let mut matched = None;
            for rule in &self.any {
                let mut branch = captures.clone();
                if rule.matches(candidate, document, &mut branch) {
                    matched = Some(branch);
                    break;
                }
            }
            let Some(branch) = matched else {
                return false;
            };
            *captures = branch;
        }
        if let Some(rule) = &self.not {
            let mut branch = captures.clone();
            if rule.matches(candidate, document, &mut branch) {
                return false;
            }
        }
        true
    }
}

struct Document<'a> {
    content: &'a str,
}

fn matches_descendant(
    rule: &CompiledRule,
    candidate: Node<'_>,
    document: &Document<'_>,
    captures: &mut CaptureEnv,
) -> bool {
    let children = if rule.stop_by_end {
        named_descendants(candidate)
    } else {
        named_children(candidate)
    };
    for child in children {
        let mut branch = captures.clone();
        if rule.matches(child, document, &mut branch) {
            if !branch.capture_one("secondary", node_text(child, document.content).to_owned()) {
                continue;
            }
            *captures = branch;
            return true;
        }
    }
    false
}

fn matches_ancestor(
    rule: &CompiledRule,
    candidate: Node<'_>,
    document: &Document<'_>,
    captures: &mut CaptureEnv,
) -> bool {
    let mut parent = candidate.parent();
    while let Some(node) = parent {
        let mut branch = captures.clone();
        if rule.matches(node, document, &mut branch) {
            if !branch.capture_one("secondary", node_text(node, document.content).to_owned()) {
                parent = node.parent();
                continue;
            }
            *captures = branch;
            return true;
        }
        if !rule.stop_by_end {
            return false;
        }
        parent = node.parent();
    }
    false
}

fn named_descendants<'tree>(node: Node<'tree>) -> Vec<Node<'tree>> {
    let mut out = Vec::new();
    for child in named_children(node) {
        out.push(child);
        out.extend(named_descendants(child));
    }
    out
}

fn first_named_descendant_kind<'tree>(node: Node<'tree>, kind: &str) -> Option<Node<'tree>> {
    for child in named_children(node) {
        if child.kind() == kind {
            return Some(child);
        }
        if let Some(found) = first_named_descendant_kind(child, kind) {
            return Some(found);
        }
    }
    None
}

fn effective_pattern_root(mut node: Node<'_>) -> Node<'_> {
    loop {
        let named = named_children(node);
        if named.len() == 1 && is_pattern_wrapper(node.kind()) {
            node = named[0];
            continue;
        }
        break node;
    }
}

fn is_pattern_wrapper(kind: &str) -> bool {
    matches!(
        kind,
        "program"
            | "source_file"
            | "module"
            | "compilation_unit"
            | "translation_unit"
            | "stylesheet"
            | "fragment"
            | "document"
            | "expression_statement"
    )
}

fn children<'tree>(node: Node<'tree>) -> Vec<Node<'tree>> {
    let mut out = Vec::with_capacity(node.child_count());
    for index in 0..node.child_count() {
        if let Some(child) = node.child(index as u32) {
            out.push(child);
        }
    }
    out
}

fn named_children<'tree>(node: Node<'tree>) -> Vec<Node<'tree>> {
    let mut out = Vec::with_capacity(node.named_child_count());
    for index in 0..node.named_child_count() {
        if let Some(child) = node.named_child(index as u32) {
            out.push(child);
        }
    }
    out
}

fn node_text<'a>(node: Node<'_>, source: &'a str) -> &'a str {
    source
        .get(node.start_byte()..node.end_byte())
        .unwrap_or_default()
}

fn to_structural_match(
    node: Node<'_>,
    content: &str,
    metavars: HashMap<String, Vec<String>>,
) -> StructuralMatch {
    let start = node.start_position();
    let end = node.end_position();
    StructuralMatch {
        start_line: (start.row as u32) + 1,
        end_line: (end.row as u32) + 1,
        start_col: point_column_to_char_column(content, start.row, start.column) as u32,
        end_col: point_column_to_char_column(content, end.row, end.column) as u32,
        text: node_text(node, content).to_owned(),
        metavars,
    }
}

fn structural_match_from_byte_range(
    content: &str,
    start_byte: usize,
    end_byte: usize,
    metavars: HashMap<String, Vec<String>>,
) -> StructuralMatch {
    let (start_line, start_col) = byte_to_line_col(content, start_byte);
    let (end_line, end_col) = byte_to_line_col(content, end_byte);
    StructuralMatch {
        start_line: start_line as u32,
        end_line: end_line as u32,
        start_col: start_col as u32,
        end_col: end_col as u32,
        text: content
            .get(start_byte..end_byte)
            .unwrap_or_default()
            .to_owned(),
        metavars,
    }
}

fn byte_to_line_col(content: &str, byte: usize) -> (usize, usize) {
    let byte = byte.min(content.len());
    let prefix = content.get(..byte).unwrap_or_default();
    let line = prefix.bytes().filter(|byte| *byte == b'\n').count() + 1;
    let line_start = prefix.rfind('\n').map_or(0, |index| index + 1);
    let col = content
        .get(line_start..byte)
        .map(str::chars)
        .map(Iterator::count)
        .unwrap_or(byte.saturating_sub(line_start));
    (line, col)
}

fn point_column_to_char_column(content: &str, row: usize, byte_column: usize) -> usize {
    let Some(line) = content.split('\n').nth(row) else {
        return byte_column;
    };
    let byte_column = byte_column.min(line.len());
    line.get(..byte_column)
        .map(str::chars)
        .map(Iterator::count)
        .unwrap_or(byte_column)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signatures::languages;

    fn lang(ext: &str) -> AgLanguage {
        AgLanguage::new(
            ext,
            languages::find_entry(ext).expect("test language should exist"),
        )
    }

    fn run_pattern(src: &str, ext: &str, pattern: &str) -> Vec<StructuralMatch> {
        let matcher = compile_matcher(
            &lang(ext),
            StructuralQuery::new(Some(pattern), None).expect("query"),
        )
        .expect("compile pattern");
        matcher(src)
    }

    fn run_rule(src: &str, ext: &str, rule: &str) -> Vec<StructuralMatch> {
        let matcher = compile_matcher(
            &lang(ext),
            StructuralQuery::new(None, Some(rule)).expect("query"),
        )
        .expect("compile rule");
        matcher(src)
    }

    #[test]
    fn document_probe_returns_root() {
        let matches = run_pattern("foo(a)\nbar(b)\n", "ts", "$$$");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].start_line, 1);
        assert_eq!(matches[0].text, "foo(a)\nbar(b)\n");
    }

    #[test]
    fn simple_call_pattern_captures_single_metavar() {
        let matches = run_pattern(
            "const a = foo(bar);\nconst b = foo(baz);\n",
            "ts",
            "foo($X)",
        );
        assert_eq!(matches.len(), 2);
        assert_eq!(
            matches[0].metavars.get("X").map(Vec::as_slice),
            Some(&["bar".to_string()][..])
        );
        assert_eq!(
            matches[1].metavars.get("X").map(Vec::as_slice),
            Some(&["baz".to_string()][..])
        );
    }

    #[test]
    fn comments_and_strings_do_not_match_call_pattern() {
        let src = "// eval(evil)\nconst s = \"eval(evil)\";\neval(real);\n";
        let matches = run_pattern(src, "js", "eval($X)");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].start_line, 3);
        assert_eq!(
            matches[0].metavars.get("X").map(Vec::as_slice),
            Some(&["real".to_string()][..])
        );
    }

    #[test]
    fn multi_capture_preserves_argument_separators() {
        let matches = run_pattern("log(1, 2, 3);\n", "js", "log($$$ARGS)");
        assert_eq!(matches.len(), 1);
        assert_eq!(
            matches[0].metavars.get("ARGS").map(Vec::as_slice),
            Some(
                &[
                    "1".to_string(),
                    ",".to_string(),
                    "2".to_string(),
                    ",".to_string(),
                    "3".to_string()
                ][..]
            )
        );
    }

    #[test]
    fn kind_rule_matches_call_expressions() {
        let matches = run_rule(
            "foo(a);\nbar(b);\n",
            "ts",
            "rule:\n  kind: call_expression\n",
        );
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].text, "foo(a)");
        assert_eq!(matches[1].text, "bar(b)");
    }

    #[test]
    fn inside_rule_walks_ancestors_with_stop_by_end() {
        let src = "async function f() {\n  for (const x of xs) {\n    await g(x);\n  }\n  await h();\n}\n";
        let rule =
            "rule:\n  pattern: await $C\n  inside:\n    kind: for_in_statement\n    stopBy: end\n";
        let matches = run_rule(src, "ts", rule);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].start_line, 3);
    }

    #[test]
    fn all_any_not_rule_composition_works() {
        let src = "foo(a);\nbar(b);\neval(c);\n";
        let any = "rule:\n  any:\n    - pattern: foo($X)\n    - pattern: bar($X)\n";
        assert_eq!(run_rule(src, "ts", any).len(), 2);

        let not = "rule:\n  kind: call_expression\n  not:\n    pattern: eval($X)\n";
        let matches = run_rule(src, "ts", not);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].text, "foo(a)");
        assert_eq!(matches[1].text, "bar(b)");
    }
}
