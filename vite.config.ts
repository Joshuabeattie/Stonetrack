import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The React app lives in client/. In development Vite serves it on port 5000
// (the port Replit shows in the preview) and forwards every /api request to the
// Express API on API_PORT (3001). In production `vite build` writes static files
// to dist/client and Express serves them, so there is only one port.
const apiPort = process.env.API_PORT ?? '3001'

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    // Replit opens the dev server through *.replit.dev, which Vite would block by default.
    allowedHosts: ['.replit.dev', '.repl.co', '.replit.app'],
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
})
