// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Renderer side of the agent control server (see src/main/control.ts and
 * mcp/blockout-mcp.mjs). External agents — Claude Code, Codex, Hermes, any
 * MCP client — drive the app through a whitelist of actions executed here
 * against the same store/scene paths the UI uses, so everything an agent
 * does is undoable, autosaved, and visible live.
 */

import { useStore } from '../store'
import { ASSET_CATALOG, assetSpec, entityHeight } from '@engine/assets'
import { createActorMark, createCameraMark, createEntity } from '@engine/schema'
import { newId } from '@engine/ids'
import { exportShot, renderReviewSheet, renderReviewSheetPng, renderStillPngForTest, type ExportResolution } from '../export/exporter'
import { getSceneManager } from '../export/scene-access'
import type { AspectId, GaitId, LightingPresetId, RigId } from '@engine/types'
import type { ChoreoKind, FormationId, RoutineSpec } from '@engine/choreography'
import type { FramingKind } from '../bus'
import { CAMERA_RECIPES, directorStateToken, getCameraRecipe, reviewTimes } from '@engine/director'
import { CAMERA_MOVE_PRESETS } from '@engine/camera-moves'
import { BUILTIN_PROFILES, profileSupportsAspect } from '@engine/profiles'
import { ShotEvaluator } from '@engine/evaluate'
import { motionPrevisToCameraSpecs, validateMotionPrevisCameraData } from '@engine/motion-previs'
import { validateShotPlan, shotPlanExample } from '@engine/shot-plan'

type Params = Record<string, unknown>
type ControlResult = { ok: boolean; data?: unknown; error?: string }

const str = (p: Params, k: string): string | undefined =>
  typeof p[k] === 'string' ? (p[k] as string) : undefined
const flt = (p: Params, k: string): number | undefined =>
  typeof p[k] === 'number' && isFinite(p[k] as number) ? (p[k] as number) : undefined
const bool = (p: Params, k: string): boolean | undefined =>
  typeof p[k] === 'boolean' ? (p[k] as boolean) : undefined
const strList = (p: Params, k: string): string[] =>
  Array.isArray(p[k]) ? (p[k] as unknown[]).filter((v): v is string => typeof v === 'string') : []

const toRad = (deg: number): number => (deg * Math.PI) / 180
const toDeg = (rad: number): number => Math.round((rad * 180) / Math.PI)

function requireManager(): NonNullable<ReturnType<typeof getSceneManager>> {
  const m = getSceneManager()
  if (!m) throw new Error('Viewport not ready yet — try again in a moment.')
  return m
}

function requireDoc(): void {
  if (!useStore.getState().doc) {
    throw new Error('No project open — create or open a project in the app first.')
  }
}

function currentStateToken(): string {
  const state = useStore.getState()
  return directorStateToken(state.doc, state.sceneId, state.shotId)
}

function assertExpectedState(params: Params, required = true): void {
  const expected = str(params, '_expectedStateToken')
  if (!expected) {
    if (required) {
      throw new Error('_expectedStateToken is required — call get_state, review the current shot, then retry.')
    }
    return
  }
  const current = currentStateToken()
  if (expected !== current) {
    throw new Error(`stale state: expected ${expected}, current ${current}. Call get_state and review before mutating.`)
  }
}

function asParams(value: unknown, label: string): Params {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Params
}

function mutationPrefix(params: Params): 'ui' | 'agent' {
  return str(params, '_historySource') === 'human' ? 'ui' : 'agent'
}

function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

const LIGHTING_PRESETS: LightingPresetId[] = [
  'day',
  'goldenHour',
  'night',
  'interiorWarm',
  'interiorCool',
  'club',
  'middaySky',
  'goldenHourSky',
  'blueHourSky'
]
const CAMERA_RIGS: RigId[] = ['sticks', 'dolly', 'steadicam', 'handheld', 'crane', 'drone', 'carMount']

function summary(detail: 'compact' | 'full' = 'compact'): unknown {
  const s = useStore.getState()
  const scene = s.scene()
  const shot = s.shot()
  const take = scene?.blocking.find((b) => b.id === shot?.blockingTakeId)
  return {
    project: s.doc?.name ?? null,
    projectFolder: s.projectFolder,
    stateToken: currentStateToken(),
    mode: s.mode,
    time: s.time,
    scene: scene
      ? {
          id: scene.id,
          name: scene.name,
          lighting: scene.environment.lighting,
          entities: scene.entities.map((e) => ({
            id: e.id,
            name: e.name,
            assetId: e.assetId,
            x: e.transform.position.x,
            y: e.transform.position.y,
            z: e.transform.position.z,
            rotationDeg: toDeg(e.transform.rotationY),
            label: e.label?.text,
            attachedTo: e.attachedTo,
            markCount: take?.tracks.find((t) => t.entityId === e.id)?.marks.length ?? 0
          })),
          scans: (scene.scans ?? []).map((sc) => ({
            id: sc.id,
            name: sc.name,
            visible: sc.visible,
            x: sc.position.x,
            y: sc.position.y,
            z: sc.position.z,
            rotationDeg: toDeg(sc.rotationY),
            scale: sc.scale
          }))
        }
      : null,
    shot: shot
      ? {
          id: shot.id,
          name: shot.name,
          duration: shot.duration,
          fps: shot.fps,
          aspect: shot.aspect,
          camera: shot.cameraName ?? 'A',
          director: shot.director
            ? {
                intent: shot.director.intent ?? null,
                cameraRecipeId: shot.director.cameraRecipeId ?? null,
                heroFrameTime: shot.director.heroFrameTime ?? null,
                heroFrameApproved: shot.director.heroFrameApproved ?? false,
                locks: shot.director.locks ?? {}
              }
            : null,
          trackEntityId: shot.camera.trackEntityId ?? null,
          cameraMarkCount: shot.camera.marks.length,
          cameraMarks:
            detail === 'full'
              ? shot.camera.marks.map((m, i) => ({
                  index: i + 1,
                  time: m.time,
                  x: m.position.x,
                  y: m.position.y,
                  z: m.position.z,
                  panDeg: toDeg(m.pan),
                  tiltDeg: toDeg(m.tilt),
                  rollDeg: toDeg(m.roll),
                  focalLength: m.focalLength
                }))
              : undefined,
          actorTracks:
            detail === 'full'
              ? (take?.tracks ?? []).map((track) => ({
                  entityId: track.entityId,
                  marks: track.marks.map((m) => ({
                    time: m.time,
                    x: m.position.x,
                    y: m.position.y,
                    z: m.position.z,
                    gait: m.gait
                  }))
                }))
              : undefined
        }
      : null,
    allShots: scene?.shots.map((sh) => ({ id: sh.id, name: sh.name })) ?? [],
    conventions:
      'meters; +X right, -Z forward; heading/pan 0 faces -Z; rotationDeg/panDeg clockwise from above'
  }
}

/**
 * Build a validated `RoutineSpec` from control params (shared by
 * spawn_choreography and choreograph_entities). The engine stays pure — this
 * renderer side picks the default seed when none is supplied.
 */
function routineSpecFromParams(params: Params): RoutineSpec {
  const kind = str(params, 'kind') as ChoreoKind | undefined
  if (!kind || !['dance', 'fight', 'chase'].includes(kind)) {
    throw new Error("kind must be 'dance', 'fight', or 'chase'.")
  }
  const spec: RoutineSpec = {
    kind,
    performers: Math.round(flt(params, 'performers') ?? (kind === 'dance' ? 6 : 2)),
    durationS: flt(params, 'durationS') ?? useStore.getState().shot()?.duration ?? 8,
    seed: flt(params, 'seed') ?? Math.floor(Math.random() * 1e9)
  }
  const style = str(params, 'style')
  if (style) spec.style = style
  const bpm = flt(params, 'bpm')
  if (bpm !== undefined) spec.bpm = bpm
  const formation = str(params, 'formation')
  if (formation) spec.formation = formation as FormationId
  const ending = str(params, 'ending')
  if (ending) spec.ending = ending
  const canon = bool(params, 'canon')
  if (canon !== undefined) spec.canon = canon
  const mirror = bool(params, 'mirror')
  if (mirror !== undefined) spec.mirror = mirror
  const formationChange = bool(params, 'formationChange')
  if (formationChange !== undefined) spec.formationChange = formationChange
  return spec
}

export async function executeControlAction(action: string, params: Params = {}): Promise<unknown> {
  const s = useStore.getState()
  switch (action) {
    case 'get_state': {
      const detail = str(params, 'detail') === 'full' ? 'full' : 'compact'
      return summary(detail)
    }

    case 'list_assets': {
      const cat = str(params, 'category')
      return ASSET_CATALOG.filter((a) => !cat || a.category === cat).map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        params:
          a.id === 'prim.cube' || a.id === 'prim.ramp' || a.id === 'prim.wall'
            ? ['width', 'height', 'depth']
            : a.id === 'prim.cylinder'
              ? ['radius', 'height']
              : a.id === 'prim.stairs'
                ? ['width', 'height', 'depth', 'steps']
                : a.id.startsWith('person.')
                  ? ['height', 'build']
                  : undefined
      }))
    }

    case 'replace_scene': {
      requireDoc()
      assertExpectedState(params)
      if (s.exportProgress.running) throw new Error('Cannot replace the scene while an export is running.')
      const existingLocks = s.shot()?.director?.locks
      if (existingLocks?.staging || (existingLocks?.blockingEntityIds?.length ?? 0) > 0) {
        throw new Error('human lock: staging/blocking is protected. Clear the lock before replacing the scene.')
      }

      const rawEntities = params.entities
      const rawShot = asParams(params.shot, 'shot')
      if (!Array.isArray(rawEntities) || rawEntities.length < 1 || rawEntities.length > 32) {
        throw new Error('entities must contain 1–32 scene entities.')
      }

      const duration = Math.min(600, Math.max(0.5, flt(rawShot, 'duration') ?? s.shot()?.duration ?? 5))
      const fpsRaw = flt(rawShot, 'fps') ?? s.shot()?.fps ?? 24
      const fps = fpsRaw === 25 || fpsRaw === 30 ? fpsRaw : 24
      const aspectRaw = str(rawShot, 'aspect') as AspectId | undefined
      const aspect: AspectId =
        aspectRaw && ['16:9', '9:16', '3:4', '4:5', '2.39:1', '4:3', '1:1'].includes(aspectRaw)
          ? aspectRaw
          : s.shot()?.aspect ?? '16:9'
      const rigRaw = str(rawShot, 'rig') as RigId | undefined
      if (rigRaw && !CAMERA_RIGS.includes(rigRaw)) throw new Error(`Unknown camera rig "${rigRaw}".`)
      const lightingRaw = str(params, 'lighting') as LightingPresetId | undefined
      if (lightingRaw && !LIGHTING_PRESETS.includes(lightingRaw)) {
        throw new Error(`Unknown lighting preset "${lightingRaw}".`)
      }

      const keys = new Set<string>()
      const built = rawEntities.map((value, index) => {
        const raw = asParams(value, `entities[${index}]`)
        const key = str(raw, 'key') ?? `entity-${index + 1}`
        if (keys.has(key)) throw new Error(`Duplicate entity key "${key}".`)
        keys.add(key)

        const assetId = str(raw, 'assetId') ?? ''
        const spec = assetSpec(assetId)
        if (!spec || !ASSET_CATALOG.some((asset) => asset.id === assetId)) {
          throw new Error(`Unknown assetId "${assetId}" for entity "${key}".`)
        }
        const entity = createEntity(
          assetId,
          str(raw, 'name') ?? spec.name,
          { x: flt(raw, 'x') ?? 0, y: flt(raw, 'y') ?? 0, z: flt(raw, 'z') ?? 0 }
        )
        entity.transform.rotationY = toRad(flt(raw, 'rotationDeg') ?? 0)
        entity.transform.scale = Math.min(20, Math.max(0.05, flt(raw, 'scale') ?? 1))
        const objectColor = str(raw, 'color')
        if (objectColor && /^#[0-9a-fA-F]{6}$/.test(objectColor)) entity.color = objectColor
        if (raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)) {
          entity.params = Object.fromEntries(
            Object.entries(raw.params as Record<string, unknown>).filter(
              (entry): entry is [string, number | string] =>
                (typeof entry[1] === 'number' && isFinite(entry[1])) || typeof entry[1] === 'string'
            )
          )
        }
        const label = str(raw, 'label')
        if (label) entity.label = { text: label, color: '#3b82f6' }

        const rawMarks = raw.marks
        if (rawMarks !== undefined && !Array.isArray(rawMarks)) {
          throw new Error(`entities[${index}].marks must be an array.`)
        }
        const marks = (Array.isArray(rawMarks) ? rawMarks : []).map((markValue, markIndex) => {
          const markRaw = asParams(markValue, `entities[${index}].marks[${markIndex}]`)
          const gait = (str(markRaw, 'gait') ?? 'walk') as GaitId
          const allowedGaits: GaitId[] = ['stand', 'walk', 'jog', 'run', 'sit', 'lie', 'crouch', 'gesture', 'fall']
          if (!allowedGaits.includes(gait)) throw new Error(`Unknown gait "${gait}".`)
          const mark = createActorMark(
            {
              x: flt(markRaw, 'x') ?? entity.transform.position.x,
              y: flt(markRaw, 'y') ?? entity.transform.position.y,
              z: flt(markRaw, 'z') ?? entity.transform.position.z
            },
            Math.min(duration, Math.max(0, flt(markRaw, 'time') ?? 0)),
            gait
          )
          const hold = flt(markRaw, 'hold')
          const easeIn = flt(markRaw, 'easeIn')
          const easeOut = flt(markRaw, 'easeOut')
          const headingDeg = flt(markRaw, 'headingDeg')
          if (hold !== undefined) mark.hold = Math.max(0, hold)
          if (easeIn !== undefined) mark.easeIn = Math.min(1, Math.max(0, easeIn))
          if (easeOut !== undefined) mark.easeOut = Math.min(1, Math.max(0, easeOut))
          if (headingDeg !== undefined) mark.arriveHeading = toRad(headingDeg)
          if (markRaw.joints && typeof markRaw.joints === 'object' && !Array.isArray(markRaw.joints)) {
            mark.joints = Object.fromEntries(
              Object.entries(markRaw.joints as Record<string, unknown>).filter(
                (entry): entry is [string, number] => typeof entry[1] === 'number' && isFinite(entry[1])
              )
            )
          }
          return mark
        })
        return { key, entity, marks }
      })

      const rawCameraMarks = rawShot.cameraMarks
      if (rawCameraMarks !== undefined && !Array.isArray(rawCameraMarks)) {
        throw new Error('shot.cameraMarks must be an array when provided.')
      }
      const cameraMarks = (Array.isArray(rawCameraMarks) ? rawCameraMarks : []).map((value, index) => {
        const raw = asParams(value, `shot.cameraMarks[${index}]`)
        const mark = createCameraMark(
          { x: flt(raw, 'x') ?? 0, y: flt(raw, 'y') ?? 1.6, z: flt(raw, 'z') ?? 4 },
          Math.min(duration, Math.max(0, flt(raw, 'time') ?? 0)),
          toRad(flt(raw, 'panDeg') ?? 0),
          toRad(flt(raw, 'tiltDeg') ?? 0),
          flt(raw, 'focalLength') ?? 35
        )
        const rollDeg = flt(raw, 'rollDeg')
        const hold = flt(raw, 'hold')
        const easeIn = flt(raw, 'easeIn')
        const easeOut = flt(raw, 'easeOut')
        const focusDistance = flt(raw, 'focusDistance')
        if (rollDeg !== undefined) mark.roll = toRad(rollDeg)
        if (hold !== undefined) mark.hold = Math.max(0, hold)
        if (easeIn !== undefined) mark.easeIn = Math.min(1, Math.max(0, easeIn))
        if (easeOut !== undefined) mark.easeOut = Math.min(1, Math.max(0, easeOut))
        if (focusDistance !== undefined) mark.focusDistance = Math.max(0.01, focusDistance)
        return mark
      })

      const entityIdsByKey = Object.fromEntries(built.map((item) => [item.key, item.entity.id]))
      let replaced = false
      s.mutate(`${mutationPrefix(params)}: replace scene blueprint`, (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        const take = scene?.blocking.find((b) => b.id === shot?.blockingTakeId)
        if (!scene || !shot || !take) return

        scene.entities = built.map((item) => item.entity)
        take.tracks = built
          .filter((item) => item.marks.length > 0)
          .map((item) => ({ entityId: item.entity.id, marks: item.marks }))
        if (lightingRaw) scene.environment.lighting = lightingRaw

        shot.name = str(rawShot, 'name') ?? shot.name
        shot.duration = duration
        shot.fps = fps
        shot.aspect = aspect
        const notes = str(rawShot, 'notes')
        if (notes !== undefined) shot.notes = notes
        if (rigRaw) shot.camera.rig = rigRaw
        if (Array.isArray(rawCameraMarks)) shot.camera.marks = cameraMarks
        shot.director = {
          ...shot.director,
          heroFrameApproved: false,
          heroFrameTime: flt(rawShot, 'heroFrameTime') ?? shot.director?.heroFrameTime
        }

        const trackEntityKey = str(rawShot, 'trackEntityKey')
        if (trackEntityKey) {
          const target = entityIdsByKey[trackEntityKey]
          if (!target) throw new Error(`Unknown trackEntityKey "${trackEntityKey}".`)
          shot.camera.trackEntityId = target
        } else {
          delete shot.camera.trackEntityId
        }
        delete shot.camera.mountEntityId
        replaced = true
      })
      if (!replaced) throw new Error('No active scene/shot/blocking take to replace.')
      s.setTime(0)
      s.setSelection(null)
      return { replaced: true, entities: entityIdsByKey, stateToken: currentStateToken() }
    }

    case 'export_shot_plan': {
      requireDoc()
      const folder = s.projectFolder
      const scene = s.scene()
      const shot = s.shot()
      if (!folder || !scene || !shot) throw new Error('Open and save a project first.')
      const take = scene.blocking.find((item) => item.id === shot.blockingTakeId)
      const entities = scene.entities.map((entity, index) => {
        const track = take?.tracks.find((item) => item.entityId === entity.id)
        return {
          key: entity.label?.text?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `entity-${index + 1}`,
          assetId: entity.assetId,
          name: entity.name,
          label: entity.label?.text,
          x: entity.transform.position.x,
          y: entity.transform.position.y,
          z: entity.transform.position.z,
          rotationDeg: toDeg(entity.transform.rotationY),
          scale: entity.transform.scale,
          color: entity.color,
          params: entity.params,
          marks: track?.marks.map((mark) => ({
            time: mark.time,
            x: mark.position.x,
            y: mark.position.y,
            z: mark.position.z,
            gait: mark.gait,
            hold: mark.hold,
            easeIn: mark.easeIn,
            easeOut: mark.easeOut,
            headingDeg: mark.arriveHeading === undefined ? undefined : toDeg(mark.arriveHeading),
            joints: mark.joints
          }))
        }
      })
      const keyById = Object.fromEntries(entities.map((item, index) => [scene.entities[index]!.id, item.key]))
      const plan = validateShotPlan({
        ...shotPlanExample(),
        title: `${scene.name} / ${shot.name}`,
        intent: shot.director?.intent,
        cameraRecipeId: shot.director?.cameraRecipeId,
        cameraSubjectKey: shot.director?.cameraSubjectEntityId
          ? keyById[shot.director.cameraSubjectEntityId]
          : shot.camera.trackEntityId
            ? keyById[shot.camera.trackEntityId]
            : undefined,
        heroFrameTime: shot.director?.heroFrameTime,
        lighting: scene.environment.lighting,
        entities,
        shot: {
          name: shot.name,
          duration: shot.duration,
          fps: shot.fps,
          aspect: shot.aspect,
          rig: shot.camera.rig,
          notes: shot.notes,
          trackEntityKey: shot.camera.trackEntityId ? keyById[shot.camera.trackEntityId] : undefined,
          cameraMarks: shot.camera.marks.map((mark) => ({
            time: mark.time,
            x: mark.position.x,
            y: mark.position.y,
            z: mark.position.z,
            panDeg: toDeg(mark.pan),
            tiltDeg: toDeg(mark.tilt),
            rollDeg: toDeg(mark.roll),
            focalLength: mark.focalLength,
            focusDistance: mark.focusDistance,
            hold: mark.hold,
            easeIn: mark.easeIn,
            easeOut: mark.easeOut
          }))
        },
        provenance: {
          source: str(params, 'source') ?? 'human',
          createdAt: new Date().toISOString(),
          note: str(params, 'note')
        }
      })
      const safeName = `${scene.name}-${shot.name}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
      const stamp = new Date().toISOString().replace(/[:.T]/g, '-').replace('Z', '')
      const path = `${folder}/plans/${stamp}-${safeName}.shot.json`
      await window.blockout.exportWriteFile(path, JSON.stringify(plan, null, 2) + '\n')
      return { exported: true, path, stateToken: currentStateToken() }
    }

    case 'import_shot_plan': {
      requireDoc()
      assertExpectedState(params)
      const filePath = str(params, 'filePath') ?? ''
      if (!filePath) throw new Error('filePath is required.')
      const folder = s.projectFolder
      if (!folder) throw new Error('Open and save a project first.')
      const imported = await window.blockout.importPlan(folder, filePath)
      const bytes = await window.blockout.readProjectFile(folder, imported.relativePath)
      let parsed: unknown
      try {
        parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)))
      } catch {
        throw new Error('Shot Plan is not valid JSON.')
      }
      const plan = validateShotPlan(parsed)
      const compiled = await executeControlAction('compile_shot', {
        _expectedStateToken: currentStateToken(),
        intent: plan.intent,
        cameraRecipeId: plan.cameraRecipeId,
        cameraSubjectKey: plan.cameraSubjectKey,
        heroFrameTime: plan.heroFrameTime,
        lighting: plan.lighting,
        entities: plan.entities,
        shot: plan.shot,
        _historySource: str(params, '_historySource')
      })
      void window.blockout.appendHistoryEvent(folder, {
        type: 'shot-plan-import',
        source: plan.provenance?.source ?? 'import',
        label: plan.title ?? imported.name,
        sceneId: useStore.getState().sceneId,
        shotId: useStore.getState().shotId
      })
      return { imported: imported.relativePath, planTitle: plan.title ?? null, compiled }
    }

    case 'compile_shot': {
      requireDoc()
      // compile_shot is deliberately orchestration, not a second geometry engine:
      // one atomic blueprint, then the existing deterministic camera recipe.
      const replaced = (await executeControlAction('replace_scene', params)) as {
        replaced: boolean
        entities: Record<string, string>
        stateToken: string
      }
      let stateToken = replaced.stateToken
      const recipeId = str(params, 'cameraRecipeId')
      let appliedRecipe: string | null = null
      if (recipeId) {
        const subjectKey = str(params, 'cameraSubjectKey')
        const entityId = subjectKey ? replaced.entities[subjectKey] : undefined
        if (subjectKey && !entityId) {
          throw new Error(`Unknown cameraSubjectKey "${subjectKey}".`)
        }
        const applied = (await executeControlAction('apply_camera_recipe', {
          _expectedStateToken: stateToken,
          recipeId,
          entityId,
          _historySource: str(params, '_historySource')
        })) as { applied: string; stateToken: string }
        appliedRecipe = applied.applied
        stateToken = applied.stateToken
      }

      const intent = str(params, 'intent')
      const heroFrameTime = flt(params, 'heroFrameTime')
      if (intent !== undefined || heroFrameTime !== undefined) {
        assertExpectedState({ _expectedStateToken: stateToken })
        s.mutate(`${mutationPrefix(params)}: director shot metadata`, (doc) => {
          const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
          const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
          if (!shot) return
          shot.director = {
            ...shot.director,
            intent: intent ?? shot.director?.intent,
            cameraRecipeId: appliedRecipe ?? shot.director?.cameraRecipeId,
            heroFrameTime:
              heroFrameTime === undefined
                ? shot.director?.heroFrameTime
                : Math.min(shot.duration, Math.max(0, heroFrameTime)),
            heroFrameApproved: false
          }
        })
        stateToken = currentStateToken()
      }

      return {
        compiled: true,
        entities: replaced.entities,
        cameraRecipeId: appliedRecipe,
        heroFrameTime: useStore.getState().shot()?.director?.heroFrameTime ?? null,
        stateToken
      }
    }

    case 'add_entity': {
      requireDoc()
      const assetId = str(params, 'assetId') ?? ''
      if (!ASSET_CATALOG.some((a) => a.id === assetId)) {
        throw new Error(`Unknown assetId "${assetId}" — call list_assets for valid ids.`)
      }
      const x = flt(params, 'x') ?? 0
      const z = flt(params, 'z') ?? 0
      const entityId = s.addEntity(assetId, { x, y: 0, z })
      const rotationDeg = flt(params, 'rotationDeg')
      const label = str(params, 'label')
      if (rotationDeg !== undefined || label) {
        s.mutate('agent: place entity', (doc) => {
          for (const scene of doc.scenes) {
            const e = scene.entities.find((en) => en.id === entityId)
            if (!e) continue
            if (rotationDeg !== undefined) e.transform.rotationY = toRad(rotationDeg)
            if (label) e.label = { text: label, color: e.label?.color ?? '#3b82f6' }
          }
        })
      }
      return { entityId, name: assetSpec(assetId)?.name }
    }

    case 'move_entity': {
      requireDoc()
      const entityId = str(params, 'entityId') ?? ''
      let found = false
      s.mutate('agent: move entity', (doc) => {
        for (const scene of doc.scenes) {
          const e = scene.entities.find((en) => en.id === entityId)
          if (!e) continue
          found = true
          const x = flt(params, 'x')
          const y = flt(params, 'y')
          const z = flt(params, 'z')
          const rotationDeg = flt(params, 'rotationDeg')
          if (x !== undefined) e.transform.position.x = x
          if (y !== undefined) e.transform.position.y = y
          if (z !== undefined) e.transform.position.z = z
          if (rotationDeg !== undefined) e.transform.rotationY = toRad(rotationDeg)
        }
      })
      if (!found) throw new Error(`No entity "${entityId}" — call get_state for ids.`)
      return { moved: entityId }
    }

    case 'delete_entity': {
      requireDoc()
      const entityId = str(params, 'entityId') ?? ''
      let found = false
      s.mutate('agent: delete entity', (doc) => {
        for (const scene of doc.scenes) {
          if (!scene.entities.some((e) => e.id === entityId)) continue
          found = true
          scene.entities = scene.entities.filter((e) => e.id !== entityId)
          for (const take of scene.blocking) {
            take.tracks = take.tracks.filter((t) => t.entityId !== entityId)
          }
          for (const sh of scene.shots) {
            if (sh.camera.mountEntityId === entityId) delete sh.camera.mountEntityId
          }
        }
      })
      if (!found) throw new Error(`No entity "${entityId}".`)
      if (useStore.getState().selection?.kind === 'entity') s.setSelection(null)
      return { deleted: entityId }
    }

    case 'add_actor_mark': {
      requireDoc()
      const entityId = str(params, 'entityId') ?? ''
      const time = flt(params, 'time') ?? 0
      const x = flt(params, 'x') ?? 0
      const z = flt(params, 'z') ?? 0
      const y = flt(params, 'y') ?? 0
      const gait = (str(params, 'gait') ?? 'walk') as GaitId
      let ok = false
      s.mutate('agent: actor mark', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        const take = scene?.blocking.find((b) => b.id === shot?.blockingTakeId)
        if (!scene || !take || !scene.entities.some((e) => e.id === entityId)) return
        let track = take.tracks.find((t) => t.entityId === entityId)
        if (!track) {
          track = { entityId, marks: [] }
          take.tracks.push(track)
        }
        track.marks.push(createActorMark({ x, y, z }, time, gait))
        ok = true
      })
      if (!ok) throw new Error(`No entity "${entityId}" in the current scene.`)
      return { added: true }
    }

    case 'add_camera_mark': {
      requireDoc()
      const mark = createCameraMark(
        { x: flt(params, 'x') ?? 0, y: flt(params, 'y') ?? 1.6, z: flt(params, 'z') ?? 4 },
        flt(params, 'time') ?? 0,
        toRad(flt(params, 'panDeg') ?? 0),
        toRad(flt(params, 'tiltDeg') ?? 0),
        flt(params, 'focalLength') ?? 35
      )
      s.mutate('agent: camera mark', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        shot?.camera.marks.push(mark)
      })
      return { added: true }
    }

    case 'clear_camera_marks':
      requireDoc()
      s.clearCameraMarks()
      return { cleared: true }

    case 'set_shot': {
      requireDoc()
      s.mutate('agent: set shot', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        if (!shot) return
        const name = str(params, 'name')
        const duration = flt(params, 'duration')
        const fps = flt(params, 'fps')
        const aspect = str(params, 'aspect') as AspectId | undefined
        if (name) shot.name = name
        // Never clamp marks on duration change — blocking is shared.
        if (duration !== undefined) shot.duration = Math.min(600, Math.max(0.5, duration))
        if (fps === 24 || fps === 25 || fps === 30) shot.fps = fps
        if (aspect && ['16:9', '9:16', '3:4', '4:5', '2.39:1', '4:3', '1:1'].includes(aspect)) {
          shot.aspect = aspect
        }
        if (name || duration !== undefined || fps !== undefined || aspect) {
          shot.director = { ...shot.director, heroFrameApproved: false }
        }
      })
      return { ok: true }
    }

    case 'new_shot': {
      requireDoc()
      const sceneId = useStore.getState().sceneId
      if (!sceneId) throw new Error('No scene selected.')
      s.addShotToScene(sceneId)
      const st = useStore.getState()
      const name = str(params, 'name')
      if (name) {
        st.mutate('agent: name shot', (doc) => {
          const scene = doc.scenes.find((sc) => sc.id === sceneId)
          const shot = scene?.shots.find((sh) => sh.id === st.shotId)
          if (shot) shot.name = name
        })
      }
      return { shotId: useStore.getState().shotId }
    }

    case 'apply_framing': {
      requireDoc()
      const kind = str(params, 'kind') as FramingKind | undefined
      if (!kind || !['2S', 'OTS', 'REV', 'TOP', 'LOW', 'DUTCH'].includes(kind)) {
        throw new Error('kind must be one of 2S, OTS, REV, TOP, LOW, DUTCH.')
      }
      requireManager().applyFraming(kind)
      return { applied: kind }
    }

    case 'apply_camera_move': {
      requireDoc()
      const presetId = str(params, 'presetId') ?? ''
      const subjectId = str(params, 'entityId')
      if (subjectId) {
        if (!s.scene()?.entities.some((e) => e.id === subjectId)) {
          throw new Error(`No entity "${subjectId}".`)
        }
        s.setSelection({ kind: 'entity', entityId: subjectId })
      }
      const { CAMERA_MOVE_PRESETS } = await import('@engine/camera-moves')
      if (!CAMERA_MOVE_PRESETS.some((p) => p.id === presetId)) {
        throw new Error(
          `Unknown presetId "${presetId}". Valid: ${CAMERA_MOVE_PRESETS.map((p) => p.id).join(', ')}`
        )
      }
      requireManager().applyCameraMove(presetId)
      return { applied: presetId }
    }

    case 'list_camera_moves': {
      const { CAMERA_MOVE_PRESETS } = await import('@engine/camera-moves')
      return CAMERA_MOVE_PRESETS.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        track: p.track
      }))
    }

    case 'list_camera_recipes':
      return CAMERA_RECIPES

    case 'apply_camera_recipe': {
      requireDoc()
      assertExpectedState(params)
      const recipeId = str(params, 'recipeId') ?? ''
      const recipe = getCameraRecipe(recipeId)
      if (!recipe) throw new Error(`Unknown recipeId "${recipeId}" — call list_camera_recipes.`)
      const locks = s.shot()?.director?.locks
      if (locks?.camera || locks?.framing) {
        throw new Error('human lock: camera/framing is protected. Clear the lock before applying a camera recipe.')
      }

      const scene = s.scene()
      const shot = s.shot()
      if (!scene || !shot) throw new Error('No active scene/shot.')
      const subjectId =
        str(params, 'entityId') ??
        scene.entities.find((entity) => entity.assetId.startsWith('person.'))?.id ??
        scene.entities[0]?.id
      if (!subjectId) throw new Error('Place a subject first — camera recipes are built around one.')
      const entity = scene.entities.find((item) => item.id === subjectId)
      if (!entity) throw new Error(`No entity "${subjectId}".`)

      // Director recipes use the pure deterministic camera-move engine directly.
      // This avoids a renderer-frame race when compile_shot applies a recipe
      // immediately after replacing the scene in the same MCP call.
      const preset = CAMERA_MOVE_PRESETS.find((item) => item.id === recipe.presetId)
      if (!preset) throw new Error(`Camera recipe "${recipe.id}" references missing preset "${recipe.presetId}".`)
      const evaluator = new ShotEvaluator(scene, shot)
      const camera0 = evaluator.evaluate(0).camera
      const height = entityHeight(entity.assetId, entity.transform.scale, entity.params)
      const specs = preset.generate({
        subjectAt: (time) => {
          const state = evaluator.evaluate(Math.min(Math.max(time, 0), shot.duration))
          const subject = state.entities.find((item) => item.entityId === subjectId)
          return subject
            ? {
                x: subject.position.x,
                y: subject.position.y,
                z: subject.position.z,
                heading: subject.heading
              }
            : {
                x: entity.transform.position.x,
                y: entity.transform.position.y,
                z: entity.transform.position.z,
                heading: entity.transform.rotationY
              }
        },
        subjectHeight: height,
        camera: {
          x: camera0.position.x,
          y: camera0.position.y,
          z: camera0.position.z,
          pan: camera0.pan,
          tilt: camera0.tilt,
          focalLength: camera0.focalLength
        },
        duration: shot.duration
      })
      const marks = specs.map((spec) => ({
        id: newId('cmark'),
        time: spec.time,
        hold: spec.hold,
        easeIn: spec.easeIn,
        easeOut: spec.easeOut,
        position: { ...spec.position },
        pan: spec.pan,
        tilt: spec.tilt,
        roll: spec.roll,
        focalLength:
          recipe.defaultLens !== null && !locks?.lens ? recipe.defaultLens : spec.focalLength
      }))

      s.mutate(`${mutationPrefix(params)}: camera recipe`, (doc) => {
        const sc = doc.scenes.find((item) => item.id === useStore.getState().sceneId)
        const sh = sc?.shots.find((item) => item.id === useStore.getState().shotId)
        if (!sh) return
        sh.camera.marks = marks
        if (preset.track) sh.camera.trackEntityId = subjectId
        else delete sh.camera.trackEntityId
        sh.director = {
          ...sh.director,
          intent: recipe.intent,
          cameraRecipeId: recipe.id,
          cameraSubjectEntityId: subjectId,
          heroFrameApproved: false
        }
      })
      s.setTime(0)
      return {
        applied: recipe.id,
        presetId: recipe.presetId,
        defaultLens: recipe.defaultLens,
        markCount: marks.length,
        stateToken: currentStateToken()
      }
    }

    case 'set_human_locks': {
      requireDoc()
      assertExpectedState(params)
      s.mutate('agent: set human locks', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        if (!shot) return
        const current = shot.director?.locks ?? {}
        const next = { ...current }
        for (const key of ['camera', 'lens', 'framing', 'staging'] as const) {
          const value = bool(params, key)
          if (value !== undefined) next[key] = value
        }
        if (Array.isArray(params.blockingEntityIds)) {
          next.blockingEntityIds = strList(params, 'blockingEntityIds')
        }
        shot.director = { ...shot.director, locks: next }
      })
      return { locks: useStore.getState().shot()?.director?.locks ?? {}, stateToken: currentStateToken() }
    }

    case 'approve_hero_frame': {
      requireDoc()
      assertExpectedState(params)
      const shot = s.shot()
      if (!shot) throw new Error('No active shot.')
      const time = Math.min(shot.duration, Math.max(0, flt(params, 'time') ?? s.time))
      const lockCamera = bool(params, 'lockCamera') ?? true
      const lockLens = bool(params, 'lockLens') ?? true
      const lockFraming = bool(params, 'lockFraming') ?? true
      s.mutate('agent: approve hero frame', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const target = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        if (!target) return
        target.director = {
          ...target.director,
          heroFrameTime: time,
          heroFrameApproved: true,
          locks: {
            ...target.director?.locks,
            camera: lockCamera || target.director?.locks?.camera,
            lens: lockLens || target.director?.locks?.lens,
            framing: lockFraming || target.director?.locks?.framing
          }
        }
      })
      s.setTime(time)
      return {
        heroFrameTime: time,
        approved: true,
        locks: useStore.getState().shot()?.director?.locks ?? {},
        stateToken: currentStateToken()
      }
    }

    case 'set_track_subject': {
      requireDoc()
      const entityId = str(params, 'entityId') // empty/undefined = off
      if (entityId && !s.scene()?.entities.some((e) => e.id === entityId)) {
        throw new Error(`No entity "${entityId}".`)
      }
      s.mutate('agent: track subject', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        if (!shot) return
        if (entityId) shot.camera.trackEntityId = entityId
        else delete shot.camera.trackEntityId
      })
      return { tracking: entityId ?? null }
    }

    case 'list_action_presets': {
      const { ACTION_PRESETS } = await import('@engine/action-presets')
      return ACTION_PRESETS.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        suggestedAssets: p.suggestedAssets
      }))
    }

    case 'apply_action_preset': {
      requireDoc()
      const entityId = str(params, 'entityId') ?? ''
      const presetId = str(params, 'presetId') ?? ''
      const { ACTION_PRESETS } = await import('@engine/action-presets')
      const preset = ACTION_PRESETS.find((p) => p.id === presetId)
      if (!preset) {
        throw new Error(
          `Unknown presetId "${presetId}". Valid: ${ACTION_PRESETS.map((p) => p.id).join(', ')}`
        )
      }
      const scene = s.scene()
      const shot = s.shot()
      const entity = scene?.entities.find((e) => e.id === entityId)
      if (!scene || !shot || !entity) throw new Error(`No entity "${entityId}".`)
      const specs = preset.generate({
        start: {
          x: entity.transform.position.x,
          y: entity.transform.position.y,
          z: entity.transform.position.z,
          heading: entity.transform.rotationY
        },
        duration: shot.duration
      })
      s.mutate('agent: action preset', (doc) => {
        const sc = doc.scenes.find((x) => x.id === scene.id)
        const sh = sc?.shots.find((x) => x.id === shot.id)
        const take = sc?.blocking.find((b) => b.id === sh?.blockingTakeId)
        if (!take) return
        let track = take.tracks.find((t) => t.entityId === entityId)
        if (!track) {
          track = { entityId, marks: [] }
          take.tracks.push(track)
        }
        track.marks = specs.map((spec) => ({
          id: newId('mark'),
          time: spec.time,
          hold: spec.hold,
          easeIn: spec.easeIn,
          easeOut: spec.easeOut,
          position: { ...spec.position },
          gait: spec.gait
        }))
      })
      return { applied: presetId, marks: specs.length }
    }

    case 'list_sequence_styles': {
      const { sequenceStyles } = await import('@engine/sequences')
      return {
        dance: sequenceStyles('dance'),
        fight: sequenceStyles('fight'),
        footChase: sequenceStyles('footChase'),
        carChase: sequenceStyles('carChase')
      }
    }

    case 'spawn_sequence': {
      requireDoc()
      const type = str(params, 'type') as
        | import('@engine/sequences').SequenceType
        | undefined
      if (!type || !['dance', 'fight', 'footChase', 'carChase'].includes(type)) {
        throw new Error('type must be dance | fight | footChase | carChase.')
      }
      const count = flt(params, 'count') ?? 10
      const style = str(params, 'style') ?? (type === 'dance' ? 'mixed' : type === 'fight' ? 'paired' : 'straight')
      const x = flt(params, 'x') ?? 0
      const z = flt(params, 'z') ?? 0
      const headingDeg = flt(params, 'headingDeg') ?? 0
      s.spawnSequence({ type, count, style, origin: { x, z, heading: toRad(headingDeg) } })
      const after = useStore.getState()
      const sel = after.selection
      return {
        staged: sel?.kind === 'entities' ? sel.entityIds.length : 0,
        entityIds: sel?.kind === 'entities' ? sel.entityIds : []
      }
    }

    case 'list_choreography_options': {
      const { choreoStyles, choreoFormations, choreoEndings } = await import('@engine/choreography')
      const kinds: ChoreoKind[] = ['dance', 'fight', 'chase']
      return {
        kinds,
        styles: Object.fromEntries(kinds.map((k) => [k, choreoStyles(k)])),
        formations: choreoFormations(),
        endings: Object.fromEntries(kinds.map((k) => [k, choreoEndings(k)]))
      }
    }

    case 'spawn_choreography': {
      requireDoc()
      const spec = routineSpecFromParams(params)
      const x = flt(params, 'x') ?? 0
      const z = flt(params, 'z') ?? 0
      const headingDeg = flt(params, 'headingDeg') ?? 0
      s.spawnChoreography(spec, { x, z, heading: toRad(headingDeg) })
      const sel = useStore.getState().selection
      return {
        kind: spec.kind,
        staged: sel?.kind === 'entities' ? sel.entityIds.length : 0,
        entityIds: sel?.kind === 'entities' ? sel.entityIds : []
      }
    }

    case 'choreograph_entities': {
      requireDoc()
      const entityIds = strList(params, 'entityIds')
      if (entityIds.length === 0) {
        throw new Error('entityIds must be a non-empty array of person entity ids.')
      }
      const spec = routineSpecFromParams(params)
      const applied = s.choreographEntities(entityIds, spec)
      if (applied === 0) {
        throw new Error('No matching performers — choreography applies to people (person.* entities).')
      }
      return { kind: spec.kind, choreographed: applied }
    }

    case 'list_motion_presets': {
      const { MOTION_PRESETS } = await import('@engine/motions')
      const category = str(params, 'category')
      return MOTION_PRESETS.filter((m) => !category || m.category === category).map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        duration: m.duration
      }))
    }

    case 'import_scan': {
      requireDoc()
      const sourcePath = str(params, 'sourcePath') ?? str(params, 'path') ?? ''
      if (!sourcePath) {
        throw new Error('sourcePath is required — an absolute path to a .ply/.splat/.spz/.ksplat file.')
      }
      const before = new Set((s.scene()?.scans ?? []).map((sc) => sc.id))
      await s.importScan(sourcePath)
      const scan = (useStore.getState().scene()?.scans ?? []).find((sc) => !before.has(sc.id))
      if (!scan) {
        throw new Error('Scan import failed — check the file path and that the project has been saved.')
      }
      return { scan }
    }

    case 'set_scan_transform': {
      requireDoc()
      const scanId = str(params, 'scanId') ?? ''
      const scan = s.scene()?.scans?.find((sc) => sc.id === scanId)
      if (!scan) throw new Error(`No scan "${scanId}" — call get_state or import_scan.`)
      const patch: { position?: { x: number; y: number; z: number }; rotationY?: number; scale?: number } = {}
      const pos = params.position
      if (pos && typeof pos === 'object') {
        const pp = pos as Params
        patch.position = {
          x: flt(pp, 'x') ?? scan.position.x,
          y: flt(pp, 'y') ?? scan.position.y,
          z: flt(pp, 'z') ?? scan.position.z
        }
      }
      const rotationDeg = flt(params, 'rotationDeg')
      if (rotationDeg !== undefined) patch.rotationY = toRad(rotationDeg)
      const scale = flt(params, 'scale')
      if (scale !== undefined) patch.scale = scale
      const flipped = bool(params, 'flipped')
      if (flipped !== undefined) (patch as { flipped?: boolean }).flipped = flipped
      if (patch.position || patch.rotationY !== undefined || patch.scale !== undefined || flipped !== undefined) {
        s.updateScanTransform(scanId, patch)
      }
      const visible = bool(params, 'visible')
      if (visible !== undefined) s.setScanVisible(scanId, visible)
      const updated = useStore.getState().scene()?.scans?.find((sc) => sc.id === scanId)
      return { scan: updated }
    }

    case 'remove_scan': {
      requireDoc()
      const scanId = str(params, 'scanId') ?? ''
      if (!s.scene()?.scans?.some((sc) => sc.id === scanId)) {
        throw new Error(`No scan "${scanId}" — call get_state for scan ids.`)
      }
      s.removeScan(scanId)
      return { removed: scanId }
    }

    case 'snap_to_ground': {
      requireDoc()
      const entityId = str(params, 'entityId') ?? ''
      const scene = s.scene()
      if (!scene?.entities.some((e) => e.id === entityId)) {
        throw new Error(`No entity "${entityId}".`)
      }
      s.setSelection({ kind: 'entity', entityId })
      requireManager().snapSelectionToGround()
      return { snapped: entityId }
    }

    case 'set_time':
      requireDoc()
      s.setTime(Math.max(0, flt(params, 't') ?? 0))
      return { time: useStore.getState().time }

    case 'play':
      requireDoc()
      s.setTime(0)
      s.setPlaying(true)
      return { playing: true }

    case 'stop':
      s.setPlaying(false)
      return { playing: false }

    case 'review_shot': {
      requireDoc()
      assertExpectedState(params, false)
      const shot = s.shot()
      if (!shot) throw new Error('No active shot.')
      const maxFrames = Math.min(9, Math.max(2, Math.round(flt(params, 'maxFrames') ?? 6)))
      const heroTime = shot.director?.heroFrameTime
      const times = reviewTimes(
        shot.duration,
        shot.fps,
        shot.camera.marks.map((mark) => mark.time),
        maxFrames,
        heroTime === undefined ? [] : [heroTime]
      )
      const png = await renderReviewSheetPng(times)
      return {
        imageBase64: bufferToBase64(png),
        stateToken: currentStateToken(),
        times,
        heroFrameTime: heroTime ?? null,
        heroFrameApproved: shot.director?.heroFrameApproved ?? false
      }
    }

    case 'save_visual_checkpoint': {
      requireDoc()
      assertExpectedState(params, false)
      const shot = s.shot()
      const scene = s.scene()
      const folder = s.projectFolder
      if (!shot || !scene || !folder) throw new Error('Open and save a project first.')
      const kindRaw = str(params, 'kind')
      const kind = kindRaw === 'hero' || kindRaw === 'daily' ? kindRaw : 'daily'
      if (kind === 'hero' && !shot.director?.heroFrameApproved) {
        throw new Error('Hero Board requires an approved Hero Frame.')
      }
      const maxFrames = Math.min(12, Math.max(2, Math.round(flt(params, 'maxFrames') ?? 8)))
      const heroTime = shot.director?.heroFrameTime
      // Phase-board mode deliberately samples more densely than review_shot:
      // enough sequential phases for a vision model to infer motion, while
      // staying a single compact image rather than N screenshots.
      const uniform = Array.from({ length: maxFrames }, (_, i) =>
        maxFrames === 1 ? 0 : (shot.duration * i) / (maxFrames - 1)
      )
      const times = reviewTimes(
        shot.duration,
        shot.fps,
        [...uniform, ...shot.camera.marks.map((mark) => mark.time)],
        maxFrames,
        heroTime === undefined ? [] : [heroTime]
      )
      const webp = await renderReviewSheet(times, 400, 225, 4, 'webp', 0.76)
      const stamp = new Date().toISOString().replace(/[:.T]/g, '-').replace('Z', '')
      const safeShot = shot.name.replace(/[^a-zA-Z0-9_-]+/g, '-')
      const dir = kind === 'hero' ? 'hero' : 'dailies'
      const stem = `${stamp}-${safeShot}-phase-board`
      const imagePath = `${folder}/reviews/${dir}/${stem}.webp`
      const jsonPath = `${folder}/reviews/${dir}/${stem}.json`
      await window.blockout.exportWriteFile(imagePath, webp)
      await window.blockout.exportWriteFile(
        jsonPath,
        JSON.stringify(
          {
            schema: 1,
            type: 'phase-board',
            kind,
            createdAt: new Date().toISOString(),
            source: str(params, 'source') ?? 'chatgpt',
            note: str(params, 'note') ?? '',
            scene: { id: scene.id, name: scene.name },
            shot: { id: shot.id, name: shot.name, duration: shot.duration },
            times,
            heroFrameTime: heroTime ?? null,
            heroFrameApproved: shot.director?.heroFrameApproved ?? false,
            stateToken: currentStateToken(),
            image: `${stem}.webp`
          },
          null,
          2
        ) + '\n'
      )
      return {
        saved: true,
        kind,
        imagePath,
        jsonPath,
        times,
        bytes: webp.byteLength,
        stateToken: currentStateToken()
      }
    }

    case 'ui_import_shot_plan': {
      requireDoc()
      const filePath = await window.blockout.pickFile([{ name: 'Blockout Shot Plan', extensions: ['json'] }])
      if (!filePath) return { cancelled: true }
      return execute('import_shot_plan', { _expectedStateToken: currentStateToken(), filePath })
    }

    case 'ui_export_shot_plan': {
      return execute('export_shot_plan', { source: 'human' })
    }

    case 'ui_save_visual_checkpoint': {
      return execute('save_visual_checkpoint', {
        _expectedStateToken: currentStateToken(),
        kind: str(params, 'kind') ?? 'daily',
        maxFrames: flt(params, 'maxFrames') ?? 8,
        source: 'human',
        note: str(params, 'note') ?? ''
      })
    }

    case 'export_shot': {
      requireDoc()
      assertExpectedState(params, false)
      const profileId = str(params, 'profileId') ?? s.doc?.settings.defaultProfileId ?? 'seedance-2.5'
      if (!BUILTIN_PROFILES.some((profile) => profile.id === profileId)) {
        throw new Error(`Unknown profileId "${profileId}".`)
      }
      const targetProfile = BUILTIN_PROFILES.find((profile) => profile.id === profileId)!
      if (!profileSupportsAspect(targetProfile, s.shot()!.aspect) && bool(params, 'allowUnsupportedAspect') !== true) {
        throw new Error(
          `${targetProfile.name} does not declare support for ${s.shot()!.aspect}. Set allowUnsupportedAspect=true only if intentional.`
        )
      }
      const requireApprovedHeroFrame =
        bool(params, 'requireApprovedHeroFrame') ?? profileId === 'seedance-2.5'
      if (requireApprovedHeroFrame && !s.shot()?.director?.heroFrameApproved) {
        throw new Error(
          'hero frame is not approved. Review the shot, call approve_hero_frame, then export.'
        )
      }
      const resolutionRaw = str(params, 'resolution')
      const resolution: ExportResolution =
        resolutionRaw === '720p' || resolutionRaw === '1080p' ? resolutionRaw : 'auto'
      const labelsRaw = str(params, 'labels')
      const labels: 'on' | 'stillsOnly' | 'off' =
        labelsRaw === 'on' || labelsRaw === 'off' ? labelsRaw : 'stillsOnly'
      const result = await exportShot({
        profileId,
        passes: {
          clean: bool(params, 'clean') ?? true,
          depth: bool(params, 'depth') ?? false,
          normal: bool(params, 'normal') ?? false
        },
        labels,
        resolution
      })
      if (!result.ok || !result.packagePath) throw new Error(result.error ?? 'Shot export failed.')
      return { packagePath: result.packagePath, profileId }
    }

    case 'screenshot': {
      requireDoc()
      // Rendered through the SHOT camera at the playhead — what will export.
      const png = await renderStillPngForTest(useStore.getState().time, 960, 540)
      return { imageBase64: bufferToBase64(png) }
    }

    case 'import_motion_previs_camera': {
      requireDoc()
      assertExpectedState(params)
      const cameraMotionPath = str(params, 'cameraMotionPath') ?? ''
      if (!cameraMotionPath) throw new Error('cameraMotionPath is required.')
      const folder = s.projectFolder
      const scene = s.scene()
      const shot = s.shot()
      if (!folder || !scene || !shot) throw new Error('Open and save a project first.')

      const locks = shot.director?.locks
      if (locks?.camera || locks?.framing) {
        throw new Error('human lock: camera/framing is protected. Clear the lock before importing measured camera motion.')
      }

      // Copy the source JSON into the project for provenance, then read it
      // through Blockout's existing project-scoped file bridge.
      const imported = await window.blockout.importReference(folder, cameraMotionPath)
      const bytes = await window.blockout.readProjectFile(folder, imported.relativePath)
      let parsed: unknown
      try {
        parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)))
      } catch {
        throw new Error('cameraMotionPath is not valid JSON.')
      }
      const data = validateMotionPrevisCameraData(parsed)

      const evaluator = new ShotEvaluator(scene, shot)
      const base = evaluator.evaluate(0).camera
      const durationMode = str(params, 'durationMode') === 'source' ? 'source' : 'fit-shot'
      const targetDuration = durationMode === 'source' ? data.duration : shot.duration
      const targetFps = Math.min(24, Math.max(1, flt(params, 'targetFps') ?? 6))
      const specs = motionPrevisToCameraSpecs(
        data,
        {
          position: { ...base.position },
          pan: base.pan,
          tilt: base.tilt,
          roll: base.roll,
          focalLength: base.focalLength
        },
        { duration: targetDuration, targetFps }
      )

      const marks = specs.map((spec) => ({
        id: newId('cmark'),
        time: spec.time,
        hold: 0,
        easeIn: 0,
        easeOut: 0,
        position: { ...spec.position },
        pan: spec.pan,
        tilt: spec.tilt,
        roll: spec.roll,
        focalLength: locks?.lens ? base.focalLength : spec.focalLength
      }))

      s.mutate('agent: import Motion Previs camera', (doc) => {
        const sc = doc.scenes.find((item) => item.id === useStore.getState().sceneId)
        const sh = sc?.shots.find((item) => item.id === useStore.getState().shotId)
        if (!sh) return
        sh.camera.marks = marks
        delete sh.camera.trackEntityId
        if (durationMode === 'source') sh.duration = targetDuration
        sh.director = {
          ...sh.director,
          cameraRecipeId: 'motion-previs-measured',
          measuredCameraSource: imported.relativePath,
          heroFrameApproved: false
        }
      })

      return {
        imported: true,
        source: imported.relativePath,
        sourceDuration: data.duration,
        targetDuration,
        sourceFps: data.fps,
        targetFps,
        markCount: marks.length,
        averageConfidence: data.summary?.averageConfidence ?? null,
        stateToken: currentStateToken()
      }
    }

    case 'set_reference': {
      requireDoc()
      const handoffVersion = flt(params, 'handoffVersion')
      if (handoffVersion !== undefined && handoffVersion !== 1) {
        throw new Error(`Unsupported Motion Previs handoffVersion ${handoffVersion}; Blockout supports version 1.`)
      }
      const videoPath = str(params, 'videoPath') ?? str(params, 'path') ?? ''
      if (!videoPath) throw new Error('videoPath is required.')
      const folder = useStore.getState().projectFolder
      if (!folder) throw new Error('No project folder — save the project first.')
      const mode = str(params, 'mode') === 'pip' ? 'pip' : 'ghost'
      const rawOpacity = flt(params, 'opacity')
      const opacity = rawOpacity === undefined ? 0.5 : Math.min(1, Math.max(0, rawOpacity))
      // Copy the external clip into the project's refs/ folder so it travels
      // with the project and can be served by relative path.
      const imported = await window.blockout.importReference(folder, videoPath)
      let attached = false
      s.mutate('agent: set reference', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        if (!shot) return
        shot.referenceVideo = { path: imported.relativePath, opacity, mode, timeOffset: 0 }
        attached = true
      })
      if (!attached) throw new Error('No active shot to attach the reference to.')
      return { attached: true, handoffVersion: 1, path: imported.relativePath, mode, opacity }
    }

    case 'list_presets':
      return await window.blockout.presetsList()

    case 'save_preset': {
      requireDoc()
      const name = str(params, 'name')
      if (!name) throw new Error('name is required.')
      await s.saveStagePreset(name)
      return { saved: name }
    }

    case 'apply_preset': {
      requireDoc()
      const id = str(params, 'id')
      if (!id) throw new Error('id is required — call list_presets.')
      await s.applyStagePreset(id)
      return { applied: id }
    }

    default:
      throw new Error(`Unknown action "${action}".`)
  }
}

/** Wire up control-invoke handling. Returns an unsubscribe for teardown. */
export function registerControlHandler(): () => void {
  return window.blockout.onControlInvoke((id, action, params) => {
    void (async () => {
      let result: ControlResult
      try {
        const data = await executeControlAction(action, (params ?? {}) as Params)
        result = { ok: true, data }
      } catch (e) {
        result = { ok: false, error: (e as Error).message }
      }
      window.blockout.controlResult(id, result)
    })()
  })
}
