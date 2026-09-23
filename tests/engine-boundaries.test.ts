// Static guards on src/engine. They keep the Classic ruleset (worldhand.ts)
// isolated from new-mode code and keep the whole engine deterministic.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ENGINE = join(import.meta.dirname, '..', 'src', 'engine')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : []
  })
}
const sources = files(ENGINE).map((p) => ({ path: relative(ENGINE, p), text: readFileSync(p, 'utf8') }))
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
// `… from 'x'` (import/export), side-effect `import 'x'`, and dynamic `import('x')`
const importsOf = (text: string) => [...code(text).matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)]
  .map((m) => m[1] ?? m[2] ?? m[3])
const inside = (path: string, dir: string) => path.startsWith(dir + '/')

describe('engine boundaries', () => {
  it('scans the engine sources', () => {
    expect(sources.map((s) => s.path)).toEqual(expect.arrayContaining(['worldhand.ts', 'rng.ts', 'poker.ts', 'core/streams.ts', 'ascension/ascension.ts']))
  })

  it('the engine imports only other engine modules', () => {
    for (const s of sources) for (const spec of importsOf(s.text)) {
      expect(spec.startsWith('.'), `${s.path} imports "${spec}"`).toBe(true)
    }
  })

  it('the Classic ruleset (worldhand.ts) imports only rng.ts and poker.ts', () => {
    const classic = sources.find((s) => s.path === 'worldhand.ts')!
    expect([...new Set(importsOf(classic.text))].sort()).toEqual(['./poker', './rng'])
  })

  it('shared modules never import a ruleset, and new-mode code never imports Classic', () => {
    for (const s of sources) {
      const shared = s.path === 'rng.ts' || s.path === 'poker.ts' || inside(s.path, 'core')
      for (const spec of importsOf(s.text)) {
        if (shared) expect(spec, `shared ${s.path} imports "${spec}"`).not.toMatch(/worldhand|ascension/)
        if (s.path !== 'worldhand.ts') expect(spec, `${s.path} imports Classic`).not.toMatch(/worldhand/)
      }
    }
  })

  it('the engine is deterministic: no clock, Math.random or browser globals', () => {
    const banned = /\bMath\.random\b|\bDate\b|\bperformance\b|\bcrypto\b|\bwindow\b|\bdocument\b|\blocalStorage\b|\bsessionStorage\b|\bnavigator\b/
    for (const s of sources) {
      const hit = code(s.text).split('\n').findIndex((line) => banned.test(line))
      expect(hit, `${s.path}:${hit + 1} uses a non-deterministic or browser API`).toBe(-1)
    }
  })
})
