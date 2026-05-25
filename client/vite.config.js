import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const env = globalThis.process?.env ?? {}
const repositoryName = env.GITHUB_REPOSITORY?.split('/')[1]
const basePath =
  env.VITE_BASE_PATH ||
  (env.GITHUB_ACTIONS ? `/${repositoryName || 'RUin-'}/` : '/')

// https://vite.dev/config/
export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
