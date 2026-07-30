import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const clientRoot = path.resolve(__dirname, '..')
const safeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'r-u-in-client-'))
const command = process.argv[2] || 'dev'
const extraArgs = process.argv.slice(3)

function syncBuildOutput() {
  const sourceDist = path.join(safeRoot, 'dist')
  const targetDist = path.join(clientRoot, 'dist')

  if (!fs.existsSync(sourceDist)) {
    return
  }

  fs.rmSync(targetDist, { recursive: true, force: true })
  fs.cpSync(sourceDist, targetDist, { recursive: true, force: true })
}

// Vite (and, separately, Jest) misbehave when the project path contains
// certain characters - this repo's parent folder has a literal space and a
// "?" in it ("Are you in?"), which Vite's own module runner resolves back
// to a real path and then mis-parses as a URL (the "?" is read as a query
// string separator). This used to work around it by deep-copying the whole
// project into a temp dir without those characters and running Vite there -
// which meant Vite's file watcher only ever saw that one-time copy, so
// editing real source files during `npm run dev` did nothing until the
// process was killed and restarted.
//
// Symlinking `src`/`public` instead of copying them fixes that: Vite's dev
// server reads a file's *content* fresh on every request regardless of
// whether the path is a symlink, so edits to the real files show up
// immediately. Everything else (node_modules, vite.config.js, package.json,
// ...) is still copied for real, not symlinked - `vite.config.js` and any
// module it imports (starting with `vite` itself) get loaded through Vite's
// Node-side module runner, which is exactly what hits the realpath/URL bug
// above if it resolves through a symlink back into the real project path.
// Those are rarely edited during a dev session, so copying them once at
// startup (instead of a symlink that would forward live edits) is an
// acceptable trade-off - restart `npm run dev` after changing
// vite.config.js/package.json, same as you would for most Vite projects
// anyway. `dist` is left out entirely so `build` always produces a real,
// fresh directory here for syncBuildOutput() to copy out.
const LIVE_SYMLINK_ENTRIES = new Set(['src', 'public'])

for (const entry of fs.readdirSync(clientRoot)) {
  if (entry === 'dist') {
    continue
  }

  const target = path.join(safeRoot, entry)

  if (LIVE_SYMLINK_ENTRIES.has(entry)) {
    fs.symlinkSync(path.join(clientRoot, entry), target)
  } else {
    fs.cpSync(path.join(clientRoot, entry), target, { recursive: true, force: true, dereference: true })
  }
}

const viteCli = path.join(safeRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const args = [command, '--configLoader', 'runner', ...extraArgs]

const child = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', viteCli, ...args], {
  cwd: safeRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    FORCE_COLOR: '1',
  },
})

child.on('exit', (code) => {
  if ((code ?? 0) === 0 && command === 'build') {
    syncBuildOutput()
  }

  try {
    fs.rmSync(safeRoot, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup of per-process temp workspace.
  }

  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})