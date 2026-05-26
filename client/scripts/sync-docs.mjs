import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientDir = resolve(__dirname, '..')
const projectDir = resolve(clientDir, '..')
const docsDir = resolve(projectDir, 'docs-site')
const docsOutputDir = resolve(docsDir, 'dist')
const targetDir = resolve(clientDir, 'public', 'docs')

execSync('npm run build', {
  cwd: docsDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DOCS_BASE_PATH: process.env.DOCS_BASE_PATH ?? '/ai/dev/docs',
  },
})

if (!existsSync(docsOutputDir)) {
  throw new Error(`Docs build output not found: ${docsOutputDir}`)
}

rmSync(targetDir, { recursive: true, force: true })
mkdirSync(resolve(clientDir, 'public'), { recursive: true })
cpSync(docsOutputDir, targetDir, { recursive: true })

console.log(`[sync-docs] Synced ${docsOutputDir} -> ${targetDir}`)
