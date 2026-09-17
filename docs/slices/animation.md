# Slice: rigging, motion, and the image → video → motion lane

Builds on [atlas-nodes.md](./atlas-nodes.md) and [batch.md](./batch.md). Two agents: Ateli (this repo) and the Last Light renderer (`/Users/btnorris/dev/games/last-light`). This file is the shared contract.

## Proven by hand (2026-09-17)

- Uthana auto-rigs an uncompressed 30k-tri Meshy decimate (`4.8 MB`) in ~27 s, confidence 1.0, character id `c6HqNKEbkTfu`. Uthana imports via Blender 4.2 and **rejects meshopt-compressed GLBs**: rig from the Optimize output, Compress last.
- `create_text_to_motion(prompt)` returns a motion id in ~1 s; `GET /motion/file/motion_viewer/<character>/<motion>/glb/motion.glb?fps=30` returns a skinned, textured GLB (24 nodes, 1 skin, 1 animation, unnamed) with root motion.
- Fixture for the renderer: `last-light/public/characters/clips/drifters-light-default/{idle,walk,attack}.glb` (same character, same skeleton, one clip each), plus `uthana-character-id.txt`.

## Keys

`~/dev/ateli/.env`: `MESHY_API_KEY`, `UTHANA_API_KEY` (Basic auth, `-u KEY:`), `FAL_KEY` (`Authorization: Key …`). Loaded by `server/backend.mjs`; workers read `process.env`.

## New value type: `video`

`AteliValueType` gains `video` and `video[]`. File type (like mesh/image): sources may be `.mp4`/`.webm`/`.mov`; results are `.mp4`. Preview: the bridge extracts the first frame with `ffmpeg -ss 0 -frames:v 1` (ffmpeg at `/opt/homebrew/bin/ffmpeg`) to `preview.png`; the UI shows it like an image and the lightbox plays the video in a `<video controls>`. Port colour: a distinct hue (e.g. `#f472b6`).

## New runtimes and tools (server/tools.mjs)

### `uthana` runtime — `executor/uthana-worker.mjs`

| id | title | category | inputs | outputs |
|---|---|---|---|---|
| `character.rig` | Rig Character | Mesh | `mesh: mesh` (uncompressed GLB < 30 MB), `includeFingers: boolean=false`, `frontFacing: boolean=true` | `character: text` (Uthana character id), `mesh: mesh` (rest pose download: the input GLB re-exported through Uthana is not available without a motion, so output the *input* file unchanged and put the id in `meta`) |
| `motion.fromText` | Motion from Text | Mesh | `character: text`, `prompt: text (multiline)`, `clipName: text default 'clip'`, `inPlace: boolean=true`, `fps: number=30` | `mesh: mesh` (skinned GLB with one animation named `clipName`) |
| `motion.fromVideo` | Motion from Video | Mesh | `character: text`, `video: video`, `clipName`, `inPlace`, `fps` | `mesh: mesh` |

`create_character` is idempotent on identical files (Uthana returns the existing id): cache key is the input hash as usual. `motion.fromVideo` uses the video-to-motion mutation from https://uthana.com/docs/api/capabilities/video-to-motion (read it; multipart upload like `create_character`). Poll the motion until its file downloads with 200. Rename the animation to `clipName` and, when `inPlace`, strip the root joint's X/Z translation keyframes (keep Y) using `@gltf-transform/core` in the worker. Record `{ characterId, motionId, prompt }` in `outputs.json` `meta`.

### `fal` runtime — `executor/fal-worker.mjs`

Uses `@fal-ai/client` (`fal.subscribe(model, { input })`; upload local files with `fal.storage.upload`). Download result files into `outputDir`.

| id | title | category | inputs | outputs |
|---|---|---|---|---|
| `image.edit` | Edit Image | Image | `image: image`, `prompt: text (multiline)`, `model: enum ['fal-ai/nano-banana-2/edit','openai/gpt-image-2/edit'] default nano-banana` | `image: image` |
| `video.fromImage` | Image to Video | Video | `image: image`, `prompt: text (multiline)`, `model: enum ['fal-ai/kling-video/v3/pro/image-to-video','bytedance/seedance-2.0/us/image-to-video'] default kling`, `duration: enum ['5','10'] default '5'` | `video: video` |

Category `Video` is new. Read each model's `/api` page on fal for exact input names before coding; put the actual request/response in the worker test as a fixture. Record fal's reported cost/timings in `meta` when present.

### `gltf` runtime addition

| `mesh.mergeAnimations` | Merge Animations | Mesh | `base: mesh` (skinned), `clips: mesh[]` | `mesh: mesh` — all animations from `clips` copied onto `base` by joint name (skeletons are identical when they share a Uthana character); animation names preserved. |

### Catalog seeds

`ateli-seed-graph` unchanged. Add a second seed command "Create character motion graph": Input Mesh → Rig → (Motion from Text ×3: idle/walk/attack with the prompts used in the fixture) → Collect Meshes → Merge Animations → Compress → Export `{dir}`.

## Renderer contract (last-light)

`src/content/characters.ts`: `CharacterDefinition` gains optional `clips?: { idle: string; walk: string; attack: string }` — paths to skinned GLBs sharing the asset's skeleton (fixture wires `drifters-light-default`). Later a single merged GLB per character carries all clips; the loader must accept both (clips from separate files or `gltf.animations` on the asset).

`src/render/characters.ts`: when clips exist, the visual is the **rigged** GLB (the clip files include the mesh; use `walk.glb` as the body) with an `AnimationMixer`; `world-view` maps sim behaviour → clip: `wander|goto` moving → `walk` (timeScale = entity.speed / clip's authored speed, assume 1.4 m/s), stationary → `idle`, `attack` → `attack` (one-shot on each swing: the sim exposes `nextSwing`; play when it changes), `dead` → freeze on the last idle frame and lie down as today. Cross-fade 0.2 s. Strip root XZ translation tracks in the loader so clips play in place regardless of what the file carries. Characters without clips keep today's static behaviour.

## Tests

- Ateli: worker tests with recorded fixtures for uthana/fal request shapes (no live calls in the suite; one `LIVE=1`-gated live test each, like the Meshy one). Router: `video` type validation and preview extraction with a tiny generated mp4 (`ffmpeg -f lavfi`). Merge test: two skinned GLBs → one with two named animations.
- Last Light: vitest for clip selection from behaviour (pure function); browser check of the fixture character walking in place and swinging when sent at the dummy.

## Ateli implementation notes

- `list.collectMeshes` and `list.collectImages` are variadic aggregation seams: repeated scalar edges may target their `item` port. Other input ports still reject duplicate incoming edges. This is required for the three motion nodes in the character-motion seed to feed one `Collect Meshes` node.
- Named clip animations retain their names during `mesh.mergeAnimations`. The checked-in renderer fixtures contain unnamed animations, so an unnamed clip receives its source filename stem (`idle`, `walk`, or `attack`); additional unnamed animations in the same file receive `-2`, `-3`, and so on.
- The fixture-generation prompts were not stored with the GLBs. The seed makes the intended actions explicit: “Standing idle, breathing naturally with subtle shifts of weight.”, “Walk forward at a steady relaxed pace.”, and “Raise a rifle to the shoulder, fire once, and recover to a ready stance.”

## Conventions added after the first batch

- Uthana characters walk toward +Z; the worker rotates every motion output so the character faces -Z like every other Ateli mesh.
- The worker measures the clip's authored travel speed (root XZ displacement over the middle 60% of the track, world space) before flattening it and stores it as the animation's `extras.rootSpeed` (m/s) and in `uthana.json`. Runtimes scale walk playback by `groundSpeed / rootSpeed`; a `tired` prompt produced 0.45 m/s, `normal brisk pace` 1.63 m/s.
