import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const clientRoot = path.resolve(__dirname, '..')
const safeRoot = path.join(os.tmpdir(), 'r-u-in-client')
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

try {
  fs.rmSync(safeRoot, { recursive: true, force: true })
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error
  }
}

fs.cpSync(clientRoot, safeRoot, {
  recursive: true,
  force: true,
  dereference: true,
})

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

  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})