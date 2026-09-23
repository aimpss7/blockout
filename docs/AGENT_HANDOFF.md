# Agent Handoff — Blockout Director Fork

> Branch: `feat/agent-director-v1`
>
> Read this first, then `AGENTS.md`, `docs/CONTINUITY.md`, `docs/AGENT_DIRECTOR_ROADMAP.md`, and `mcp/README.md`.
>
> Status: local Mac validation/fix pass and packaged-app QA smoke completed on 2026-09-23. `npm run typecheck`, `npm run lint`, `npm run build`, targeted manual/control smoke, packaged `.app` smoke, and full `npm run e2e` passed locally. Continue with small bug fixes only; do not add large new features before real workflow trials.

## 1. Product goal

This fork turns Blockout into a lightweight **AI-filmmaking previs / blocking / camera-direction tool**, not a Blender replacement.

Primary workflow:

1. Block a simple 3D scene with proxy objects/characters.
2. Define blocking and camera movement with film-language controls.
3. Review motion visually with compact phase boards/contact sheets.
4. Export a motion/reference package plus semantic references for generators such as Seedance.
5. Let either a human, Codex/Claude, or ChatGPT via a future secure tunnel drive the **same high-level Director contract**.

The app should remain much simpler than Blender. Avoid adding general-purpose DCC features unless they directly improve previs, camera, blocking, reference handoff, or agent efficiency.

## 2. Core architectural rule

There must not be separate scene-building implementations for UI, Codex, ChatGPT, and files.

The intended convergence is:

```
ChatGPT Tunnel ─┐
Codex / Claude ─┤
.shot.json ─────┼→ Director Shot Plan → shared compiler/control path → Blockout
Desktop UI ─────┘
```

High-level agents should use the compact Director MCP surface. Low-level/full MCP remains an escape hatch.

## 3. Major work implemented in this branch

### Director camera/operator layer

- `src/engine/director.ts`
- `src/renderer/panels/Inspector.tsx`
- `src/renderer/viewport/SceneManager.ts`

Added structured camera recipes with intent/use-case metadata, shot size, camera height, pacing, lens guidance, product/dialogue/vehicle/action/observational recipes, etc.

Arbitrary focal length input supports roughly 8–300mm in addition to presets.

Director Camera is intended to be primary; low-level camera moves/rig controls are progressively disclosed under Advanced Camera.

Human and agent camera recipes should preserve recipe identity and subject metadata. This area received several audit fixes; test it carefully.

### Social-first formats

Added `3:4` and `4:5` alongside `9:16`, `1:1`, `16:9`, `4:3`, `2.39:1`.

Relevant files include:
- `src/engine/types.ts`
- `src/engine/camera.ts`
- `src/renderer/viewport/Viewport.tsx`
- `src/renderer/panels/Inspector.tsx`

Viewport has editor-only social safe-area guides. These guides must never enter exports.

Do **not** equate “Blockout supports this canvas ratio” with “a target generator officially accepts this ratio.” Generator profile support remains separate and Deliver/control should warn or require an explicit override when needed.

### Simple object color

Objects now have an explicit simple matte `Entity.color` / Base Color independent from label/path color.

It flows through:
- project document
- viewport tint
- Shot Plan
- compiler/MCP
- export metadata

UI has color picker, HEX input, swatches, reset.

Important audit decision: `label.color` is for label + blocking path semantics; it should no longer be the canonical object material color. Legacy fallback may still exist for old projects.

### Workspace / project storage

The direction is Obsidian-like: choose one persistent Workspace root and create project folders under it.

Project layout currently targets roughly:

```
<Project>.blockout/
  project.json
  assets/
  refs/
  plans/
  exports/
  history/
    events.jsonl
    snapshots/
  reviews/
    cache/
    dailies/
    hero/
```

Relevant files:
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/renderer/App.tsx`
- `src/renderer/store.ts`

Workspace root + language are stored globally.

### History / checkpoints

Implemented:
- append-only `history/events.jsonl`
- timestamped snapshots
- Checkpoint button
- History UI
- restore with automatic `before-restore` checkpoint
- undo/redo/restore provenance events
- compact `get_recent_changes` agent action/tool

Goal: an agent can ask what changed without rereading a huge project.

Audit note: history is useful provenance, not the source of truth. `project.json` remains current state.

### Hero Frame approval

Hero approval is meant to be a meaningful visual approval, not a sticky boolean.

A centralized visual fingerprint was added in `src/engine/director.ts` and used from store mutation logic so changes to visual/timing state (camera, staging, blocking, aspect, etc.) invalidate approval automatically.

Hero Board saving now requires an approved Hero Frame.

This is important and should get local/e2e coverage.

### Visual Memory / phase boards

ChatGPT can understand animation from a **single board containing ordered phases**, rather than many screenshots.

Implemented concepts:
- temporary review sheet
- durable Daily phase board
- durable Hero phase board
- compact WebP + JSON sidecar
- representative phase timestamps including camera beats / Hero Frame
- Visual Memory listing in Deliver
- `get_visual_context`: compact WebP phase board + recent history + hero state + state token in one call

Relevant files:
- `src/renderer/export/exporter.ts`
- `src/renderer/control/handler.ts`
- `src/renderer/panels/DeliverPanel.tsx`
- `src/main/index.ts`
- `mcp/blockout-mcp.mjs`

Token-saving principle: prefer one phase board over N screenshot calls.

### Portable Director Shot Plan

`src/engine/shot-plan.ts`

Portable `.shot.json` is the high-level interchange contract.

It can describe:
- entities
- positions/transforms
- simple colors
- params
- blocking marks
- camera marks
- duration/fps/aspect
- rig
- Director intent
- camera recipe + subject
- Hero Frame time
- provenance

Import/export should go through the same Director compiler/control path as agents.

Plans now belong under `plans/`, not `refs/`.

### Semantic references

Reference Cards distinguish:
- Character
- Product
- Location
- Style
- Motion

Relevant files:
- `src/engine/types.ts`
- `src/engine/references.ts`
- `src/renderer/panels/DeliverPanel.tsx`
- `src/renderer/export/exporter.ts`

Motion references must not silently become identity/style authority.

Reference cards persist in `project.json` and are included in downstream handoff metadata.

### Seedance / generator handoff

The fork is biased toward AI-video handoff, especially Seedance-style motion/reference workflows.

Keep:
- motion/camera/blocking reference separate from appearance references
- reference role manifest
- compact prompts; do not dump every timeline detail into prose when video/metadata already carries it
- explicit profile/aspect compatibility checks

Do not invent current generator capabilities. Profile claims should be verified before changing them.

### Localization

Foundation exists:
- persistent EN/RU selector
- curated dictionary in `src/renderer/i18n.ts`
- language context moved out of App to avoid circular imports
- core shell and some Director/Deliver labels are localized

**Localization is not complete.** Many visible strings remain hard-coded English. Finish breadth after validation/cleanup.

Professional terminology policy:
- translate interface/explanatory film terms carefully
- keep standards such as `Super 35`, `50 mm`, and standard shot abbreviations where appropriate
- do not machine-translate blindly

### Director UX direction

The intended UI hierarchy:

1. Director intent
2. Operator controls
3. Technical controls only on demand

Ideas already partly implemented:
- denser inspector
- toggles instead of bulky checkboxes
- Advanced Camera disclosure
- social-first format order
- viewport safe guides
- exact focal length

Do not turn the app back into a giant parameter wall.

## 4. MCP / agent strategy

See `mcp/blockout-mcp.mjs` and `mcp/README.md`.

At the latest audit point the compact Director surface was documented as **16 tools**, with full mode **48 tools**. Recount from source if you add/remove tools; stale counts have already caused documentation contradictions.

Important high-level tools include:
- `get_state`
- `get_visual_context`
- `get_recent_changes`
- `list_assets`
- `compile_shot`
- `import_shot_plan`
- `export_shot_plan`
- `list_camera_recipes`
- `apply_camera_recipe`
- `review_shot`
- `approve_hero_frame`
- `set_human_locks`
- `save_visual_checkpoint`
- `export_shot`
- `import_motion_previs_camera`
- `set_reference`

The compact surface exists to reduce schema/context cost. Do not expose low-level tools by default just because they exist.

## 5. Future ChatGPT tunnel

The intended future architecture is:

```
ChatGPT
  ↓
OpenAI secure tunnel / tunnel-client
  ↓
local Blockout Director MCP
  ↓
shared Director control/compiler
  ↓
Blockout on the user's Mac
```

The user already explored OpenAI `tunnel-client`, but **do not implement/finish Tunnel before packaged-app user QA is stable**.

The tunnel should expose the compact Director surface, not the full low-level catalog by default.

For continuity when Codex context/tokens run out, prefer GitHub plus the Google Drive fallback bundle documented in `docs/CONTINUITY.md`:

```bash
npm run handoff:bundle
```

## 6. Audit work already done

Several contradictions were found and fixed during the last pass:

- label color vs object color semantics
- social canvas formats vs generator-profile support
- stale MCP tool counts/docs
- stale prompt/export documentation
- Shot Plans incorrectly sharing `refs/`
- broad renderer text-file read replaced with project-scoped snapshot read
- reference-card duplicate types
- reference-card schema validation
- Hero approval not invalidating on some camera-mark deletion paths
- centralized Hero visual invalidation
- Hero Board allowed without Hero approval
- same-second phase-board / Shot Plan filename collisions
- localization circular imports
- camera recipe subject/identity round-trip issues
- history lacked undo/redo/restore provenance
- visual review and recent-history calls consolidated with `get_visual_context`
- visual checkpoint control timeout aligned with rendering work

This audit is **not proof the branch compiles**. It was a static/source audit.

## 7. Known unfinished / high-risk areas

### Completed: local validation and packaged smoke

The accumulated branch had many commits and cross-layer changes. The local Mac validation/fix pass was completed on 2026-09-23:

```bash
npm run typecheck
npm run lint
npm run build
npm run e2e
```

Result: typecheck passed, lint passed, build passed, full e2e passed with 72 passing and 6 skipped readme screenshot tests.

Targeted manual smoke also passed through:
- create/select Workspace
- new/open/save project
- EN/RU switching
- 9:16 / 3:4 / 4:5 viewport
- Base Color
- Director Camera recipe
- Hero approval + invalidation
- Daily/Hero phase boards
- Checkpoint/history/restore
- Reference Cards
- Shot Plan import/export round trip
- Deliver/export

Packaged `.app` QA smoke also passed from `release/mac-arm64/Blockout.app`:
- app version `5.1.2`
- project create/save/load
- EN/RU switching
- compact `get_state` camera marks
- Director compile + camera recipe
- Shot Plan export/import
- review sheet + approved Hero Board
- reference copy into `refs/`
- Seedance export package with metadata and reference roles

Next validation priority is real workflow trials, followed by narrow bug fixes only.

### IPC consistency

Main/preload/renderer were statically compared, but preset IPC is registered in `src/main/presets.ts`, so do not mistake those handlers as missing from `src/main/index.ts`.

Recheck all newly added IPC at typecheck/runtime.

### Human Director recipe path

This area was recently changed to preserve recipe identity/subject while still using SceneManager's existing selection contract. Test it manually and in e2e.

### Localization breadth

Still incomplete. Finish only after the app is stable.

### UI polish

Further progressive-disclosure/compactness work is desirable, but stability first.

### Visual Memory retention

Directory structure exists, but automatic cache cleanup / “keep last N dailies” policy is not fully implemented.

### Workspace UX

Workspace exists, but project browsing/management can be improved later. Do not overbuild before core workflow validation.

### Snapshot/history growth

History is compact, snapshots are manual/restore safety points. A future retention policy may be useful.

### GitHub auto-update path

Initial GitHub Releases auto-update wiring exists:
- `src/main/updates.ts` configures `electron-updater` only for packaged apps.
- Dev, smoke runs, and `BLOCKOUT_DISABLE_UPDATES=1` skip update checks.
- `electron-builder.yml` publishes update metadata to `aimpss7/blockout` GitHub releases.
- macOS now builds both `dmg` and `zip`; `latest-mac.yml` points to the zip payload first, as required by electron-updater/Squirrel.Mac.
- `npm run release:mac` builds locally and then uploads the exact macOS assets through `gh release upload --clobber`; normal `package:*` scripts still use `--publish never`.
- `v5.1.1` and `v5.1.2` GitHub releases were published. A real packaged `5.1.1` app found `5.1.2`, downloaded the zip, and handed it to Squirrel.Mac.

Current blocker: install failed at Squirrel.Mac code-signature validation because the app is unsigned (`identity: null`) and this Mac has `0 valid identities found` from `security find-identity -v -p codesigning`. To complete automatic install on macOS, add a Developer ID Application certificate/signing setup and rebuild both old and new releases with the same valid signing identity. The GitHub discovery/download side is proven.

## 8. Tests added/changed

Relevant tests include:
- `tests/unit/director.test.ts`
- `tests/unit/shot-plan.test.ts`
- `tests/unit/references.test.ts`
- `tests/unit/schema.test.ts`
- `tests/unit/motion-previs.test.ts`
- `tests/e2e/agent-director.spec.ts`

CI workflow includes the agent-director e2e in native smoke, but do not assume GitHub Actions has run successfully on this fork/branch. Local validation is required.

## 9. Recommended next sequence

Do this in order:

1. **Run real workflow trials**: ChatGPT/Codex builds a shot → Blockout renders phase board → review/revision → Seedance package.
2. Fix only bugs found in real workflow trials.
3. Re-run `npm run typecheck`, `npm run lint`, and relevant e2e/full e2e.
4. Create a Google Drive handoff bundle with `npm run handoff:bundle` before any long pause or risky work.
5. Audit `project.json ↔ .shot.json ↔ MCP ↔ export` round-trip consistency if real workflow trials expose drift.
6. Finish remaining RU/EN visible strings.
7. Finish compact Director UX only where it clearly reduces friction.
8. Add retention cleanup for cache/dailies if needed.
9. Only then connect `tunnel-client` and ChatGPT to the compact Director MCP.
10. Test remote/local tunnel flow against the same compact Director MCP.

## 10. Product constraints to preserve

- Previs first, not full 3D modeling.
- Simple proxy geometry is enough.
- Camera/operator expertise is the differentiator.
- Human can always edit results.
- Agent should operate through film concepts, not thousands of XYZ calls.
- One phase board is preferable to many screenshots.
- Keep context/token cost low.
- Keep files structured and portable.
- Separate motion authority from identity/style authority.
- Never let editor chrome leak into final exports.
- Preserve deterministic export behavior.

## 11. Where to read next

1. **This file** — current handoff.
2. `AGENTS.md` — repo rules, commands, architecture.
3. `docs/AGENT_DIRECTOR_ROADMAP.md` — design history and implementation notes.
4. `mcp/README.md` — MCP/control usage.
5. `src/engine/shot-plan.ts` — portable Director contract.
6. `src/engine/director.ts` — camera recipes, state/review helpers, Hero fingerprint.
7. `src/renderer/control/handler.ts` — shared high-level execution surface.
8. `src/renderer/store.ts` — mutation/history/undo and central Hero invalidation.
9. `src/renderer/export/exporter.ts` — phase boards and generator export.
10. `tests/e2e/agent-director.spec.ts` — intended end-to-end agent workflow.
