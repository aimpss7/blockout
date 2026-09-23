#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return fallback
  }
}

function safeStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function defaultOutputRoot() {
  if (process.env.BLOCKOUT_HANDOFF_DIR) return resolve(process.env.BLOCKOUT_HANDOFF_DIR)
  const googleDrive = join(homedir(), 'Мой диск')
  if (existsSync(googleDrive)) return join(googleDrive, 'Blockout handoffs')
  return join(root, '.handoff')
}

function copyIfExists(from, toDir) {
  const source = join(root, from)
  if (!existsSync(source)) return
  copyFileSync(source, join(toDir, basename(from)))
}

const branch = git(['branch', '--show-current'], 'unknown')
const commit = git(['rev-parse', 'HEAD'], 'unknown')
const shortCommit = commit.slice(0, 12)
const remote = git(['remote', 'get-url', 'origin'], 'unknown')
const status = git(['status', '--short', '--branch'], 'git status unavailable')
const outRoot = defaultOutputRoot()
const outDir = join(outRoot, `blockout-handoff-${safeStamp()}-${shortCommit}`)

mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, 'docs'), { recursive: true })

writeFileSync(join(outDir, 'git-status.txt'), `${status}\n`, 'utf8')
writeFileSync(join(outDir, 'git-log.txt'), `${git(['log', '--oneline', '-30'], 'git log unavailable')}\n`, 'utf8')
writeFileSync(join(outDir, 'git-remote.txt'), `${git(['remote', '-v'], 'git remote unavailable')}\n`, 'utf8')
writeFileSync(join(outDir, 'git-diff.patch'), `${git(['diff'], '')}\n`, 'utf8')
writeFileSync(join(outDir, 'git-diff-staged.patch'), `${git(['diff', '--cached'], '')}\n`, 'utf8')

copyIfExists('AGENTS.md', outDir)
copyIfExists('package.json', outDir)
copyIfExists('docs/AGENT_HANDOFF.md', join(outDir, 'docs'))
copyIfExists('docs/AGENT_DIRECTOR_ROADMAP.md', join(outDir, 'docs'))
copyIfExists('docs/CONTINUITY.md', join(outDir, 'docs'))
copyIfExists('mcp/README.md', outDir)

const bundlePath = join(outDir, `blockout-${branch || 'branch'}-${shortCommit}.bundle`)
try {
  execFileSync('git', ['bundle', 'create', bundlePath, '--all'], { cwd: root, stdio: 'ignore' })
} catch (error) {
  writeFileSync(join(outDir, 'bundle-error.txt'), `${String(error)}\n`, 'utf8')
}

const prompt = `Работай в ветке ${branch}. Сначала прочитай docs/AGENT_HANDOFF.md, затем AGENTS.md и docs/CONTINUITY.md. Продолжай с Recommended next sequence. Не добавляй большие функции, пока validation/fix pass не зелёный.`

writeFileSync(
  join(outDir, 'README_CONTINUE.md'),
  `# Blockout Continuity Bundle

Created: ${new Date().toISOString()}
Branch: ${branch}
Commit: ${commit}
Remote: ${remote}

## Prompt for a new Codex agent

${prompt}

## Preferred recovery path

1. Clone or open the GitHub repo.
2. Checkout \`${branch}\`.
3. Read \`docs/AGENT_HANDOFF.md\`, \`AGENTS.md\`, and \`docs/CONTINUITY.md\`.
4. Check \`git-status.txt\` and \`git-diff.patch\` from this bundle.

## If GitHub is unavailable

Use the \`.bundle\` file in this folder:

\`\`\`bash
git clone ${basename(bundlePath)} blockout
cd blockout
git checkout ${branch}
\`\`\`

## Quick validation commands

\`\`\`bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
\`\`\`
`,
  'utf8'
)

writeFileSync(
  join(outDir, 'metadata.json'),
  JSON.stringify({ createdAt: new Date().toISOString(), branch, commit, remote, status }, null, 2) + '\n',
  'utf8'
)

console.log(outDir)
