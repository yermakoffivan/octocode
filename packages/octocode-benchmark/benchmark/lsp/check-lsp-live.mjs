#!/usr/bin/env node
// Live LSP quality check — spawns a REAL language server through the engine's
// NativeLspClient and exercises every LSP operation type against a known file,
// asserting each returns a quality result. This is the only check that proves
// the server-backed path (not just config wiring).
//
// Defaults to TypeScript (typescript-language-server, resolved from the repo's
// node_modules). If the server can't be resolved/started, the check SKIPS with
// a clear message and exits 0 — it is environment-dependent and therefore NOT
// part of run-all. Run it manually with `yarn lsp:live`.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { engine, engineRoot } from '../_engine.mjs'

const SAMPLE = `export interface Shape { area(): number }

export class Circle implements Shape {
  constructor(private r: number) {}
  area(): number { return Math.PI * this.r * this.r }
}

export function describe(s: Shape): string {
  return \`area=\${s.area()}\`
}

const c = new Circle(2)
const out = describe(c)
console.log(out)
`

const dir = mkdtempSync(join(tmpdir(), 'octocode-lsp-'))
const file = join(dir, 'sample.ts')
writeFileSync(file, SAMPLE)

// Resolve the server against the repo root so node_modules is found.
const cfg = engine.getLanguageServerForFile(file, engineRoot)
const skip = (msg) => { console.log(`↷ LSP live check SKIPPED: ${msg}`); rmSync(dir, { recursive: true, force: true }); process.exit(0) }
if (!cfg || !cfg.command) skip('no server config resolved')
if (!engine.isCommandAvailable(cfg.command)) skip(`server not available: ${cfg.command}`)

const client = new engine.NativeLspClient(cfg)
const results = []
const rec = (op, ok, detail) => { results.push({ op, ok }); console.log(`${ok ? '✓' : '✗'} ${op.padEnd(16)} ${detail}`) }

try {
  await client.start()
  await client.waitForReady(20000)
  await client.openDocument(file, SAMPLE)
  await new Promise((r) => setTimeout(r, 1500))
} catch (e) {
  console.error('server stderr:', (client.getRecentStderr?.() || []).slice(-5).join('\n'))
  skip(`could not start server: ${e.message}`)
}

console.log(`\nLSP live quality — ${cfg.languageId} via ${cfg.command.split('/').pop()}\n`)
try {
  const sym = await client.getDocumentSymbols(file); const n = Array.isArray(sym) ? sym.length : (sym ? Object.keys(sym).length : 0)
  rec('documentSymbols', n > 0, `${n} symbols`)
  const def = await client.getDefinition(file, 12, 13); rec('definition', def.length > 0, `${def.length} hit(s)`)
  const ref = await client.getReferences(file, 0, 17, true); rec('references', ref.length > 0, `${ref.length} reference(s)`)
  const hov = await client.getHover(file, 12, 13); rec('hover', !!hov && JSON.stringify(hov).length > 2, `${hov ? JSON.stringify(hov).length : 0} chars`)
  const td = await client.getTypeDefinition(file, 11, 6); rec('typeDefinition', Array.isArray(td) && td.length > 0, `${(td || []).length} hit(s)`)
  const impl = await client.getImplementation(file, 0, 17); rec('implementation', Array.isArray(impl) && impl.length > 0, `${(impl || []).length} hit(s)`)
  const prep = await client.prepareCallHierarchy(file, 12, 13); const items = Array.isArray(prep) ? prep : (prep ? [prep] : [])
  let chOk = false, chDetail = 'no prepare item'
  if (items.length) { const inc = await client.incomingCalls(items[0]); const out = await client.outgoingCalls(items[0]); chOk = true; chDetail = `incoming ${(inc || []).length}, outgoing ${(out || []).length}` }
  rec('callHierarchy', chOk, chDetail)
  await client.stop()
} catch (e) { console.error('error during ops:', e.message); rmSync(dir, { recursive: true, force: true }); process.exit(1) }

rmSync(dir, { recursive: true, force: true })
const ok = results.filter((r) => r.ok).length
console.log(`\n${ok === results.length ? '✓' : '✗'} ${ok}/${results.length} LSP operation types working with quality results`)
process.exit(ok === results.length ? 0 : 1)
