// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Deliver mode: pick a generator profile, choose passes, export the
 * package, copy the generated prompt, and hand off to Blender/ComfyUI.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { BUILTIN_PROFILES, getProfile, profileSupportsAspect } from '@engine/profiles'
import { generatePrompt } from '@engine/prompt'
import {
  exportShot,
  exportAnimatic,
  exportContactSheet,
  exportDims,
  exportStillAtPlayhead,
  type ExportResolution
} from '../export/exporter'
import { exportGlb } from '../export/gltf'
import { executeControlAction } from '../control/handler'
import { uiText, useUiLanguage } from '../i18n'

export function DeliverPanel(): JSX.Element {
  const language = useUiLanguage()
  const doc = useStore((s) => s.doc)
  const sceneId = useStore((s) => s.sceneId)
  const shotId = useStore((s) => s.shotId)
  const progress = useStore((s) => s.exportProgress)
  const setExportProgress = useStore((s) => s.setExportProgress)
  const toast = useStore((s) => s.toast)
  const mutate = useStore((s) => s.mutate)

  const scene = doc?.scenes.find((s) => s.id === sceneId)
  const shot = scene?.shots.find((s) => s.id === shotId)

  const [profileId, setProfileId] = useState(doc?.settings.defaultProfileId ?? 'seedance-2.5')
  const [passes, setPasses] = useState({ clean: true, depth: false, normal: false })
  const [labels, setLabels] = useState<'on' | 'stillsOnly' | 'off'>('stillsOnly')
  const [resolution, setResolution] = useState<ExportResolution>('auto')
  const [reviews, setReviews] = useState<{ kind: 'daily' | 'hero'; name: string; path: string; savedAt: string; bytes: number }[]>([])

  const profile = getProfile(profileId)
  const prompt = useMemo(
    () => (scene && shot ? generatePrompt(scene, shot, profile) : ''),
    [scene, shot, profile]
  )

  if (!scene || !shot) {
    return (
      <div className="deliver-panel">
        <div className="panel-title">Deliver</div>
        <p style={{ color: 'var(--text-dim)' }}>Select a shot to export.</p>
      </div>
    )
  }

  const dims = exportDims(profile, shot.aspect, resolution)
  const overCap = profile.maxDuration !== undefined && shot.duration > profile.maxDuration
  const unsupportedAspect = !profileSupportsAspect(profile, shot.aspect)
  const pct =
    progress.totalFrames > 0 ? Math.round((progress.frame / progress.totalFrames) * 100) : 0

  const run = async (): Promise<void> => {
    const res = await exportShot({ profileId, passes, labels, resolution })
    if (res.ok && res.packagePath) {
      toast('Export complete.', 'success')
      void window.blockout.showFolder(res.packagePath)
    } else if (res.error && res.error !== 'cancelled') {
      toast(`Export failed: ${res.error}`, 'error')
    }
  }

  return (
    <div className="deliver-panel">
      <div className="panel-title">Deliver — {scene.name} / Shot {shot.name}</div>

      <div className="field">
        <label>Target generator</label>
        <select
          value={profileId}
          onChange={(e) => {
            setProfileId(e.target.value)
            mutate('default profile', (doc) => {
              doc.settings.defaultProfileId = e.target.value
            })
          }}
        >
          {BUILTIN_PROFILES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.vendor})
            </option>
          ))}
        </select>
      </div>

      <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
        {profile.attachHint}
      </p>

      {unsupportedAspect && (
        <div className="warning-chip" style={{ marginBottom: 10 }}>
          ⚠ {profile.name} does not declare native support for {shot.aspect}. Export can still be created,
          but the target generator may crop or reinterpret the frame.
        </div>
      )}

      {overCap && (
        <div className="warning-chip" style={{ marginBottom: 10 }}>
          ⚠ Shot is {shot.duration.toFixed(1)}s but {profile.name} caps clips at{' '}
          {profile.maxDuration}s — consider shortening.
        </div>
      )}

      <div className="field">
        <label>
          Output — {dims.width}×{dims.height} @ {shot.fps}fps · {shot.aspect}
        </label>
        <div className="seg">
          <button className={passes.clean ? 'active' : ''} onClick={() => setPasses((p) => ({ ...p, clean: !p.clean }))}>
            Clean
          </button>
          <button className={passes.depth ? 'active' : ''} onClick={() => setPasses((p) => ({ ...p, depth: !p.depth }))}>
            Depth
          </button>
          <button className={passes.normal ? 'active' : ''} onClick={() => setPasses((p) => ({ ...p, normal: !p.normal }))}>
            Normal
          </button>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
          Physical-sky presets render into the <b>Clean</b> plate (deterministic, byte-reproducible) and
          are held out of the Depth and Normal passes. Imported 3D scans are a staging aid and stay out
          of every pass; they&apos;re listed in the package&apos;s <code>metadata.json</code>.
        </p>
      </div>

      <div className="field">
        <label>Resolution</label>
        <div className="seg">
          <button
            className={resolution === 'auto' ? 'active' : ''}
            onClick={() => setResolution('auto')}
            title={`The profile's native size`}
          >
            Auto
          </button>
          <button
            className={resolution === '720p' ? 'active' : ''}
            onClick={() => setResolution('720p')}
            title="720p — what Seedance accepts for reference files. Applies to videos, stills, and animatics."
          >
            720p
          </button>
          <button
            className={resolution === '1080p' ? 'active' : ''}
            onClick={() => setResolution('1080p')}
            title="1080p"
          >
            1080p
          </button>
        </div>
      </div>

      <div className="field">
        <label>Labels</label>
        <div className="seg">
          <button className={labels === 'on' ? 'active' : ''} onClick={() => setLabels('on')}>
            In video
          </button>
          <button className={labels === 'stillsOnly' ? 'active' : ''} onClick={() => setLabels('stillsOnly')}>
            Stills only
          </button>
          <button className={labels === 'off' ? 'active' : ''} onClick={() => setLabels('off')}>
            Off
          </button>
        </div>
      </div>

      {progress.running ? (
        <div className="field">
          <label>
            {progress.label} {progress.frame}/{progress.totalFrames}
          </label>
          <div className="progress-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <button
            className="btn small danger"
            style={{ marginTop: 8 }}
            onClick={() => setExportProgress({ cancelRequested: true })}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="btn primary"
          style={{ width: '100%', marginBottom: 10 }}
          disabled={!passes.clean && !passes.depth && !passes.normal}
          onClick={() => void run()}
        >
          Export shot package
        </button>
      )}

      <button
        className="btn"
        style={{ width: '100%', marginBottom: 10 }}
        disabled={progress.running}
        onClick={() =>
          void exportStillAtPlayhead(profileId, resolution, labels !== 'off').then((r) => {
            if (r.ok && r.packagePath) {
              toast('Frame exported.', 'success')
              void window.blockout.showFolder(r.packagePath)
            } else if (r.error) toast(`Frame export failed: ${r.error}`, 'error')
          })
        }
        title="Export ONLY the frame at the playhead as a full-quality PNG — scrub to the exact moment you want first"
      >
        📸 Export this frame (at playhead)
      </button>

      {progress.lastPackagePath && !progress.running && (
        <button
          className="btn small"
          style={{ width: '100%', marginBottom: 14 }}
          onClick={() => void window.blockout.showFolder(progress.lastPackagePath!)}
        >
          {window.blockout.platform.isMac ? 'Reveal last export in Finder' : 'Show last export in Folder'}
        </button>
      )}

      <div className="panel-title" style={{ marginTop: 10 }}>
        Prompt for {profile.name}
      </div>
      <div className="prompt-box">{prompt}</div>
      <button
        className="btn small"
        style={{ width: '100%', margin: '8px 0 18px' }}
        onClick={() => {
          void navigator.clipboard.writeText(prompt)
          toast('Prompt copied.', 'success')
        }}
      >
        Copy prompt
      </button>

      <div className="panel-title">{uiText(language, 'references')}</div>
      <p style={{ color: 'var(--text-faint)', fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>
        Keep identity/look references separate from motion. These roles are carried into the project and downstream handoff.
      </p>
      <div className="reference-card-grid">
        {(['character', 'product', 'location', 'style', 'motion'] as const).map((role) => {
          const count = doc?.references?.filter((ref) => ref.role === role).length ?? 0
          return (
            <button
              key={role}
              className="reference-role-card"
              onClick={() => {
                void window.blockout
                  .pickFile([{ name: `${role} reference`, extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'] }])
                  .then(async (path) => {
                    if (!path) return
                    const folder = useStore.getState().projectFolder
                    if (!folder) return
                    const imported = await window.blockout.importReference(folder, path)
                    mutate('add reference card', (project) => {
                      project.references = project.references ?? []
                      project.references.push({
                        id: `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                        role,
                        name: imported.name,
                        relativePath: imported.relativePath,
                        createdAt: new Date().toISOString()
                      })
                    })
                    toast(`${role} reference added.`, 'success')
                  })
              }}
            >
              <b>{role.toUpperCase()}</b>
              <span>{count}</span>
            </button>
          )
        })}
      </div>
      {(doc?.references?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 14 }}>
          {doc!.references!.map((ref) => (
            <div className="visual-memory-row" key={ref.id}>
              <span className="visual-memory-kind">{ref.role.toUpperCase().slice(0, 5)}</span>
              <span className="visual-memory-name">{ref.name}</span>
              <button
                className="rail-btn"
                title="Remove reference card (copied file remains in refs/)"
                onClick={() =>
                  mutate('remove reference card', (project) => {
                    project.references = (project.references ?? []).filter((item) => item.id !== ref.id)
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="panel-title">{uiText(language, 'visualMemory')}</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button
          className="btn primary"
          style={{ flex: 1 }}
          onClick={() =>
            void executeControlAction('ui_save_visual_checkpoint', { kind: 'daily', maxFrames: 8 })
              .then(() => {
                toast('Daily phase board saved.', 'success')
                const folder = useStore.getState().projectFolder
                if (folder) void window.blockout.listReviewArtifacts(folder).then(setReviews)
              })
              .catch((e) => toast(`Daily failed: ${(e as Error).message}`, 'error'))
          }
        >
          Save Daily
        </button>
        <button
          className="btn"
          style={{ flex: 1 }}
          disabled={!shot.director?.heroFrameApproved}
          title={shot.director?.heroFrameApproved ? 'Save the approved Hero phase board' : 'Approve a Hero Frame first'}
          onClick={() =>
            void executeControlAction('ui_save_visual_checkpoint', { kind: 'hero', maxFrames: 8 })
              .then(() => {
                toast('Hero phase board saved.', 'success')
                const folder = useStore.getState().projectFolder
                if (folder) void window.blockout.listReviewArtifacts(folder).then(setReviews)
              })
              .catch((e) => toast(`Hero board failed: ${(e as Error).message}`, 'error'))
          }
        >
          Save Hero Board
        </button>
      </div>
      <p style={{ color: 'var(--text-faint)', fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>
        Phase boards pack the important animation phases into one compact WebP for ChatGPT/agent review.
      </p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button
          className="btn"
          style={{ flex: 1 }}
          onClick={() =>
            void window.blockout.listReviewArtifacts(useStore.getState().projectFolder ?? '').then(setReviews)
          }
        >
          Refresh Dailies
        </button>
        <button
          className="btn"
          style={{ flex: 1 }}
          onClick={() => {
            const folder = useStore.getState().projectFolder
            if (folder) void window.blockout.showFolder(`${folder}/reviews`)
          }}
        >
          Open Reviews
        </button>
      </div>
      {reviews.slice(0, 6).map((item) => (
        <div className="visual-memory-row" key={item.path}>
          <span className={`visual-memory-kind ${item.kind}`}>{item.kind === 'hero' ? 'HERO' : 'DAILY'}</span>
          <span className="visual-memory-name">{item.name}</span>
          <span className="visual-memory-size">{Math.max(1, Math.round(item.bytes / 1024))} KB</span>
        </div>
      ))}

      <div className="panel-title">Scene tools</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          className="btn"
          disabled={progress.running}
          onClick={() =>
            void exportAnimatic(profileId, resolution).then((r) => {
              if (r.ok && r.packagePath) {
                toast('Animatic exported.', 'success')
                void window.blockout.showFolder(r.packagePath)
              } else if (r.error && r.error !== 'cancelled') toast(`Animatic failed: ${r.error}`, 'error')
            })
          }
        >
          Export scene animatic ({scene.shots.length} shots)
        </button>
        <button
          className="btn"
          disabled={progress.running}
          onClick={() =>
            void exportContactSheet().then((r) => {
              if (r.ok && r.packagePath) {
                toast('Contact sheet exported.', 'success')
                void window.blockout.showFolder(r.packagePath)
              } else if (r.error) toast(`Contact sheet failed: ${r.error}`, 'error')
            })
          }
        >
          Export contact sheet
        </button>
        <button
          className="btn"
          disabled={progress.running}
          onClick={() =>
            void exportGlb(profileId).then((r) => {
              if (r.ok && r.packagePath) {
                toast('Blender package exported (.glb + import script).', 'success')
                void window.blockout.showFolder(r.packagePath)
              } else if (r.error) toast(`glTF export failed: ${r.error}`, 'error')
            })
          }
        >
          Export to Blender (.glb)
        </button>
      </div>
    </div>
  )
}
