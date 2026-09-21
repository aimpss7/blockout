/**
 * Agent Director e2e: prove the high-level MCP/control workflow that is meant
 * to replace dozens of low-level tool calls.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let port = 0
let token = ''
let smokeDir = ''
let motionPath = ''

async function rpc<T>(
  action: string,
  params: Record<string, unknown> = {}
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, params })
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { ok: boolean; data?: T; error?: string }
}

test.beforeAll(async () => {
  smokeDir = mkdtempSync(join(tmpdir(), 'blockout-agent-director-'))
  motionPath = join(smokeDir, 'camera_motion.json')
  writeFileSync(
    motionPath,
    JSON.stringify({
      fps: 12,
      duration: 1,
      width: 1920,
      height: 1080,
      frames: [
        { time: 0, cameraMove: { pan: 0, tilt: 0, dollyZoom: 1, roll: 0 }, confidence: 1 },
        { time: 0.5, cameraMove: { pan: 0.12, tilt: -0.04, dollyZoom: 1.08, roll: 0.02 }, confidence: 0.9 },
        { time: 1, cameraMove: { pan: 0.2, tilt: -0.08, dollyZoom: 1.15, roll: 0.04 }, confidence: 0.85 }
      ],
      summary: { averageConfidence: 0.92 }
    }),
    'utf8'
  )
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: smokeDir }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'New Project' }).click()
  await expect(page.locator('.mode-switch')).toBeVisible({ timeout: 30_000 })

  const configDir =
    process.platform === 'win32'
      ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'blockout')
      : join(homedir(), '.config', 'blockout')
  const descriptor = JSON.parse(readFileSync(join(configDir, 'control.json'), 'utf8')) as {
    port: number
    token: string
  }
  port = descriptor.port
  token = descriptor.token
})

test.afterAll(async () => {
  await app?.close()
})

test('atomic shot plan → camera recipe → one-sheet review → Seedance export', async () => {
  const first = await rpc<{ stateToken: string }>('get_state')
  expect(first.ok).toBe(true)
  const initialToken = first.data!.stateToken

  const replaced = await rpc<{
    stateToken: string
    entities: Record<string, string>
  }>('compile_shot', {
    _expectedStateToken: initialToken,
    intent: 'hero approaches vehicle',
    cameraRecipeId: 'hero-arc',
    cameraSubjectKey: 'hero',
    heroFrameTime: 0.6,
    lighting: 'day',
    entities: [
      {
        key: 'hero',
        assetId: 'person.man',
        label: 'HERO',
        x: 0,
        z: 0,
        marks: [
          { time: 0, x: 0, z: 0, gait: 'stand' },
          { time: 1, x: 0.8, z: -0.5, gait: 'walk' }
        ]
      },
      {
        key: 'car',
        assetId: 'vehicle.suv',
        label: 'CAR',
        x: 2.2,
        z: -2,
        rotationDeg: 15
      }
    ],
    shot: {
      name: '1A',
      duration: 1,
      fps: 24,
      aspect: '16:9',
      rig: 'dolly',
      cameraMarks: [
        { time: 0, x: -4, y: 1.5, z: 4, panDeg: 40, tiltDeg: -3, focalLength: 35 },
        { time: 1, x: -3.2, y: 1.5, z: 3.3, panDeg: 40, tiltDeg: -3, focalLength: 35 }
      ]
    }
  })
  expect(replaced.ok).toBe(true)
  expect(replaced.data?.entities.hero).toBeTruthy()
  expect(replaced.data?.stateToken).not.toBe(initialToken)

  // Old reviewed state must not overwrite the new scene.
  const stale = await rpc('replace_scene', {
    _expectedStateToken: initialToken,
    entities: [{ assetId: 'person.man', x: 0, z: 0 }],
    shot: { duration: 1 }
  })
  expect(stale.ok).toBe(false)
  expect(stale.error).toContain('stale state')

  const recipes = await rpc<{ id: string }[]>('list_camera_recipes')
  expect(recipes.data?.some((recipe) => recipe.id === 'hero-arc')).toBe(true)

  const measured = await rpc<{ stateToken: string; markCount: number; source: string }>(
    'import_motion_previs_camera',
    {
      _expectedStateToken: replaced.data!.stateToken,
      cameraMotionPath: motionPath,
      targetFps: 6,
      durationMode: 'fit-shot'
    }
  )
  expect(measured.ok).toBe(true)
  expect(measured.data?.markCount).toBeGreaterThanOrEqual(3)
  expect(measured.data?.source).toContain('refs/')

  const review = await rpc<{
    imageBase64: string
    stateToken: string
    times: number[]
    heroFrameTime: number | null
    heroFrameApproved: boolean
  }>('review_shot', {
    _expectedStateToken: measured.data!.stateToken,
    maxFrames: 5
  })
  expect(review.ok).toBe(true)
  expect(review.data?.imageBase64.length).toBeGreaterThan(1000)
  expect(review.data?.times.length).toBeGreaterThanOrEqual(2)
  expect(review.data?.times).toContain(0.6)
  expect(review.data?.heroFrameApproved).toBe(false)

  const approved = await rpc<{ stateToken: string; approved: boolean }>('approve_hero_frame', {
    _expectedStateToken: review.data!.stateToken,
    time: 0.6
  })
  expect(approved.ok).toBe(true)
  expect(approved.data?.approved).toBe(true)

  // Approved camera/framing is now protected from an agent recipe overwrite.
  const lockedRecipe = await rpc('apply_camera_recipe', {
    _expectedStateToken: approved.data!.stateToken,
    recipeId: 'intimate-push',
    entityId: replaced.data!.entities.hero
  })
  expect(lockedRecipe.ok).toBe(false)
  expect(lockedRecipe.error).toContain('human lock')

  const exported = await rpc<{ packagePath: string; profileId: string }>('export_shot', {
    _expectedStateToken: approved.data!.stateToken,
    profileId: 'seedance-2.5',
    clean: true,
    depth: false,
    normal: false,
    labels: 'off',
    resolution: '720p'
  })
  expect(exported.ok).toBe(true)
  expect(exported.data?.profileId).toBe('seedance-2.5')
  expect(existsSync(join(exported.data!.packagePath, 'reference_roles.json'))).toBe(true)
})
