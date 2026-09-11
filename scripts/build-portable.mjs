// Portable/offline release build: one self-contained HTML file.
//
// Why a separate build: the normal `npm run build` emits an ES-module entry
// plus external asset URLs, which a browser refuses to load over `file://`
// (module scripts are CORS-checked; `file://` is an opaque origin). This build
// emits a single classic IIFE script and one stylesheet, then inlines both into
// the HTML, so `dist-portable/worldhand.html` runs by double-clicking it — no
// server, no network, no backend, no accounts, no tracking.
//
// Run: npm run build:portable
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'dist-portable')

await build({
  root,
  configFile: false,
  plugins: [react()],
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
    assetsDir: '.',
    cssCodeSplit: false,
    // No separate asset files: anything small enough becomes a data URI, and
    // the JS/CSS below are inlined by hand.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
})

const html = readFileSync(resolve(outDir, 'index.html'), 'utf8')
const js = readFileSync(resolve(outDir, 'app.js'), 'utf8')
const css = readFileSync(resolve(outDir, 'app.css'), 'utf8')

// `</script` inside a JS string literal would close the inline script tag.
const safeJs = js.replace(/<\/script/gi, '<\\/script')

// The inline script is CLASSIC, not a module, so it is NOT deferred: it has to
// sit at the end of <body> or it runs before #root exists (React error #299).
let out = html
  .replace(/<script[^>]*src="[^"]*app\.js"[^>]*><\/script>\s*/i, '')
  .replace(/<link[^>]*href="[^"]*app\.css"[^>]*>/i, () => `<style>\n${css}\n</style>`)
  .replace(/<\/body>/i, () => `<script>\n${safeJs}\n</script>\n</body>`)
if (!/<script>/.test(out)) throw new Error('failed to inline the entry script')

// Fail loudly rather than shipping an artifact that silently needs a server.
for (const [what, re] of [['script', /<script[^>]*\ssrc=/i], ['stylesheet', /<link[^>]*\shref="(?!data:)/i]]) {
  if (re.test(out)) throw new Error(`portable build still references an external ${what} — not self-contained`)
}
if (!out.includes('createRoot') && !/<script>\s*\S/.test(out)) throw new Error('portable build has no inline script')

const file = resolve(outDir, 'worldhand.html')
writeFileSync(file, out)
rmSync(resolve(outDir, 'app.js'))
rmSync(resolve(outDir, 'app.css'))
rmSync(resolve(outDir, 'index.html'))

console.log(`portable artifact: ${file} (${(statSync(file).size / 1024 / 1024).toFixed(2)} MB, self-contained)`)
