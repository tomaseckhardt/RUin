import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // The tests are TypeScript (type-checked by npm run typecheck).
    files: ['tests/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended],
  },
  {
    files: ['tests/componentsTests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.jest },
    },
  },
  {
    // Playwright: the test runs in Node and drives the browser.
    files: ['tests/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
])
