import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Vlastní doména/subdoména vyžaduje, aby base byla vždy '/'
  base: '/',
  plugins: [react(), tailwindcss()],
  // Bez tohohle Vite interně resolvuje symlinky (viz scripts/run-vite-safe.mjs)
  // zpátky na jejich reálnou cestu - a ta obsahuje "?" ("Are you in?"), který
  // Vite někde po cestě chybně vyhodnotí jako query string oddělovač, takže
  // selže načtení souboru ("Does the file exist?") a prohlížeč dostane
  // netransformovaný JSX zdroj místo zkompilovaného JS.
  resolve: {
    preserveSymlinks: true,
  },
  build: {
    rolldownOptions: {
      // Název vstupu se propíše do názvů souborů: assets/ruin.<hash>.js a .css
      input: { ruin: fileURLToPath(new URL('./index.html', import.meta.url)) },
      // Hash zůstává kvůli cache (mění se s obsahem), jen hexadecimální a za tečkou
      output: {
        hashCharacters: 'hex',
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
