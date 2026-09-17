# Decision: material slots are individual ports

**Status:** Superseded by [0004](./0004-textures-are-channel-images.md).

## Problem

A single opaque `materials` port let a user route "all materials" from one node to another but gave them nothing to act on.

## Decision (withdrawn)

`Break Materials` exposed one output port per material slot; `Recombine` exposed one input per slot. Ports were derived from mesh data.

## Why it was withdrawn

Per-slot ports still carried opaque material objects. What a user actually edits, previews, and reconnects is a texture channel image (base color, roughness, metallic, normal). Slot-level routing is a second axis on top of that and is not needed for the first three node categories. See 0004.
