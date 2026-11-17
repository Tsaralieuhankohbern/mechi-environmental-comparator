import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build`         -> static site in dist/ (GitHub Pages)
// `npm run build:single`  -> one self-contained dist-single/index.html (share as a single file)
const single = process.env.SINGLE_FILE === '1'

export default defineConfig({
  base: './',
  plugins: [react(), ...(single ? [viteSingleFile()] : [])],
  build: { outDir: single ? 'dist-single' : 'dist', chunkSizeWarningLimit: 2000 },
})
