#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
  throw new Error('macOS releases must be built natively on the target architecture.')
}

const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const { version } = require('../package.json')
const tag = `v${version}`
const arch = process.arch
const assets = [
  `release/Blockout-${version}-mac-${arch}.dmg`,
  `release/Blockout-${version}-mac-${arch}.dmg.blockmap`,
  `release/Blockout-${version}-mac-${arch}.zip`,
  `release/Blockout-${version}-mac-${arch}.zip.blockmap`,
  'release/latest-mac.yml'
]

const run = (command, args, extraEnv = {}) =>
  execFileSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit'
  })

run(process.execPath, [resolve(root, 'scripts/package-macos.mjs')], { BLOCKOUT_PUBLISH: 'never' })

for (const asset of assets) {
  if (!existsSync(resolve(root, asset))) throw new Error(`Missing release asset: ${asset}`)
}

try {
  run('gh', ['release', 'view', tag])
} catch {
  run('gh', [
    'release',
    'create',
    tag,
    '--target',
    'feat/agent-director-v1',
    '--title',
    `Blockout ${version}`,
    '--notes',
    `Blockout ${version} macOS release for GitHub auto-updates.`
  ])
}

run('gh', ['release', 'upload', tag, ...assets, '--clobber'])
run('gh', ['release', 'edit', tag, '--draft=false'])
console.log(`Published ${tag} with ${assets.length} macOS update assets.`)
