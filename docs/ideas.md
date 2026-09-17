# Ideas

Spitball list. Anything here is unscheduled; promote to a slice contract in `docs/slices/` when it is time to build it.

## Install and launch

- **Install script.** One command that sets up a fresh machine: Blender path, Python deps, `imgen` service, `npm install`, and registers `bin/ateli` on PATH.
- **Custom launcher.** Create new `.tldraw` documents that already have the mod installed, instead of open → install per document. Could be a small app or a `ateli new <name>` that creates the file and opens it in tldraw Offline.

## Node graph

- Real-time 3D preview in mesh nodes (WebGL viewer) instead of a Blender-rendered still.
- Permanent tests for `mesh.bake`, `autoTransform`, `bboxFit`, `rotateToAxis`.
- Per-material-slot addressing on top of channel images (see ADR 0004 consequences).
