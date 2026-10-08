import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [cloudflare(), react()],
  // localhost serves the app and 127.0.0.1 serves isles, so the two are separate origins in dev too
  server: { host: true, port: 5190, strictPort: true },
})
