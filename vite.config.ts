import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5177, strictPort: true },
  preview: { port: 5177, strictPort: true },
  build: {
    // The largest chunk is three.js, loaded lazily with the globe (~550 kB);
    // the entry chunk is ~260 kB. Warn if either grows past this.
    chunkSizeWarningLimit: 600,
  },
})
