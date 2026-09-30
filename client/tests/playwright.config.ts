import { defineConfig, devices } from '@playwright/test'
import { SUPABASE_URL } from './fakeSupabase.ts'

const PORT = 5288

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  outputDir: 'test-results',
  // A whole walk-through takes 10-12 s locally; CI runners are slower.
  timeout: process.env.CI ? 30_000 : 15_000,
  // Both languages at once. Both tests live in one file, and Playwright only
  // splits a file between workers when fullyParallel is on.
  fullyParallel: true,
  workers: 2,
  expect: { timeout: 10_000 },
  // No retries, in CI either: a flaky step should fail loudly, not pass on a rerun.
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    // CI runners come with Google Chrome, so CI skips downloading a browser.
    ...(process.env.CI ? { channel: 'chrome' } : {}),
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
    // run-vite-safe.mjs copies the project to dodge the "?" in the local
    // folder name; CI's checkout path is plain, so it runs Vite directly.
    command: process.env.CI
      ? `npx vite --port ${PORT} --strictPort`
      : // The Node running Playwright, not `node` from PATH: the VS Code
        // extension starts this through a shell without nvm's PATH.
        `"${process.execPath}" scripts/run-vite-safe.mjs dev --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    // SIGTERM lets run-vite-safe.mjs delete its temp copy of the project
    // (~240 MB); the default SIGKILL left one behind in /tmp on every run.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    timeout: 120_000,
    env: { VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'e2e-anon-key', VITE_VAPID_PUBLIC_KEY: '' },
  },
})
