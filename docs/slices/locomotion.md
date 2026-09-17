# Slice: ALS locomotion for Last Light

Decision (2026-09-17): locomotion comes from ALS Refactored's authored clips and movement, not from text-to-motion. Text/video-to-motion remains for bespoke actions layered on top. Three parallel workers; this file is the contract.

## Proven

- Uthana `create_character(..., rerig_target: "ue5", include_fingers: true)` on the 30k decimate returns confidence 1.0 and a 63-joint skeleton. 52 joint names are identical to `SK_Als` (als-web `public/assets/skm-als.glb`, 68 joints, 119 clips). ALS-only: `root`, `ik_foot_root ik_foot_l ik_foot_r ik_hand_root ik_hand_gun ik_hand_l ik_hand_r`, and twist bones `thigh_twist_01_* calf_twist_01_* upperarm_twist_01_* lowerarm_twist_01_*`. UE5-only: `spine_04 spine_05 neck_02` and eight `*_metacarpal_*`.
- Sample: `/tmp/drifter-ue5-walk.glb` (Uthana character `cqG8wwxEWN44`).

## A. Ateli — Rig on the ALS skeleton (`executor/uthana-worker.mjs`, `server/tools.mjs`)

`character.rig` gains `skeleton: enum ['uthana', 'als'] default 'uthana'`.

- `als`: upload with `rerig_target: "ue5"`, `include_fingers: true`. Output `mesh` is the **skinned rest-pose GLB** (not the input passthrough): obtain it by downloading any motion for the character (`create_text_to_motion("standing still")` or the cheapest available) and deleting its animation. Then conform it:
  - inject non-skinned nodes so every `SK_Als` joint name exists: `root` (new scene-level parent of `pelvis`, identity transform at the ground origin), `ik_foot_root` and `ik_hand_root` under `root`, `ik_foot_l/r` under `ik_foot_root` placed at the rest-pose world position of `foot_l/r`, `ik_hand_l/r/gun` under `ik_hand_root` at the rest-pose world position of `hand_l/r` (gun = hand_r); twist bones as children of their limb bone at the midpoint toward the child (`thigh_twist_01_l` between `thigh_l` and `calf_l`, etc.), no skin weights. Add them to the skin's joint list so clip tracks bind, with inverse bind matrices from their rest transforms.
  - face -Z (existing `faceNegativeZ`), metres, origin at the feet.
  - write `meta.skeleton = 'als'` and the joint list into `uthana.json`.
- `uthana` keeps today's behaviour, but its `mesh` output also becomes the skinned rest pose (same motion-download-and-strip method), so `mesh.mergeAnimations` can take Rig's mesh as base. Record this deviation in `docs/slices/animation.md`.
- Tests: recorded fixture for the rerig request; a conformance test on the live sample `/tmp/drifter-ue5-walk.glb` run through the conform step asserting all 68 `SK_Als` names are present and skinned vertex data is unchanged.

### Ateli implementation deviations

- Twist placement follows the authored SK_Als rest skeleton rather than treating every twist as an exact midpoint. The thigh and lower-arm twists are at about 51.9% of the limb, calf twists at about 50.9%, and upper-arm twists at about 1.65%; parentage and local rest rotations also match SK_Als. This is required for the injected hierarchy to reproduce the reference rest transforms.
- The authored SK_Als hierarchy parents `ik_hand_l` and `ik_hand_r` under `ik_hand_gun`, not directly under `ik_hand_root` as the shorthand above says. Conformance preserves that reference parentage while keeping each IK node's world-space rest transform equal to its source hand.

## B. `als-locomotion` package (`/Users/btnorris/dev/als-locomotion`, new repo; als-web READ-ONLY)

Extract from `/Users/btnorris/dev/als-web/src/als` and the `rapierAls*` / `alsFeetPoseBridge` / `alsCameraBridge` / `alsAudioBridge` engine modules that the `animgraph` extraction left behind, into a framework-free package depending on `animgraph` (link `file:../animgraph`), `three` (peer) and `@dimforge/rapier3d-compat`. No React, zustand, leva, R3F. Keep the pure modules and tests intact (same rule as the animgraph extraction: never simplify the math; comments carry rationale, keep them; no no-comments lint). React-bound bridges are re-expressed as plain functions with an explicit `update(dt)`; leva controls become a settings object; zustand stores become plain state passed in.

Public surface (define precisely in README):
- `createAlsCharacter({ world: RAPIER.World, skinnedMesh, clips, settings })` → `{ setInput({ moveDirection, viewRotation, gait, stance, wantsToSprint, wantsToJump, wantsToRoll }), step(dt), pose(dt), state, dispose() }` — movement on the Rapier capsule (`rapierAlsCharacterMovement`) and the AnimGraph feeding `animgraph`'s evaluator; the caller owns the Rapier world and steps it.
- `loadAlsClips(glbUrlOrDocument)` → the clip table from `skm-als.glb` (copy `skm-als.glb`, `skm-als-rifle.glb` and `LICENSE-ALS-Refactored.md` into the package's `assets/`).
- Camera and audio bridges as optional, separate exports.
- README: provenance, licence note, a 40-line integration recipe for a vanilla three.js + Rapier loop, and "Stays in als-web" (R3F scene, leva panels, playtest tooling, Vercel).

Acceptance: `pnpm check`, `pnpm test` (the transplanted suites), `pnpm build` (tsdown ESM + d.ts); `git -C als-web status --short` empty; commit, no push.

## C. Last Light sim on Rapier (`/Users/btnorris/dev/games/last-light`)

The flat plane was fixture scaffolding. The sim adopts a Rapier world now so that ALS movement drops in when B lands:

- `@dimforge/rapier3d-compat` in `src/sim/` (the sim stays free of three.js and the DOM; Rapier is allowed). `World` gains `physics: RAPIER.World`; `Entity.position` becomes `{ x, y, z }`; `heading` stays.
- Town: ground as a cuboid collider (heightfield later), buildings as cuboid colliders from content, the dummy as a fixed capsule. Characters are `KinematicCharacterController` capsules (0.4 m radius, 1.8 m tall) with autostep and slope limits; behaviours produce a desired planar velocity; `movement.ts` applies it through the controller; separation between characters via the controller's collisions (drop the hand-rolled push-out).
- `step()` steps the Rapier world once per tick after moving characters. Determinism: Rapier is deterministic for a fixed dt and insertion order.
- Keep the command/behaviour/combat contract and the tests (update for 3D positions; add: characters cannot pass through a building; they step onto a 0.3 m curb; two characters cannot occupy the same spot).
- Renderer: reads `position.y`; nothing else changes. `AnimationMixer` stays until B lands.
- `docs/architecture.md`: replace the flat-plane paragraph; invariants unchanged.
- Acceptance: `pnpm check`, `pnpm test`; the dev server (already running on 5180, HMR) shows the town with characters walking around buildings; paste a screenshot via `?follow=<id>&walk=...` through the tldraw board if a real Chrome is unavailable (Paseo's webview has no WebGL; the eval `browser` relay must not be used). Commit.
