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

// Discover sample dirs: any subdir with raw/source.excerpt.txt.
const dirs = readdirSync(here, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(here, d.name, 'raw', 'source.excerpt.txt')))
  .map((d) => d.name)
  .sort()

const rows = []
const failures = []

for (const dir of dirs) {
  const base = join(here, dir, 'raw')
  const content = readFileSync(join(base, 'source.excerpt.txt'), 'utf8')
  // Prefer the real source filename's extension from metadata; fall back to dir.
  let ext = dir
  const metaPath = join(base, 'metadata.json')
  if (existsSync(metaPath)) {
    try { const m = JSON.parse(readFileSync(metaPath, 'utf8')); if (m.source) ext = extname(m.source).replace(/^\./, '') || dir } catch { /* keep dir */ }
  }

  let res = null
  try { res = engine.minifyContentResult(content, `sample.${ext}`) } catch (e) { failures.push(`${dir}: minify threw: ${e.message}`); continue }

  const out = res.content || ''
  const ok = !res.failed && out.length > 0
  if (!ok) failures.push(`${dir}: failed=${res.failed}${res.reason ? ` (${res.reason})` : ''}, out=${out.length}B`)
  const cut = content.length > 0 ? (((content.length - out.length) / content.length) * 100).toFixed(1) : '0.0'
  rows.push({ dir, ext, type: res.type, inB: content.length, outB: out.length, cut, ok })
}

const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)
console.log(`\nMinify benchmark — ${rows.length} samples`)
console.log(`${pad('sample', 10)} ${pad('ext', 8)} ${pad('strategy', 14)} ${padL('in', 8)} ${padL('out', 8)} ${padL('cut%', 7)} status`)
console.log('-'.repeat(64))
for (const r of rows) console.log(`${pad(r.dir, 10)} ${pad(r.ext, 8)} ${pad(r.type, 14)} ${padL(r.inB, 8)} ${padL(r.outB, 8)} ${padL(r.cut, 7)} ${r.ok ? 'PASS' : 'FAIL'}`)

if (failures.length) { console.error(`\n✗ minify check FAILED (${failures.length}):`); for (const f of failures) console.error(`  • ${f}`); process.exit(1) }
console.log(`\n✓ all ${rows.length} samples minify successfully via octocode-engine.`)
