import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const benchmarkRoot = dirname(fileURLToPath(import.meta.url))
export const packageRoot = join(benchmarkRoot, '..')
export const engineRoot = join(packageRoot, '..', 'octocode-engine')

export const requireEngine = createRequire(import.meta.url)
export const engine = requireEngine(join(engineRoot, 'index.cjs'))
