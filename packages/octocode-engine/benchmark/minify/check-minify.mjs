#!/usr/bin/env node
// Minify benchmark check — runs the octocode-engine minifier over every sample
// in this folder (one per discovered extension) and asserts it produces output
// without failing. This is the "is minify working for every configured format"
// gate; the size/strategy report is regenerated separately by
// generate-real-code-report.mjs.
//
// Each minify/<lang>/ holds raw/source.excerpt.txt (a real excerpt) and
// raw/metadata.json (provenance, incl. the original source filename → its
// extension). The minifier picks its strategy from that extension.
//
// Exits non-zero if any sample fails to minify (failed=true or empty output).

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..', '..')
const engine = createRequire(import.meta.url)(join(pkgRoot, 'index.cjs'))
const fileTypes = engine.getMINIFY_CONFIG().fileTypes

// Discover sample dirs: any subdir with raw/source.excerpt.txt.
const dirs = readdirSync(here, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(here, d.name, 'raw', 'source.excerpt.txt')))
  .map((d) => d.name)
  .sort()

const rows = []
const failures = []
const cases = []
const realExtensions = new Set()

for (const dir of dirs) {
  const base = join(here, dir, 'raw')
  const content = readFileSync(join(base, 'source.excerpt.txt'), 'utf8')
  // Prefer the real source filename's extension from metadata; fall back to dir.
  let ext = dir
  const metaPath = join(base, 'metadata.json')
  if (existsSync(metaPath)) {
    try { const m = JSON.parse(readFileSync(metaPath, 'utf8')); if (m.source) ext = extname(m.source).replace(/^\./, '') || dir } catch { /* keep dir */ }
  }
  ext = ext.toLowerCase()
  realExtensions.add(ext)
  cases.push({ name: dir, ext, content, kind: 'real' })
}

for (const ext of Object.keys(fileTypes).sort()) {
  if (realExtensions.has(ext)) continue
  cases.push({
    name: `synthetic:${ext}`,
    ext,
    content: syntheticSampleFor(ext),
    kind: 'synthetic',
  })
}

for (const testCase of cases) {
  const { name, ext, content, kind } = testCase;
  const filePath = `sample.${ext}`

  let res = null
  try { res = engine.minifyContentResult(content, filePath) } catch (e) { failures.push(`${name}: minify threw: ${e.message}`); continue }

  const out = res.content || ''
  const ok = !res.failed && out.length > 0
  if (!ok) failures.push(`${name}: failed=${res.failed}${res.reason ? ` (${res.reason})` : ''}, out=${out.length}B`)

  const deterministic = JSON.stringify({
    failed: res.failed,
    type: res.type,
    reason: res.reason ?? null,
    content: res.content,
  })
  for (let i = 0; i < 4; i += 1) {
    const next = engine.minifyContentResult(content, filePath)
    const snapshot = JSON.stringify({
      failed: next.failed,
      type: next.type,
      reason: next.reason ?? null,
      content: next.content,
    })
    if (snapshot !== deterministic) {
      failures.push(`${name}: minifyContentResult is not deterministic on repeat ${i + 1}`)
      break
    }
  }

  for (const [api, fn] of [
    ['applyMinification', engine.applyMinification],
    ['applyContentViewMinification', engine.applyContentViewMinification],
  ]) {
    const first = fn(content, filePath)
    if (first.length > content.length) {
      failures.push(`${name}: ${api} grew output from ${content.length}B to ${first.length}B`)
    }
    for (let i = 0; i < 4; i += 1) {
      const next = fn(content, filePath)
      if (next !== first) {
        failures.push(`${name}: ${api} is not deterministic on repeat ${i + 1}`)
        break
      }
    }
  }

  const cut = content.length > 0 ? (((content.length - out.length) / content.length) * 100).toFixed(1) : '0.0'
  rows.push({ name, ext, kind, type: res.type, inB: content.length, outB: out.length, cut, ok })
}

const testedExtensions = new Set(cases.map((testCase) => testCase.ext))
for (const ext of Object.keys(fileTypes).sort()) {
  if (!testedExtensions.has(ext)) failures.push(`configured extension .${ext} was not tested`)
}

const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)
const realCount = rows.filter((row) => row.kind === 'real').length
const syntheticCount = rows.length - realCount
console.log(`\nMinify benchmark — ${rows.length} samples (${realCount} real, ${syntheticCount} synthetic)`)
console.log(`${pad('sample', 20)} ${pad('kind', 10)} ${pad('ext', 8)} ${pad('strategy', 14)} ${padL('in', 8)} ${padL('out', 8)} ${padL('cut%', 7)} status`)
console.log('-'.repeat(88))
for (const r of rows) console.log(`${pad(r.name, 20)} ${pad(r.kind, 10)} ${pad(r.ext, 8)} ${pad(r.type, 14)} ${padL(r.inB, 8)} ${padL(r.outB, 8)} ${padL(r.cut, 7)} ${r.ok ? 'PASS' : 'FAIL'}`)

if (failures.length) { console.error(`\n✗ minify check FAILED (${failures.length}):`); for (const f of failures) console.error(`  • ${f}`); process.exit(1) }
console.log(`\n✓ all ${rows.length} samples cover every configured minify extension and are deterministic.`)

function syntheticSampleFor(ext) {
  if (['json', 'jsonc', 'json5'].includes(ext)) {
    return '{\n  // generated fixture\n  "name": "octocode",\n  "items": [1, 2, 3],\n}\n'
  }
  if (['md', 'markdown'].includes(ext)) {
    return '# Generated Fixture\n\nA wrapped paragraph with enough words to normalize.\n\n<!-- hidden -->\n'
  }
  if (['html', 'htm', 'vue', 'svelte'].includes(ext)) {
    return '<!-- hidden --><style>.card { margin: 0px; color: red; }</style><script>const value = 1; // comment</script><section>Hi</section>\n'
  }
  if (['xml', 'svg', 'xsl', 'xslt'].includes(ext)) {
    return '<root><!-- hidden --><child value="1">Hi</child></root>\n'
  }
  if (['css', 'scss', 'less', 'sass', 'styl'].includes(ext)) {
    return '.card {\n  /* generated fixture */\n  margin: 0px;\n  color: red;\n}\n'
  }
  if (['py', 'pyi'].includes(ext)) {
    return '# generated fixture\ndef value() -> int:\n    return 1\n'
  }
  if (['sh', 'bash', 'zsh', 'fish'].includes(ext)) {
    return '# generated fixture\nvalue() {\n  echo hi\n}\n'
  }
  if (['sql', 'tsql', 'plsql'].includes(ext)) {
    return '-- generated fixture\nSELECT id, name FROM users WHERE active = 1;\n'
  }
  if (['yaml', 'yml'].includes(ext)) {
    return '# generated fixture\nname: octocode\nitems:\n  - one\n  - two\n'
  }
  if (['toml', 'ini', 'cfg', 'conf', 'config', 'env', 'properties'].includes(ext)) {
    return '# generated fixture\nname = "octocode"\ncount = 2\n'
  }
  if (['vb', 'vbs'].includes(ext)) {
    return "' generated fixture\nFunction Value()\n  Value = 1\nEnd Function\n"
  }
  if (['erl', 'hrl'].includes(ext)) {
    return '% generated fixture\nvalue() -> 1.\n'
  }
  if (['hs', 'lhs'].includes(ext)) {
    return '-- generated fixture\nvalue = 1\n'
  }
  if (['lisp', 'lsp', 'scm', 'rkt', 'clj', 'cljs', 'asm', 'nasm'].includes(ext)) {
    return '; generated fixture\n(value 1)\n'
  }
  return '/* generated fixture */\nfunction value(input) {\n  return input + 1;\n}\n\nvalue(1);\n'
}
