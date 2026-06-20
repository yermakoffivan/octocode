#!/usr/bin/env node
// AST benchmark check — proves every supported tree-sitter grammar works
// end-to-end through the shipped octocode-engine napi binary, run over the REAL
// third-party files in ast/samples/ (see ast/manifest.json for provenance).
//
// Per grammar:
//   PARSE     — structuralSearch(<real sample>, "$$$") yields nodes ("$$$"
//               matches any node sequence, so >0 proves the grammar loaded and
//               parsed the real file; catches ABI mismatches that only surface
//               at parse time).
//   MATCH     — structuralSearch(<canonical snippet>, <pattern>) resolves the
//               expected metavars (proves the ast-grep query engine, not just
//               that the file parsed).
//   SIGNATURE — signature-tier grammars must return a non-empty skeleton from
//               extractSignatures(<real sample>) AND from the canonical snippet.
//
// A coverage pass asserts every extension in getSupportedStructuralExtensions()
// is claimed by exactly one grammar entry, so a new engine grammar without a
// sample + proof here fails the check. Exits non-zero on any failure.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..', '..')
const engine = createRequire(import.meta.url)(join(pkgRoot, 'index.cjs'))
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
const sampleFor = new Map(manifest.samples.map((s) => [s.ext, s]))

const PARSE_PROBE = '$$$'

// One entry per distinct tree-sitter Language. `sig:true` => non-empty
// body_query (must produce a signature skeleton). `aliases` resolve to the SAME
// grammar — coverage-checked + parse-probed, share the representative's sample.
const GRAMMARS = [
  { name: 'TypeScript', ext: 'ts', aliases: ['mts', 'cts'], sig: true, snippet: 'const a = foo(bar);\n', pattern: 'foo($X)', min: 1, sigSnippet: 'export function foo(a: number): number {\n  return a + 1;\n}\n' },
  { name: 'TSX', ext: 'tsx', aliases: [], sig: true, snippet: 'const a = foo(bar);\n', pattern: 'foo($X)', min: 1, sigSnippet: 'export function Foo(a: number): number {\n  return a + 1;\n}\n' },
  { name: 'JavaScript', ext: 'js', aliases: ['jsx', 'mjs', 'cjs'], sig: true, snippet: 'log(1, 2, 3);\n', pattern: 'log($$$A)', min: 1, sigSnippet: 'function foo(a) {\n  return a + 1;\n}\n' },
  { name: 'Python', ext: 'py', aliases: ['pyi'], sig: true, snippet: 'print(x)\n', pattern: 'print($X)', min: 1, sigSnippet: 'def foo(a):\n    return a + 1\n' },
  { name: 'Go', ext: 'go', aliases: [], sig: true, snippet: 'package m\nfunc f() { foo(x) }\n', rule: 'rule:\n  kind: call_expression\n', min: 1, sigSnippet: 'package m\nfunc Foo() int {\n  return 1\n}\n' },
  { name: 'Rust', ext: 'rs', aliases: [], sig: true, snippet: 'fn f() { let _ = g(y); }\n', rule: 'rule:\n  kind: call_expression\n', min: 1, sigSnippet: 'fn foo() -> i32 {\n  1\n}\n' },
  { name: 'Java', ext: 'java', aliases: [], sig: true, snippet: 'class A { void m() { foo(x); } }\n', rule: 'rule:\n  kind: method_invocation\n', min: 1, sigSnippet: 'class A {\n  int foo() {\n    return 1;\n  }\n}\n' },
  { name: 'C', ext: 'c', aliases: ['h'], sig: true, snippet: 'int main() { foo(x); }\n', pattern: 'foo($X);', min: 1, sigSnippet: 'int foo(void) {\n  return 1;\n}\n' },
  { name: 'Bash', ext: 'sh', aliases: ['bash', 'zsh'], sig: true, snippet: 'echo hi\nfoo bar baz\n', pattern: PARSE_PROBE, min: 1, sigSnippet: 'foo() {\n  echo hi\n}\n' },
  { name: 'HTML', ext: 'html', aliases: ['htm'], sig: false, snippet: '<div><button id="go">Hi</button></div>', pattern: '<button id="go">$$$</button>', min: 1 },
  { name: 'CSS', ext: 'css', aliases: [], sig: false, snippet: '.btn { color: red; }', pattern: '.btn { color: $C; }', min: 1 },
  { name: 'SCSS', ext: 'scss', aliases: [], sig: false, snippet: '.card { color: red; }', pattern: '.card { color: $C; }', min: 1 },
  { name: 'Less', ext: 'less', aliases: [], sig: false, snippet: '.box { width: 10px; }', pattern: '.box { width: $W; }', min: 1 },
  { name: 'Scala', ext: 'scala', aliases: ['sc', 'sbt'], sig: false, snippet: 'object A { println(x) }', pattern: 'println($X)', min: 1 },
  { name: 'JSON', ext: 'json', aliases: ['jsonc'], sig: false, snippet: '{"a": 1, "b": 2}', pattern: '$K: $V', min: 1 },
  { name: 'YAML', ext: 'yaml', aliases: ['yml'], sig: false, snippet: 'a: 1\nb: 2\n', pattern: '$K: $V', min: 1 },
  { name: 'TOML', ext: 'toml', aliases: [], sig: false, snippet: 'name = "x"\nver = 2\n', pattern: PARSE_PROBE, min: 1 },
  { name: 'C++', ext: 'cpp', aliases: ['hpp', 'cc', 'cxx', 'hh', 'hxx'], sig: true, snippet: 'int main() { foo(x); }\n', rule: 'rule:\n  kind: call_expression\n', min: 1, sigSnippet: 'int foo() {\n  return 1;\n}\n' },
  { name: 'C#', ext: 'cs', aliases: [], sig: true, snippet: 'class A { void M() { Foo(x); } }\n', rule: 'rule:\n  kind: invocation_expression\n', min: 1, sigSnippet: 'class A {\n  int Foo() {\n    return 1;\n  }\n}\n' },
]

const structuralExts = new Set(engine.getSupportedStructuralExtensions())
const signatureExts = new Set(engine.getSupportedSignatureExtensions())
const sc = (content, ext, pattern) => engine.structuralSearch(content, `probe.${ext}`, pattern, null).length
const scRule = (content, ext, rule) => engine.structuralSearch(content, `probe.${ext}`, null, rule).length

const rows = []
const failures = []
const claimed = new Map()
const claim = (ext, name) => { if (claimed.has(ext)) failures.push(`coverage: ${ext} claimed by ${claimed.get(ext)} and ${name}`); claimed.set(ext, name) }

for (const g of GRAMMARS) {
  const issues = []
  claim(g.ext, g.name)
  for (const a of g.aliases) claim(a, g.name)

  // CONTRACT
  if (!structuralExts.has(g.ext)) issues.push('not in structural list')
  if (signatureExts.has(g.ext) !== g.sig) issues.push(g.sig ? 'engine reports structural-only, expected signature' : 'engine reports signature, expected structural-only')
  for (const a of g.aliases) if (!structuralExts.has(a)) issues.push(`alias ${a} not in structural list`)

  // PARSE (real sample)
  const sample = sampleFor.get(g.ext)
  let parseInfo = 'no sample'
  let content = ''
  if (!sample) {
    issues.push(`no sample in ast/manifest.json`)
  } else {
    const p = join(here, 'samples', sample.file)
    if (!existsSync(p)) { issues.push(`sample file missing: ${sample.file}`) }
    else {
      content = readFileSync(p, 'utf8')
      let nodes = 0
      try { nodes = sc(content, g.ext, PARSE_PROBE) } catch (e) { issues.push(`parse threw: ${e.message}`) }
      if (nodes <= 0) issues.push('real sample parsed 0 nodes')
      parseInfo = `${nodes} nodes`
      for (const a of g.aliases) {
        try { if (sc(content, a, PARSE_PROBE) <= 0) issues.push(`alias ${a} parsed 0 nodes`) } catch (e) { issues.push(`alias ${a} threw: ${e.message}`) }
      }
    }
  }

  // MATCH (canonical snippet)
  let matches = 0
  const queryLabel = g.pattern || g.rule.trim().split('\n').join(' ')
  try { matches = g.pattern ? sc(g.snippet, g.ext, g.pattern) : scRule(g.snippet, g.ext, g.rule) } catch (e) { issues.push(`match threw: ${e.message}`) }
  if (matches < g.min) issues.push(`canonical match got ${matches}, expected >=${g.min} for \`${queryLabel}\``)

  // SIGNATURE (signature-tier)
  let sigInfo = g.sig ? '' : 'n/a'
  if (g.sig) {
    let canon = null
    try { canon = engine.extractSignatures(g.sigSnippet, `probe.${g.ext}`) } catch (e) { issues.push(`signature threw: ${e.message}`) }
    if (!canon || !canon.trim()) issues.push('canonical signature null/empty')
    let realLines = 0
    if (content) { const real = engine.extractSignatures(content, `probe.${g.ext}`); realLines = real ? real.split('\n').filter(Boolean).length : 0; if (!real) issues.push('real sample signature null') }
    sigInfo = `${realLines} lines`
  }

  const ok = issues.length === 0
  if (!ok) failures.push(`${g.name}: ${issues.join('; ')}`)
  rows.push({ name: g.name, ext: g.ext, tier: g.sig ? 'sig' : 'struct', parse: parseInfo, match: matches, sig: sigInfo, ok })
}

for (const ext of structuralExts) if (!claimed.has(ext)) failures.push(`coverage: engine supports ".${ext}" but no grammar entry claims it`)

const pad = (s, n) => String(s).padEnd(n)
console.log(`\nAST benchmark — ${rows.length} grammars over real samples (ast/samples/)`)
console.log(`${pad('Grammar', 12)} ${pad('ext', 6)} ${pad('tier', 7)} ${pad('parse', 12)} ${pad('match', 6)} ${pad('signature', 10)} status`)
console.log('-'.repeat(72))
for (const r of rows) console.log(`${pad(r.name, 12)} ${pad(r.ext, 6)} ${pad(r.tier, 7)} ${pad(r.parse, 12)} ${pad(r.match, 6)} ${pad(r.sig, 10)} ${r.ok ? 'PASS' : 'FAIL'}`)
console.log(`\nCoverage: ${claimed.size}/${structuralExts.size} declared structural extensions claimed.`)

if (failures.length) { console.error(`\n✗ AST check FAILED (${failures.length}):`); for (const f of failures) console.error(`  • ${f}`); process.exit(1) }
console.log(`\n✓ all ${rows.length} grammars working (parse + match + signature) on real samples.`)
