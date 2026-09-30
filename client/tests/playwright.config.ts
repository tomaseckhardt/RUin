import { defineConfig, devices } from '@playwright/test'
import { SUPABASE_URL } from './fakeSupabase.ts'

const PORT = 5288

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  outputDir: 'test-results',
  timeout: 180_000,
  // One language after the other: the dev server is slow when both hit it.
  workers: 2,
  // The RSVP celebration alone keeps the page busy for 4.5 s.
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    timezoneId: 'Europe/Prague',
    // Requests from a service worker would bypass the fake backend.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  // Always a fresh dev server built against the fake Supabase URL - never
  // one already running, which would talk to the real project.
  webServer: {
    command: `node scripts/run-vite-safe.mjs dev --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'e2e-anon-key', VITE_VAPID_PUBLIC_KEY: '' },
  },
})
