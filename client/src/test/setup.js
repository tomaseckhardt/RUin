import { TextDecoder, TextEncoder } from 'node:util'
import '@testing-library/jest-dom'

// jsdom doesn't provide these; react-router-dom needs them at import time.
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder
}
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = TextDecoder
}

// Stand-in for Vite's `import.meta.env` (rewritten to this global by
// babel-plugin-import-meta-env.cjs) so modules reading it don't throw in Jest.
globalThis.__vite_import_meta__ = {
  env: {
    BASE_URL: '/',
    VITE_SUPABASE_URL: 'https://test-project.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    VITE_VAPID_PUBLIC_KEY: '',
  },
}
