// Node ESM resolution hook: let `./rng` resolve to `./rng.ts` so the .mjs
// probe scripts can import the TypeScript engine directly (Node >=22 strips
// types but does not try extension candidates). Used as
//   node --import ./scripts/ts-resolve.mjs scripts/<probe>.mjs
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (err) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw err
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        try {
          const cand = new URL(specifier + ext, context.parentURL)
          if (existsSync(fileURLToPath(cand))) return next(specifier + ext, context)
        } catch { /* try next extension */ }
      }
      throw err
    }
  },
})
