use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use super::language::AgLanguage;
use super::matcher::{compile_matcher_ast_grep, compile_matcher_octo, CompiledMatcher};
use super::query::StructuralQuery;
use super::types::StructuralMatch;
use crate::signatures::languages;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ComparableMatch {
    start_line: u32,
    end_line: u32,
    start_col: u32,
    end_col: u32,
    text: String,
    metavars: BTreeMap<String, Vec<String>>,
}

impl From<StructuralMatch> for ComparableMatch {
    fn from(value: StructuralMatch) -> Self {
        Self {
            start_line: value.start_line,
            end_line: value.end_line,
            start_col: value.start_col,
            end_col: value.end_col,
            text: value.text,
            metavars: value.metavars.into_iter().collect(),
        }
    }
}

#[derive(Debug)]
struct ComparisonOutcome {
    ast_grep_duration: Duration,
    octo_duration: Duration,
    matches: usize,
}

#[derive(Debug, Clone, Copy)]
struct QueryCase {
    name: &'static str,
    ext: &'static str,
    content: &'static str,
    pattern: Option<&'static str>,
    rule: Option<&'static str>,
}

#[derive(Debug, Clone, Copy)]
struct SampleCase {
    name: &'static str,
    ext: &'static str,
    file: &'static str,
    pattern: Option<&'static str>,
    rule: Option<&'static str>,
}

fn compare_case(
    name: &str,
    ext: &str,
    content: &str,
    pattern: Option<&str>,
    rule: Option<&str>,
) -> ComparisonOutcome {
    let entry = languages::find_entry(ext).unwrap_or_else(|| panic!("{ext} should be supported"));
    let lang = AgLanguage::new(ext, entry);
    let query = StructuralQuery::new(pattern, rule).expect("comparison query should be valid");

    let ast_grep = compile_matcher_ast_grep(&lang, query)
        .unwrap_or_else(|err| panic!("{name} ({ext}) ast-grep compile failed: {err}"));
    let octo = compile_matcher_octo(&lang, query)
        .unwrap_or_else(|err| panic!("{name} ({ext}) octocode compile failed: {err}"));

    let (ast_grep_matches, ast_grep_duration) = run_timed(&ast_grep, content);
    let (octo_matches, octo_duration) = run_timed(&octo, content);

    assert_matches_equal(name, ext, pattern, rule, &ast_grep_matches, &octo_matches);

    ComparisonOutcome {
        ast_grep_duration,
        octo_duration,
        matches: ast_grep_matches.len(),
    }
}

fn assert_matches_equal(
    name: &str,
    ext: &str,
    pattern: Option<&str>,
    rule: Option<&str>,
    ast_grep_matches: &[ComparableMatch],
    octo_matches: &[ComparableMatch],
) {
    if ast_grep_matches == octo_matches {
        return;
    }

    let first_diff = ast_grep_matches
        .iter()
        .zip(octo_matches)
        .position(|(left, right)| left != right);
    let ast_preview = first_diff
        .and_then(|index| ast_grep_matches.get(index))
        .or_else(|| ast_grep_matches.get(octo_matches.len()));
    let octo_preview = first_diff
        .and_then(|index| octo_matches.get(index))
        .or_else(|| octo_matches.get(ast_grep_matches.len()));

    panic!(
        "{name} ({ext}) differed for pattern={pattern:?} rule={rule:?}; ast-grep count={}, octocode count={}, first_diff={first_diff:?}, ast-grep={ast_preview:#?}, octocode={octo_preview:#?}",
        ast_grep_matches.len(),
        octo_matches.len()
    );
}

fn run_timed(matcher: &CompiledMatcher, content: &str) -> (Vec<ComparableMatch>, Duration) {
    let start = Instant::now();
    let matches = matcher(content)
        .into_iter()
        .map(ComparableMatch::from)
        .collect();
    (matches, start.elapsed())
}

fn sample_path(file: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("benchmark")
        .join("ast")
        .join("samples")
        .join(file)
}

#[test]
#[allow(clippy::print_stderr)]
fn octocode_matcher_matches_ast_grep_on_canonical_patterns() {
    let cases = [
        QueryCase {
            name: "typescript-call",
            ext: "ts",
            content: "const a = foo(bar);\nconst b = foo(baz);\n",
            pattern: Some("foo($X)"),
            rule: None,
        },
        QueryCase {
            name: "javascript-multi-capture",
            ext: "js",
            content: "log(1, 2, 3);\n",
            pattern: Some("log($$$ARGS)"),
            rule: None,
        },
        QueryCase {
            name: "javascript-repeated-capture-guarded-call",
            ext: "js",
            content: "foo && foo();\nbar && baz();\n",
            pattern: Some("$A && $A()"),
            rule: None,
        },
        QueryCase {
            name: "python-expando",
            ext: "py",
            content: "print(hello)\nprint(world)\n",
            pattern: Some("print($X)"),
            rule: None,
        },
        QueryCase {
            name: "rust-expando",
            ext: "rs",
            content: "fn main() {\n    println(a);\n    println(b);\n}\n",
            pattern: Some("println($X)"),
            rule: None,
        },
        QueryCase {
            name: "html-tag-capture",
            ext: "html",
            content: "<input>\n",
            pattern: Some("<$TAG>"),
            rule: None,
        },
        QueryCase {
            name: "css-declaration",
            ext: "css",
            content: ".btn {\n  color: red;\n}\n",
            pattern: Some(".btn { color: $C; }"),
            rule: None,
        },
        QueryCase {
            name: "json-pair",
            ext: "json",
            content: "{\n  \"a\": 1,\n  \"b\": 2\n}\n",
            pattern: Some("$K: $V"),
            rule: None,
        },
        QueryCase {
            name: "yaml-pair",
            ext: "yaml",
            content: "a: 1\nb: 2\n",
            pattern: Some("$K: $V"),
            rule: None,
        },
        QueryCase {
            name: "inside-rule",
            ext: "ts",
            content: "async function f() {\n  for (const x of xs) {\n    await g(x);\n  }\n  await h();\n}\n",
            pattern: None,
            rule: Some("rule:\n  pattern: await $C\n  inside:\n    kind: for_in_statement\n    stopBy: end\n"),
        },
        QueryCase {
            name: "composition-rule",
            ext: "ts",
            content: "foo(a);\nbar(b);\neval(c);\n",
            pattern: None,
            rule: Some("rule:\n  kind: call_expression\n  not:\n    pattern: eval($X)\n"),
        },
    ];

    let mut total = 0usize;
    let mut ast_grep_total = Duration::ZERO;
    let mut octo_total = Duration::ZERO;
    for case in cases {
        let outcome = compare_case(case.name, case.ext, case.content, case.pattern, case.rule);
        total += outcome.matches;
        ast_grep_total += outcome.ast_grep_duration;
        octo_total += outcome.octo_duration;
    }

    eprintln!(
        "canonical structural comparison: {} cases, {} matches, ast-grep {:?}, octocode {:?}",
        cases.len(),
        total,
        ast_grep_total,
        octo_total
    );
}

#[test]
#[allow(clippy::print_stderr)]
fn octocode_matcher_matches_ast_grep_on_real_benchmark_samples() {
    let cases = [
        SampleCase {
            name: "typescript-root",
            ext: "ts",
            file: "typescript-utilitiesPublic.ts",
            pattern: Some("$$$"),
            rule: None,
        },
        SampleCase {
            name: "tsx-root",
            ext: "tsx",
            file: "antd-InternalTable.tsx",
            pattern: Some("$$$"),
            rule: None,
        },
        SampleCase {
            name: "javascript-calls",
            ext: "js",
            file: "express-application.js",
            pattern: None,
            rule: Some("rule:\n  kind: call_expression\n"),
        },
        SampleCase {
            name: "python-calls",
            ext: "py",
            file: "httpx-client.py",
            pattern: None,
            rule: Some("rule:\n  kind: call\n"),
        },
        SampleCase {
            name: "go-calls",
            ext: "go",
            file: "go-fmt-print.go",
            pattern: None,
            rule: Some("rule:\n  kind: call_expression\n"),
        },
        SampleCase {
            name: "rust-calls",
            ext: "rs",
            file: "rust-core-option.rs",
            pattern: None,
            rule: Some("rule:\n  kind: call_expression\n"),
        },
        SampleCase {
            name: "java-method-invocations",
            ext: "java",
            file: "spring-StringUtils.java",
            pattern: None,
            rule: Some("rule:\n  kind: method_invocation\n"),
        },
        SampleCase {
            name: "c-calls",
            ext: "c",
            file: "git-add.c",
            pattern: None,
            rule: Some("rule:\n  kind: call_expression\n"),
        },
        SampleCase {
            name: "cpp-calls",
            ext: "cpp",
            file: "llvm-raw_ostream.cpp",
            pattern: None,
            rule: Some("rule:\n  kind: call_expression\n"),
        },
        SampleCase {
            name: "csharp-invocations",
            ext: "cs",
            file: "dotnet-String.cs",
            pattern: None,
            rule: Some("rule:\n  kind: invocation_expression\n"),
        },
        SampleCase {
            name: "bash-commands",
            ext: "sh",
            file: "nvm.sh",
            pattern: None,
            rule: Some("rule:\n  kind: command\n"),
        },
        SampleCase {
            name: "html-elements",
            ext: "html",
            file: "mdl-dashboard.html",
            pattern: None,
            rule: Some("rule:\n  kind: element\n"),
        },
        SampleCase {
            name: "css-rules",
            ext: "css",
            file: "bootstrap-grid.css",
            pattern: None,
            rule: Some("rule:\n  kind: rule_set\n"),
        },
        SampleCase {
            name: "scss-rules",
            ext: "scss",
            file: "bootstrap-variables.scss",
            pattern: None,
            rule: Some("rule:\n  kind: rule_set\n"),
        },
        SampleCase {
            name: "less-rules",
            ext: "less",
            file: "bootstrap-navbar.less",
            pattern: None,
            rule: Some("rule:\n  kind: rule_set\n"),
        },
        SampleCase {
            name: "scala-calls",
            ext: "scala",
            file: "scala-List.scala",
            pattern: None,
            rule: Some("rule:\n  kind: call_expression\n"),
        },
        SampleCase {
            name: "json-pairs",
            ext: "json",
            file: "vscode-package.json",
            pattern: None,
            rule: Some("rule:\n  kind: pair\n"),
        },
        SampleCase {
            name: "yaml-mapping-pairs",
            ext: "yaml",
            file: "home-assistant-ci.yaml",
            pattern: None,
            rule: Some("rule:\n  kind: block_mapping_pair\n"),
        },
        SampleCase {
            name: "toml-pairs",
            ext: "toml",
            file: "pip-pyproject.toml",
            pattern: None,
            rule: Some("rule:\n  kind: pair\n"),
        },
    ];

    let mut total = 0usize;
    let mut ast_grep_total = Duration::ZERO;
    let mut octo_total = Duration::ZERO;
    for case in cases {
        let content = fs::read_to_string(sample_path(case.file))
            .unwrap_or_else(|err| panic!("read real sample {}: {err}", case.file));
        let outcome = compare_case(case.name, case.ext, &content, case.pattern, case.rule);
        total += outcome.matches;
        ast_grep_total += outcome.ast_grep_duration;
        octo_total += outcome.octo_duration;
    }

    eprintln!(
        "real-sample structural comparison: {} cases, {} matches, ast-grep {:?}, octocode {:?}",
        cases.len(),
        total,
        ast_grep_total,
        octo_total
    );
}
