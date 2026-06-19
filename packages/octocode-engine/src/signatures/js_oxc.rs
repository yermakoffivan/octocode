//! Native JS/TS symbol outline via `oxc_parser`.
//!
//! Produces an LSP-compatible `DocumentSymbol[]` tree (nested, numeric
//! `SymbolKind`, 0-based UTF-16 ranges) serialized as JSON — byte-for-byte the
//! shape a language server returns, so the existing `documentSymbols` flatten
//! path consumes it unchanged.
//!
//! **No type inference.** oxc parses ECMAScript/TypeScript *syntax*; it resolves
//! in-file scopes/bindings but not types. Callers stamp `source: "native"` so
//! the fidelity tier is explicit. Type-aware outlines still require a server.
//!
//! oxc is less error-tolerant than tree-sitter, so on a hard parse failure we
//! return `None` and the caller falls back to the tree-sitter signature path.

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    BindingPattern, Class, ClassElement, Declaration, ExportDefaultDeclarationKind, Expression,
    Function, MethodDefinitionKind, Program, PropertyKey, Statement, TSEnumDeclaration,
    TSEnumMemberName, TSInterfaceDeclaration, TSModuleDeclaration, TSModuleDeclarationBody,
    TSModuleDeclarationName, TSSignature, TSTypeAliasDeclaration, VariableDeclaration,
    VariableDeclarationKind,
};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{GetSpan, SourceType, Span};
use serde::Serialize;

use crate::file_extension::is_js_ts_extension;

// LSP SymbolKind numeric codes (subset we emit). The TS side maps these back to
// names via `symbolKindName`; keep them in sync with the LSP spec.
mod kind {
    pub const NAMESPACE: u8 = 3;
    pub const CLASS: u8 = 5;
    pub const METHOD: u8 = 6;
    pub const PROPERTY: u8 = 7;
    pub const CONSTRUCTOR: u8 = 9;
    pub const ENUM: u8 = 10;
    pub const INTERFACE: u8 = 11;
    pub const FUNCTION: u8 = 12;
    pub const VARIABLE: u8 = 13;
    pub const CONSTANT: u8 = 14;
    pub const ENUM_MEMBER: u8 = 22;
}

#[derive(Serialize)]
struct Position {
    line: u32,
    character: u32,
}

#[derive(Serialize)]
struct Range {
    start: Position,
    end: Position,
}

#[derive(Serialize)]
struct DocumentSymbol {
    name: String,
    kind: u8,
    range: Range,
    #[serde(rename = "selectionRange")]
    selection_range: Range,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    children: Vec<DocumentSymbol>,
}

/// Maps byte offsets to LSP `(line, character)` positions, where `character`
/// counts UTF-16 code units from the line start (the LSP wire convention).
struct LineIndex<'a> {
    content: &'a str,
    /// Byte offset of the first character of each 0-based line.
    line_starts: Vec<u32>,
}

impl<'a> LineIndex<'a> {
    fn new(content: &'a str) -> Self {
        let mut line_starts = vec![0u32];
        for (i, b) in content.bytes().enumerate() {
            if b == b'\n' {
                line_starts.push((i + 1) as u32);
            }
        }
        Self {
            content,
            line_starts,
        }
    }

    fn position(&self, byte_offset: u32) -> Position {
        // Highest line whose start byte is <= byte_offset.
        let line = self
            .line_starts
            .partition_point(|&start| start <= byte_offset)
            .saturating_sub(1);
        let line_start = self.line_starts.get(line).copied().unwrap_or(0) as usize;
        let end = (byte_offset as usize).min(self.content.len());
        let character = if line_start <= end {
            self.content
                .get(line_start..end)
                .map(|slice| slice.chars().map(char::len_utf16).sum::<usize>() as u32)
                .unwrap_or(0)
        } else {
            0
        };
        Position {
            line: line as u32,
            character,
        }
    }

    fn range(&self, span: Span) -> Range {
        Range {
            start: self.position(span.start),
            end: self.position(span.end),
        }
    }

    /// Inverse of [`position`]: an LSP `(line, character)` (0-based, UTF-16) to a
    /// byte offset into `content`. Clamps out-of-range input to a valid offset.
    fn byte_offset(&self, line: u32, character: u32) -> u32 {
        let line_start = self
            .line_starts
            .get(line as usize)
            .copied()
            .unwrap_or(self.content.len() as u32) as usize;
        let mut utf16 = 0u32;
        let mut byte = line_start;
        for ch in self.content.get(line_start..).unwrap_or("").chars() {
            if utf16 >= character || ch == '\n' {
                break;
            }
            utf16 += ch.len_utf16() as u32;
            byte += ch.len_utf8();
        }
        byte as u32
    }
}

fn span_contains(span: Span, offset: u32) -> bool {
    span.start <= offset && offset < span.end
}

fn source_type_for(ext: &str) -> SourceType {
    match ext {
        "ts" | "mts" | "cts" => SourceType::ts(),
        "tsx" => SourceType::tsx(),
        "jsx" => SourceType::jsx(),
        "mjs" => SourceType::mjs(),
        "cjs" => SourceType::cjs(),
        _ => SourceType::default(), // js
    }
}

/// Native JS/TS document symbols as a JSON `DocumentSymbol[]`.
///
/// Returns `None` for: oversized input, a hard parse failure (caller falls back
/// to tree-sitter), or a file with no extractable top-level symbols.
pub fn extract_js_symbols(content: &str, file_path: &str) -> Option<String> {
    if content.len() > crate::minifier::MAX_SIZE {
        return None;
    }
    // oxc can ICE on pathological input; contain the unwind so it never crosses
    // the napi FFI boundary and aborts Node (mirrors the minifier/signature
    // guards elsewhere in the crate).
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        extract_js_symbols_inner(content, file_path)
    }))
    .unwrap_or(None)
}

fn extract_js_symbols_inner(content: &str, file_path: &str) -> Option<String> {
    let ext = crate::file_extension::get_extension_internal(file_path, true, "ts");
    if !is_js_ts_extension(&ext) {
        return None;
    }
    let allocator = Allocator::default();
    let parser_ret = Parser::new(&allocator, content, source_type_for(&ext)).parse();

    // Hard parse failure with nothing recovered → let the caller fall back to
    // the more error-tolerant tree-sitter path rather than emit a stub outline.
    if parser_ret.program.body.is_empty() && !parser_ret.diagnostics.is_empty() {
        return None;
    }

    let line_index = LineIndex::new(content);
    let mut symbols = Vec::new();
    collect_program(&parser_ret.program, &line_index, &mut symbols);

    if symbols.is_empty() {
        return None;
    }
    serde_json::to_string(&symbols).ok()
}

/// Native in-file references to the symbol under `(line, character)` (0-based,
/// UTF-16), as a JSON `Range[]` covering the declaration and every resolved
/// in-file reference. **Same-file only** — oxc resolves bindings within one
/// module, never across files (that needs a language server). The first range
/// is the declaration.
///
/// Returns `None` for non-JS/TS files, oversized content, a hard parse failure,
/// or when the cursor is not on a resolvable binding/reference.
pub fn find_in_file_references(
    content: &str,
    file_path: &str,
    line: u32,
    character: u32,
) -> Option<String> {
    if content.len() > crate::minifier::MAX_SIZE {
        return None;
    }
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        find_in_file_references_inner(content, file_path, line, character)
    }))
    .unwrap_or(None)
}

fn find_in_file_references_inner(
    content: &str,
    file_path: &str,
    line: u32,
    character: u32,
) -> Option<String> {
    let ext = crate::file_extension::get_extension_internal(file_path, true, "ts");
    if !is_js_ts_extension(&ext) {
        return None;
    }

    let allocator = Allocator::default();
    let parser_ret = Parser::new(&allocator, content, source_type_for(&ext)).parse();
    if parser_ret.program.body.is_empty() && !parser_ret.diagnostics.is_empty() {
        return None;
    }

    // `with_build_nodes` records the AST-node table so we can resolve a
    // reference's span via `nodes.kind(node_id).span()`; it is off by default.
    let semantic_ret = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(&parser_ret.program);
    let semantic = semantic_ret.semantic;
    let scoping = semantic.scoping();
    let nodes = semantic.nodes();
    let line_index = LineIndex::new(content);
    let offset = line_index.byte_offset(line, character);

    // Resolve the symbol under the cursor: first try declarations, then any
    // resolved reference (so the cursor can sit on a use site too).
    let mut target = None;
    for symbol_id in scoping.symbol_ids() {
        if span_contains(scoping.symbol_span(symbol_id), offset) {
            target = Some(symbol_id);
            break;
        }
    }
    if target.is_none() {
        'outer: for symbol_id in scoping.symbol_ids() {
            for reference in scoping.get_resolved_references(symbol_id) {
                if span_contains(nodes.kind(reference.node_id()).span(), offset) {
                    target = Some(symbol_id);
                    break 'outer;
                }
            }
        }
    }
    let target = target?;

    // Declaration first, then every resolved in-file reference.
    let mut spans: Vec<Span> = vec![scoping.symbol_span(target)];
    for reference in scoping.get_resolved_references(target) {
        spans.push(nodes.kind(reference.node_id()).span());
    }
    spans.sort_by_key(|span| (span.start, span.end));
    spans.dedup_by_key(|span| (span.start, span.end));

    let ranges: Vec<Range> = spans.into_iter().map(|span| line_index.range(span)).collect();
    serde_json::to_string(&ranges).ok()
}

fn collect_program(program: &Program, li: &LineIndex, out: &mut Vec<DocumentSymbol>) {
    for stmt in &program.body {
        collect_statement(stmt, li, out);
    }
}

fn collect_statement(stmt: &Statement, li: &LineIndex, out: &mut Vec<DocumentSymbol>) {
    match stmt {
        Statement::FunctionDeclaration(f) => push_opt(out, function_symbol(f, li)),
        Statement::ClassDeclaration(c) => push_opt(out, class_symbol(c, li)),
        Statement::VariableDeclaration(v) => collect_variable(v, li, out),
        Statement::TSInterfaceDeclaration(i) => push_opt(out, interface_symbol(i, li)),
        Statement::TSEnumDeclaration(e) => push_opt(out, enum_symbol(e, li)),
        Statement::TSModuleDeclaration(m) => push_opt(out, namespace_symbol(m, li)),
        Statement::TSTypeAliasDeclaration(t) => push_opt(out, type_alias_symbol(t, li)),
        Statement::ExportNamedDeclaration(e) => {
            if let Some(decl) = &e.declaration {
                collect_declaration(decl, li, out);
            }
        }
        Statement::ExportDefaultDeclaration(e) => match &e.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(f) => {
                push_opt(out, function_symbol(f, li))
            }
            ExportDefaultDeclarationKind::ClassDeclaration(c) => push_opt(out, class_symbol(c, li)),
            _ => {}
        },
        _ => {}
    }
}

fn collect_declaration(decl: &Declaration, li: &LineIndex, out: &mut Vec<DocumentSymbol>) {
    match decl {
        Declaration::FunctionDeclaration(f) => push_opt(out, function_symbol(f, li)),
        Declaration::ClassDeclaration(c) => push_opt(out, class_symbol(c, li)),
        Declaration::VariableDeclaration(v) => collect_variable(v, li, out),
        Declaration::TSInterfaceDeclaration(i) => push_opt(out, interface_symbol(i, li)),
        Declaration::TSEnumDeclaration(e) => push_opt(out, enum_symbol(e, li)),
        Declaration::TSModuleDeclaration(m) => push_opt(out, namespace_symbol(m, li)),
        Declaration::TSTypeAliasDeclaration(t) => push_opt(out, type_alias_symbol(t, li)),
        _ => {}
    }
}

fn push_opt(out: &mut Vec<DocumentSymbol>, symbol: Option<DocumentSymbol>) {
    if let Some(symbol) = symbol {
        out.push(symbol);
    }
}

fn function_symbol(f: &Function, li: &LineIndex) -> Option<DocumentSymbol> {
    let id = f.id.as_ref()?;
    Some(leaf(id.name.as_str(), kind::FUNCTION, f.span, id.span, li))
}

fn class_symbol(class: &Class, li: &LineIndex) -> Option<DocumentSymbol> {
    let id = class.id.as_ref()?;
    let mut children = Vec::new();
    for element in &class.body.body {
        match element {
            ClassElement::MethodDefinition(m) => {
                let symbol_kind = match m.kind {
                    MethodDefinitionKind::Constructor => kind::CONSTRUCTOR,
                    _ => kind::METHOD,
                };
                if let Some((name, name_span)) = property_key_name(&m.key) {
                    children.push(leaf(&name, symbol_kind, m.span, name_span, li));
                }
            }
            ClassElement::PropertyDefinition(p) => {
                if let Some((name, name_span)) = property_key_name(&p.key) {
                    children.push(leaf(&name, kind::PROPERTY, p.span, name_span, li));
                }
            }
            ClassElement::AccessorProperty(a) => {
                if let Some((name, name_span)) = property_key_name(&a.key) {
                    children.push(leaf(&name, kind::PROPERTY, a.span, name_span, li));
                }
            }
            _ => {}
        }
    }
    Some(container(
        id.name.as_str(),
        kind::CLASS,
        class.span,
        id.span,
        children,
        li,
    ))
}

fn interface_symbol(iface: &TSInterfaceDeclaration, li: &LineIndex) -> Option<DocumentSymbol> {
    let mut children = Vec::new();
    for signature in &iface.body.body {
        match signature {
            TSSignature::TSPropertySignature(p) => {
                if let Some((name, name_span)) = property_key_name(&p.key) {
                    children.push(leaf(&name, kind::PROPERTY, p.span, name_span, li));
                }
            }
            TSSignature::TSMethodSignature(m) => {
                if let Some((name, name_span)) = property_key_name(&m.key) {
                    children.push(leaf(&name, kind::METHOD, m.span, name_span, li));
                }
            }
            _ => {}
        }
    }
    Some(container(
        iface.id.name.as_str(),
        kind::INTERFACE,
        iface.span,
        iface.id.span,
        children,
        li,
    ))
}

fn enum_symbol(decl: &TSEnumDeclaration, li: &LineIndex) -> Option<DocumentSymbol> {
    let mut children = Vec::new();
    for member in &decl.body.members {
        if let Some((name, name_span)) = enum_member_name(&member.id) {
            children.push(leaf(&name, kind::ENUM_MEMBER, member.span, name_span, li));
        }
    }
    Some(container(
        decl.id.name.as_str(),
        kind::ENUM,
        decl.span,
        decl.id.span,
        children,
        li,
    ))
}

fn namespace_symbol(decl: &TSModuleDeclaration, li: &LineIndex) -> Option<DocumentSymbol> {
    let (name, name_span) = match &decl.id {
        TSModuleDeclarationName::Identifier(id) => (id.name.as_str().to_string(), id.span),
        TSModuleDeclarationName::StringLiteral(s) => (s.value.as_str().to_string(), s.span),
    };
    let mut children = Vec::new();
    if let Some(body) = &decl.body {
        match body {
            TSModuleDeclarationBody::TSModuleBlock(block) => {
                for stmt in &block.body {
                    collect_statement(stmt, li, &mut children);
                }
            }
            TSModuleDeclarationBody::TSModuleDeclaration(inner) => {
                push_opt(&mut children, namespace_symbol(inner, li));
            }
        }
    }
    Some(container(
        &name,
        kind::NAMESPACE,
        decl.span,
        name_span,
        children,
        li,
    ))
}

fn type_alias_symbol(decl: &TSTypeAliasDeclaration, li: &LineIndex) -> Option<DocumentSymbol> {
    // No dedicated LSP kind for a type alias; `Interface` groups named types and
    // is what most TS servers report.
    Some(leaf(
        decl.id.name.as_str(),
        kind::INTERFACE,
        decl.span,
        decl.id.span,
        li,
    ))
}

fn collect_variable(decl: &VariableDeclaration, li: &LineIndex, out: &mut Vec<DocumentSymbol>) {
    let is_const = matches!(
        decl.kind,
        VariableDeclarationKind::Const
            | VariableDeclarationKind::Using
            | VariableDeclarationKind::AwaitUsing
    );
    for declarator in &decl.declarations {
        let BindingPattern::BindingIdentifier(id) = &declarator.id else {
            // Destructuring patterns have no single name — skip.
            continue;
        };
        let symbol_kind = match &declarator.init {
            Some(Expression::ArrowFunctionExpression(_))
            | Some(Expression::FunctionExpression(_)) => kind::FUNCTION,
            Some(Expression::ClassExpression(_)) => kind::CLASS,
            _ if is_const => kind::CONSTANT,
            _ => kind::VARIABLE,
        };
        out.push(leaf(
            id.name.as_str(),
            symbol_kind,
            declarator.span,
            id.span,
            li,
        ));
    }
}

fn property_key_name(key: &PropertyKey) -> Option<(String, Span)> {
    match key {
        PropertyKey::StaticIdentifier(id) => Some((id.name.as_str().to_string(), id.span)),
        PropertyKey::PrivateIdentifier(p) => Some((format!("#{}", p.name.as_str()), p.span)),
        PropertyKey::StringLiteral(s) => Some((s.value.as_str().to_string(), s.span)),
        _ => None, // computed / numeric / template keys
    }
}

fn enum_member_name(name: &TSEnumMemberName) -> Option<(String, Span)> {
    match name {
        TSEnumMemberName::Identifier(id) => Some((id.name.as_str().to_string(), id.span)),
        TSEnumMemberName::String(s) => Some((s.value.as_str().to_string(), s.span)),
        _ => None, // computed members
    }
}

fn leaf(name: &str, kind: u8, full: Span, selection: Span, li: &LineIndex) -> DocumentSymbol {
    container(name, kind, full, selection, Vec::new(), li)
}

fn container(
    name: &str,
    kind: u8,
    full: Span,
    selection: Span,
    children: Vec<DocumentSymbol>,
    li: &LineIndex,
) -> DocumentSymbol {
    DocumentSymbol {
        name: name.to_string(),
        kind,
        range: li.range(full),
        selection_range: li.range(selection),
        children,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn symbols(content: &str, path: &str) -> Value {
        let json = extract_js_symbols(content, path).expect("symbols expected");
        serde_json::from_str(&json).expect("valid json")
    }

    fn names(value: &Value) -> Vec<String> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn extracts_functions_classes_and_members() {
        let src = "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport class Calc {\n  value = 0;\n  multiply(x: number) {\n    return this.value * x;\n  }\n  constructor() {}\n}\n";
        let v = symbols(src, "calc.ts");
        let top = names(&v);
        assert!(top.contains(&"add".to_string()), "function: {top:?}");
        assert!(top.contains(&"Calc".to_string()), "class: {top:?}");

        let calc = v
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == "Calc")
            .unwrap();
        assert_eq!(calc["kind"], 5, "class kind");
        let members = names(&calc["children"]);
        assert!(members.contains(&"value".to_string()), "field: {members:?}");
        assert!(
            members.contains(&"multiply".to_string()),
            "method: {members:?}"
        );
        assert!(
            members.contains(&"constructor".to_string()),
            "ctor: {members:?}"
        );
    }

    #[test]
    fn extracts_interface_enum_typealias_namespace() {
        let src = "export interface User {\n  id: string;\n  greet(): void;\n}\n\nexport enum Color { Red, Green }\n\nexport type Id = string;\n\nexport namespace NS {\n  export function inner() {}\n}\n";
        let v = symbols(src, "types.ts");
        let top = names(&v);
        for expected in ["User", "Color", "Id", "NS"] {
            assert!(top.contains(&expected.to_string()), "{expected} in {top:?}");
        }
        let user = v
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == "User")
            .unwrap();
        assert_eq!(user["kind"], 11, "interface kind");
        let members = names(&user["children"]);
        assert!(members.contains(&"id".to_string()));
        assert!(members.contains(&"greet".to_string()));

        let ns = v
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == "NS")
            .unwrap();
        assert!(names(&ns["children"]).contains(&"inner".to_string()));
    }

    #[test]
    fn arrow_const_is_a_function_const_value_is_constant() {
        let src = "export const handler = (req) => req;\nexport const MAX = 10;\nlet counter = 0;\n";
        let v = symbols(src, "h.js");
        let arr = v.as_array().unwrap();
        let handler = arr.iter().find(|s| s["name"] == "handler").unwrap();
        assert_eq!(handler["kind"], 12, "arrow → function");
        let max = arr.iter().find(|s| s["name"] == "MAX").unwrap();
        assert_eq!(max["kind"], 14, "const → constant");
        let counter = arr.iter().find(|s| s["name"] == "counter").unwrap();
        assert_eq!(counter["kind"], 13, "let → variable");
    }

    #[test]
    fn ranges_are_zero_based() {
        let src = "function first() {}\nfunction second() {}\n";
        let v = symbols(src, "a.ts");
        let first = &v.as_array().unwrap()[0];
        assert_eq!(first["range"]["start"]["line"], 0, "0-based first line");
        let second = v
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["name"] == "second")
            .unwrap();
        assert_eq!(second["range"]["start"]["line"], 1);
    }

    #[test]
    fn tsx_and_jsx_parse() {
        let src = "export function App() {\n  return <div>hi</div>;\n}\n";
        let v = symbols(src, "App.tsx");
        assert!(names(&v).contains(&"App".to_string()));
    }

    #[test]
    fn empty_or_dataless_returns_none() {
        assert!(extract_js_symbols("", "empty.ts").is_none());
        // A hard parse failure must not abort; it returns None or a best-effort
        // outline — either is acceptable, just never a panic.
        let _ = extract_js_symbols("const x = 1 +;", "broken.ts");
    }

    fn refs(content: &str, path: &str, line: u32, character: u32) -> Value {
        let json = find_in_file_references(content, path, line, character)
            .expect("references expected");
        serde_json::from_str(&json).expect("valid json")
    }

    #[test]
    fn finds_in_file_references_from_declaration() {
        // `count` declared on line 0; used on lines 1 and 2.
        let src = "const count = 1;\nconst a = count + 1;\nconsole.log(count);\n";
        // Cursor on the declaration identifier `count` (line 0, char 6).
        let v = refs(src, "m.ts", 0, 6);
        let arr = v.as_array().unwrap();
        assert_eq!(arr.len(), 3, "declaration + 2 uses: {arr:?}");
        // First range is the declaration (line 0).
        assert_eq!(arr[0]["start"]["line"], 0);
        let lines: Vec<i64> = arr
            .iter()
            .map(|r| r["start"]["line"].as_i64().unwrap())
            .collect();
        assert!(lines.contains(&1) && lines.contains(&2), "uses: {lines:?}");
    }

    #[test]
    fn finds_references_from_a_use_site() {
        let src = "function greet(name) {\n  return name + name;\n}\n";
        // Cursor on a `name` use inside the body (line 1).
        let v = refs(src, "m.js", 1, 9);
        let arr = v.as_array().unwrap();
        assert!(arr.len() >= 2, "param + uses: {arr:?}");
    }

    #[test]
    fn references_none_off_symbol() {
        let src = "const x = 1;\n";
        // Cursor in whitespace / on a keyword, not a binding.
        assert!(find_in_file_references(src, "m.ts", 0, 0).is_none());
    }

    #[test]
    fn never_aborts_on_adversarial_input() {
        for src in [
            "function broken( { [ unterminated",
            "class { { { {",
            "\u{0}\u{0}\u{0}",
            "import type type from from",
        ] {
            let _ = extract_js_symbols(src, "x.ts");
        }
    }
}
